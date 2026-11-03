//! Modified nodal analysis with a Newton step per sample (ADR-0007).
//! Capacitors use the trapezoidal companion model, diodes the Shockley equation
//! with SPICE-style voltage limiting. No allocation after construction.

use crate::netlist::{self, DiodeModel, Elem, Node};
use crate::oversample::{Downsampler, Upsampler};

const VT: f64 = 0.025852; // thermal voltage at 300 K
const GMIN: f64 = 1e-12;
const MAX_NEWTON: usize = 60;
const MAX_L: usize = 16;

struct Cap {
    a: Node,
    b: Node,
    g: f64,
    v_prev: f64,
    i_prev: f64,
}

struct Diode {
    a: Node,
    k: Node,
    is: f64,
    nvt: f64,
    vcrit: f64,
    v: f64, // junction voltage at the last accepted/iterated point
}

pub struct Circuit {
    n: usize,
    a0: Vec<f64>,
    a: Vec<f64>,
    rhs: Vec<f64>,
    x: Vec<f64>,
    caps: Vec<Cap>,
    diodes: Vec<Diode>,
    in_row: usize,
    in_scale: f64,
    out: Node,
    out_gain: f64,
    l: usize,
    up: Upsampler,
    down: Downsampler,
    scratch: [f64; MAX_L],
    pub nonconverged: u64,
}

fn idx(n: Node) -> Option<usize> {
    match n {
        Node::Ground => None,
        Node::N(i) => Some(i),
    }
}

fn stamp_g(m: &mut [f64], n: usize, a: Node, b: Node, g: f64) {
    if let Some(i) = idx(a) {
        m[i * n + i] += g;
    }
    if let Some(j) = idx(b) {
        m[j * n + j] += g;
    }
    if let (Some(i), Some(j)) = (idx(a), idx(b)) {
        m[i * n + j] -= g;
        m[j * n + i] -= g;
    }
}

fn volt(x: &[f64], n: Node) -> f64 {
    idx(n).map_or(0.0, |i| x[i])
}

fn pnjlim(vnew: f64, vold: f64, nvt: f64, vcrit: f64) -> f64 {
    if vnew > vcrit && (vnew - vold).abs() > 2.0 * nvt {
        if vold > 0.0 {
            let arg = 1.0 + (vnew - vold) / nvt;
            if arg > 0.0 {
                vold + nvt * arg.ln()
            } else {
                vcrit
            }
        } else {
            nvt * (vnew / nvt).ln()
        }
    } else {
        vnew
    }
}

/// Solve `a * x = b` in place by Gaussian elimination with partial pivoting.
/// Returns false if the matrix is singular.
fn solve(a: &mut [f64], b: &mut [f64], n: usize) -> bool {
    for c in 0..n {
        let mut p = c;
        for r in c + 1..n {
            if a[r * n + c].abs() > a[p * n + c].abs() {
                p = r;
            }
        }
        if a[p * n + c].abs() < 1e-18 {
            return false;
        }
        if p != c {
            for k in 0..n {
                a.swap(p * n + k, c * n + k);
            }
            b.swap(p, c);
        }
        for r in c + 1..n {
            let f = a[r * n + c] / a[c * n + c];
            if f != 0.0 {
                for k in c..n {
                    a[r * n + k] -= f * a[c * n + k];
                }
                b[r] -= f * b[c];
            }
        }
    }
    for r in (0..n).rev() {
        let mut s = b[r];
        for k in r + 1..n {
            s -= a[r * n + k] * b[k];
        }
        b[r] = s / a[r * n + r];
    }
    true
}

impl Circuit {
    pub fn new(text: &str, sample_rate: f64, oversample: usize) -> Result<Self, String> {
        if !(1..=MAX_L).contains(&oversample) {
            return Err(format!("oversample must be 1..={MAX_L}"));
        }
        let nl = netlist::parse(text)?;
        let n = nl.node_count + 1; // + input source branch current
        let dt = 1.0 / (sample_rate * oversample as f64);
        let mut a0 = vec![0.0; n * n];
        let (mut caps, mut diodes) = (Vec::new(), Vec::new());
        let (mut in_row, mut in_scale) = (0, 1.0);
        let branch = nl.node_count;
        for e in &nl.elems {
            match *e {
                Elem::R { a, b, ohms } => stamp_g(&mut a0, n, a, b, 1.0 / ohms),
                Elem::C { a, b, farads } => {
                    let g = 2.0 * farads / dt;
                    stamp_g(&mut a0, n, a, b, g);
                    caps.push(Cap {
                        a,
                        b,
                        g,
                        v_prev: 0.0,
                        i_prev: 0.0,
                    });
                }
                Elem::D {
                    a,
                    k,
                    model: DiodeModel { is, n: ideality },
                } => {
                    let nvt = ideality * VT;
                    let vcrit = nvt * (nvt / (std::f64::consts::SQRT_2 * is)).ln();
                    diodes.push(Diode {
                        a,
                        k,
                        is,
                        nvt,
                        vcrit,
                        v: 0.0,
                    });
                }
                Elem::VIn { p, n: nn, scale } => {
                    if let Some(i) = idx(p) {
                        a0[i * n + branch] += 1.0;
                        a0[branch * n + i] += 1.0;
                    }
                    if let Some(j) = idx(nn) {
                        a0[j * n + branch] -= 1.0;
                        a0[branch * n + j] -= 1.0;
                    }
                    in_row = branch;
                    in_scale = scale;
                }
            }
        }
        // a tiny conductance to ground on every node keeps floating nodes solvable
        for i in 0..nl.node_count {
            a0[i * n + i] += GMIN;
        }
        Ok(Self {
            n,
            a: vec![0.0; n * n],
            a0,
            rhs: vec![0.0; n],
            x: vec![0.0; n],
            caps,
            diodes,
            in_row,
            in_scale,
            out: nl.out,
            out_gain: nl.out_gain,
            l: oversample,
            up: Upsampler::new(oversample),
            down: Downsampler::new(oversample),
            scratch: [0.0; MAX_L],
            nonconverged: 0,
        })
    }

