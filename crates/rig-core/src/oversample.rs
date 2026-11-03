//! Windowed-sinc polyphase oversampling for nonlinear stages (docs/PLAN.md, Q29).

use std::f64::consts::PI;

fn bessel_i0(x: f64) -> f64 {
    let mut sum = 1.0;
    let mut term = 1.0;
    let q = x * x / 4.0;
    for k in 1..60 {
        term *= q / (k as f64 * k as f64);
        sum += term;
        if term < 1e-18 * sum {
            break;
        }
    }
    sum
}

/// Low-pass prototype at the oversampled rate, cut at the original Nyquist, DC gain 1.
fn design(l: usize, taps_per_phase: usize) -> Vec<f64> {
    let t = l * taps_per_phase;
    let fc = 0.5 / l as f64;
    let beta = 7.86;
    let mid = (t as f64 - 1.0) / 2.0;
    let mut h: Vec<f64> = (0..t)
        .map(|i| {
            let x = i as f64 - mid;
            let sinc = if x == 0.0 {
                2.0 * fc
            } else {
                (2.0 * PI * fc * x).sin() / (PI * x)
            };
            let r = x / mid;
            let w = bessel_i0(beta * (1.0 - r * r).max(0.0).sqrt()) / bessel_i0(beta);
            sinc * w
        })
        .collect();
    let sum: f64 = h.iter().sum();
    h.iter_mut().for_each(|v| *v /= sum);
    h
}

/// Fixed-length history, newest first, contiguous via a doubled buffer.
struct Ring {
    buf: Vec<f64>,
    pos: usize,
    len: usize,
}

impl Ring {
    fn new(len: usize) -> Self {
        Self {
            buf: vec![0.0; 2 * len],
            pos: 0,
            len,
        }
    }
    fn push(&mut self, v: f64) {
        self.pos = (self.pos + self.len - 1) % self.len;
        self.buf[self.pos] = v;
        self.buf[self.pos + self.len] = v;
    }
    fn window(&self) -> &[f64] {
        &self.buf[self.pos..self.pos + self.len]
    }
    fn clear(&mut self) {
        self.buf.iter_mut().for_each(|v| *v = 0.0);
    }
}

pub const TAPS_PER_PHASE: usize = 33;

pub struct Upsampler {
    l: usize,
    h: Vec<f64>,
    hist: Ring,
}

impl Upsampler {
    pub fn new(l: usize) -> Self {
        Self {
            l,
            h: design(l, TAPS_PER_PHASE),
            hist: Ring::new(TAPS_PER_PHASE),
        }
    }
    /// Push one input sample; writes `l` oversampled samples into `out`.
    pub fn push(&mut self, x: f64, out: &mut [f64]) {
        if self.l == 1 {
            out[0] = x;
            return;
        }
        self.hist.push(x);
        let w = self.hist.window();
        for (p, o) in out.iter_mut().take(self.l).enumerate() {
            let mut acc = 0.0;
            for (j, xv) in w.iter().enumerate() {
                acc += self.h[p + j * self.l] * xv;
            }
            *o = acc * self.l as f64;
        }
    }
    pub fn reset(&mut self) {
        self.hist.clear();
    }
}

pub struct Downsampler {
    l: usize,
    h: Vec<f64>,
    hist: Ring,
}

impl Downsampler {
    pub fn new(l: usize) -> Self {
        Self {
            l,
            h: design(l, TAPS_PER_PHASE),
            hist: Ring::new(l * TAPS_PER_PHASE),
        }
    }
    pub fn push(&mut self, y: f64) {
        self.hist.push(y);
    }
    /// Filtered output; call after pushing the `l` samples of one input period.
    pub fn output(&self) -> f64 {
        if self.l == 1 {
            return self.hist.window()[0];
        }
        self.hist
            .window()
            .iter()
            .zip(&self.h)
            .map(|(a, b)| a * b)
            .sum()
    }
    pub fn reset(&mut self) {
        self.hist.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FS: f64 = 48_000.0;

    fn chain_gain_db(freq: f64, l: usize) -> f64 {
        let mut up = Upsampler::new(l);
        let mut down = Downsampler::new(l);
        let mut buf = vec![0.0; l];
        let n = 4000;
        let (mut e_in, mut e_out) = (0.0, 0.0);
        for i in 0..n {
            let x = (2.0 * PI * freq * i as f64 / FS).sin();
            up.push(x, &mut buf);
            for v in buf.iter() {
                down.push(*v);
            }
            if i > 1000 {
                // compare power only; delay does not matter for RMS
                e_in += x * x;
                let y = down.output();
                e_out += y * y;
            }
        }
        10.0 * (e_out / e_in).log10()
    }

    #[test]
    fn passband_flat_to_18k() {
        for f in [100.0, 1_000.0, 10_000.0, 18_000.0] {
            let g = chain_gain_db(f, 4);
            assert!(g.abs() < 0.1, "{f} Hz gain {g} dB");
        }
    }

    #[test]
    fn images_rejected_by_60_db() {
        let l = 4;
        let mut up = Upsampler::new(l);
        let mut buf = vec![0.0; l];
        let f0 = 10_000.0;
        let mut out = Vec::new();
        for i in 0..6000 {
            up.push((2.0 * PI * f0 * i as f64 / FS).sin(), &mut buf);
            out.extend_from_slice(&buf);
        }
        let fs_os = FS * l as f64;
        let tail = &out[out.len() - 8192..];
        let amp = |f: f64| {
            let (mut re, mut im) = (0.0, 0.0);
            for (i, v) in tail.iter().enumerate() {
                let w = 0.5 - 0.5 * (2.0 * PI * i as f64 / tail.len() as f64).cos();
                let ph = 2.0 * PI * f * i as f64 / fs_os;
                re += v * w * ph.cos();
                im += v * w * ph.sin();
            }
            (re * re + im * im).sqrt()
        };
        let rej = 20.0 * (amp(f0) / amp(FS - f0)).log10();
        assert!(rej > 60.0, "image rejection {rej} dB");
    }

    #[test]
    fn dc_gain_is_unity() {
        let h = design(4, TAPS_PER_PHASE);
        assert!((h.iter().sum::<f64>() - 1.0).abs() < 1e-12);
    }
}
