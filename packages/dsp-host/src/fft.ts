/** In-place radix-2 complex FFT of a fixed power-of-two size, with tables built once (safe for an audio callback). */
export class Fft {
  private readonly rev: Uint32Array;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  constructor(readonly n: number) {
    this.rev = new Uint32Array(n);
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      this.rev[i] = j;
    }
    this.cos = Float64Array.from({ length: n / 2 }, (_, k) => Math.cos((-2 * Math.PI * k) / n));
    this.sin = Float64Array.from({ length: n / 2 }, (_, k) => Math.sin((-2 * Math.PI * k) / n));
  }

  forward(re: Float64Array, im: Float64Array): void {
    const { n, rev } = this;
    for (let i = 1; i < n; i++) {
      const j = rev[i] as number;
      if (i < j) {
        [re[i], re[j]] = [re[j] as number, re[i] as number];
        [im[i], im[j]] = [im[j] as number, im[i] as number];
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const step = n / len;
      for (let i = 0; i < n; i += len) {
        for (let k = 0; k < len / 2; k++) {
          const c = this.cos[k * step] as number;
          const s = this.sin[k * step] as number;
          const a = i + k;
          const b = a + len / 2;
          const tr = (re[b] as number) * c - (im[b] as number) * s;
          const ti = (re[b] as number) * s + (im[b] as number) * c;
          re[b] = (re[a] as number) - tr;
          im[b] = (im[a] as number) - ti;
          re[a] = (re[a] as number) + tr;
          im[a] = (im[a] as number) + ti;
        }
      }
    }
  }

  /** Inverse transform, scaled so that `inverse(forward(x))` returns x. */
  inverse(re: Float64Array, im: Float64Array): void {
    for (let i = 0; i < this.n; i++) im[i] = -(im[i] as number);
    this.forward(re, im);
    for (let i = 0; i < this.n; i++) {
      re[i] = (re[i] as number) / this.n;
      im[i] = -(im[i] as number) / this.n;
    }
  }
}

/** Power spectrum in dB of a Hann-windowed frame, using an in-place radix-2 FFT. N must be a power of two. */
export function powerDb(frame: Float32Array): Float32Array {
  const n = frame.length;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  let wsum = 0;
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    re[i] = (frame[i] ?? 0) * w;
    wsum += w;
  }
  new Fft(n).forward(re, im);
  // amplitude of a full-scale sine reads 0 dB
  const out = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    const mag = (2 * Math.hypot(re[i] as number, im[i] as number)) / wsum;
    out[i] = 20 * Math.log10(mag + 1e-12);
  }
  return out;
}

/** Strongest level in dB within 2% of `freq`, from a `powerDb` result. */
export function levelNear(db: Float32Array, sampleRate: number, freq: number): number {
  const hz = sampleRate / (db.length * 2);
  let best = -200;
  for (let f = freq * 0.98; f <= freq * 1.02; f += hz)
    best = Math.max(best, db[Math.round(f / hz)] ?? -200);
  return best;
}