    pub fn reset(&mut self) {
        self.x.iter_mut().for_each(|v| *v = 0.0);
        self.caps.iter_mut().for_each(|c| {
            c.v_prev = 0.0;
            c.i_prev = 0.0;
        });
        self.diodes.iter_mut().for_each(|d| d.v = 0.0);
        self.up.reset();
        self.down.reset();
    }

    /// Advance one internal-rate step with the given input source voltage; returns the
    /// output node voltage (before makeup gain).
    pub fn step_volts(&mut self, vin: f64) -> f64 {
        let n = self.n;
        for it in 0..MAX_NEWTON {
            self.a.copy_from_slice(&self.a0);
            self.rhs.iter_mut().for_each(|v| *v = 0.0);
            self.rhs[self.in_row] = vin;
            for c in &self.caps {
                let ih = c.g * c.v_prev + c.i_prev;
                if let Some(i) = idx(c.a) {
                    self.rhs[i] += ih;
                }
                if let Some(j) = idx(c.b) {
                    self.rhs[j] -= ih;
                }
            }
            for d in &self.diodes {
                let e = (d.v / d.nvt).min(80.0).exp();
                let i0 = d.is * (e - 1.0);
                let g = d.is / d.nvt * e + GMIN;
                let ieq = i0 - g * d.v;
                stamp_g(&mut self.a, n, d.a, d.k, g);
                if let Some(i) = idx(d.a) {
                    self.rhs[i] -= ieq;
                }
                if let Some(j) = idx(d.k) {
                    self.rhs[j] += ieq;
                }
            }
            if !solve(&mut self.a, &mut self.rhs, n) {
                self.reset();
                return 0.0;
            }
            let mut converged = true;
            for (xi, bi) in self.x.iter_mut().zip(&self.rhs) {
                if (*xi - bi).abs() > 1e-9 + 1e-6 * bi.abs() {
                    converged = false;
                }
                *xi = *bi;
            }
            for d in &mut self.diodes {
                let raw = volt(&self.x, d.a) - volt(&self.x, d.k);
                let lim = pnjlim(raw, d.v, d.nvt, d.vcrit);
                if (lim - raw).abs() > 1e-12 {
                    converged = false;
                }
                if (lim - d.v).abs() > 1e-9 + 1e-6 * lim.abs() {
                    converged = false;
                }
                d.v = lim;
            }
            if converged && it > 0 || (converged && self.diodes.is_empty()) {
                break;
            }
            if it == MAX_NEWTON - 1 {
                self.nonconverged += 1;
            }
        }
        for c in &mut self.caps {
            let v = volt(&self.x, c.a) - volt(&self.x, c.b);
            let i_new = c.g * (v - c.v_prev) - c.i_prev;
            c.v_prev = v;
            c.i_prev = i_new;
        }
        let v = volt(&self.x, self.out);
        if v.is_finite() {
            v
        } else {
            self.reset();
            0.0
        }
    }

