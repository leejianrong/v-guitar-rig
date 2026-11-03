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
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [re[i], re[j]] = [re[j] as number, re[i] as number];
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const c = Math.cos(ang * k);
        const s = Math.sin(ang * k);
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