    /// Process one audio-rate block. Input and output are normalised audio (-1..1).
    pub fn process(&mut self, input: &[f32], output: &mut [f32]) {
        let len = input.len().min(output.len());
        for k in 0..len {
            let mut buf = self.scratch;
            self.up.push(input[k] as f64, &mut buf);
            for u in buf.iter().take(self.l) {
                let v = self.step_volts(*u * self.in_scale);
                self.down.push(v);
            }
            self.scratch = buf;
            let y = self.down.output() * self.out_gain;
            output[k] = y.clamp(-4.0, 4.0) as f32;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::PI;

    const FS: f64 = 48_000.0;
    pub const CLIPPER: &str = "V vin in 0 IN 10\nR r1 in out 2.2k\nC c1 out 0 10n\n\
        D d1 out 0 1N4148\nD d2 0 out 1N4148\nOUT out 1.4\n";

    fn run(net: &str, l: usize, f: impl Fn(usize) -> f32, n: usize) -> Vec<f32> {
        let mut c = Circuit::new(net, FS, l).unwrap();
        let input: Vec<f32> = (0..n).map(f).collect();
        let mut out = vec![0.0; n];
        for (i, o) in input.chunks(128).zip(out.chunks_mut(128)) {
            c.process(i, o);
        }
        assert_eq!(c.nonconverged, 0, "newton failed to converge");
        out
    }

    fn tone(freq: f64, amp: f32) -> impl Fn(usize) -> f32 {
        move |i| amp * (2.0 * PI * freq * i as f64 / FS).sin() as f32
    }

    fn harmonic_amp(x: &[f32], f: f64) -> f64 {
        let (mut re, mut im) = (0.0, 0.0);
        for (i, v) in x.iter().enumerate() {
            let w = 0.5 - 0.5 * (2.0 * PI * i as f64 / x.len() as f64).cos();
            let ph = 2.0 * PI * f * i as f64 / FS;
            re += *v as f64 * w * ph.cos();
            im += *v as f64 * w * ph.sin();
        }
        (re * re + im * im).sqrt()
    }

    #[test]
    fn rc_lowpass_is_3db_down_at_cutoff() {
        // fc = 1 / (2 pi R C) with R=10k, C=10n -> 1591.5 Hz
        let net = "V v in 0 IN 1\nR r in out 10k\nC c out 0 10n\nOUT out 1\n";
        let fc = 1.0 / (2.0 * PI * 10e3 * 10e-9);
        let n = 24_000;
        let y = run(net, 4, tone(fc, 0.5), n);
        let a_out = harmonic_amp(&y[n / 2..], fc);
        let x: Vec<f32> = (n / 2..n).map(tone(fc, 0.5)).collect();
        let a_in = harmonic_amp(&x, fc);
        let db = 20.0 * (a_out / a_in).log10();
        assert!((db + 3.01).abs() < 0.3, "gain at fc was {db} dB");
    }

    #[test]
    fn clipper_limits_level_and_adds_odd_harmonics() {
        let n = 48_000;
        let y = run(CLIPPER, 4, tone(110.0, 0.9), n);
        let tail = &y[n / 2..];
        let peak = tail.iter().fold(0.0_f32, |m, v| m.max(v.abs()));
        assert!(peak > 0.5 && peak < 1.3, "peak {peak}");
        let h1 = harmonic_amp(tail, 110.0);
        let h3 = harmonic_amp(tail, 330.0);
        let h2 = harmonic_amp(tail, 220.0);
        assert!(h3 / h1 > 0.05, "3rd/1st = {}", h3 / h1);
        assert!(
            h2 < h3 * 0.2,
            "symmetric clipper should favour odd harmonics"
        );
    }

    #[test]
    fn stays_finite_on_hostile_inputs() {
        for f in [
            Box::new(|_| 0.0_f32) as Box<dyn Fn(usize) -> f32>,
            Box::new(|_| 1.0),
            Box::new(|i| if (i / 50) % 2 == 0 { 1.0 } else { -1.0 }),
        ] {
            let y = run(CLIPPER, 4, f, 9_600);
            assert!(y.iter().all(|v| v.is_finite() && v.abs() <= 4.0));
        }
    }

    /// Independent reference: backward Euler at 16x the solver's internal rate, with its own
    /// Newton loop. Compared at the solver's internal-rate sample times.
    #[test]
    fn matches_fine_step_reference() {
        let l = 4;
        let dt = 1.0 / (FS * l as f64);
        let sub = 16;
        let h = dt / sub as f64;
        let (r, cap) = (2.2e3, 10e-9);
        let (is, nvt) = (2.52e-9, 1.752 * VT);
        let vin = |t: f64| 10.0 * 0.9 * (2.0 * PI * 1000.0 * t).sin();
        let mut c = Circuit::new(CLIPPER, FS, l).unwrap();
        let mut v = 0.0_f64;
        let (mut se, mut sr, mut cnt) = (0.0, 0.0, 0);
        for k in 0..(l * 480) {
            let t = (k + 1) as f64 * dt;
            // solver sees the input at internal-rate instants (bypassing the oversampler)
            let ours = c.step_volts(vin(t));
            for s in 1..=sub {
                let ts = k as f64 * dt + s as f64 * h;
                let mut x = v;
                for _ in 0..80 {
                    let e1 = (x / nvt).min(80.0).exp();
                    let e2 = (-x / nvt).min(80.0).exp();
                    let id = is * (e1 - e2);
                    let gd = is / nvt * (e1 + e2);
                    let f = (x - v) / h * cap + (x - vin(ts)) / r + id;
                    let df = cap / h + 1.0 / r + gd;
                    let dx = f / df;
                    x -= dx;
                    if dx.abs() < 1e-12 {
                        break;
                    }
                }
                v = x;
            }
            if k > l * 96 {
                se += (ours - v).powi(2);
                sr += v * v;
                cnt += 1;
            }
        }
        assert!(cnt > 0);
        let rel = (se / sr).sqrt();
        assert!(rel < 0.02, "relative RMS error {rel}");
    }
}
