import type { Board } from "@rig/shared";
import { powerDb } from "./fft";
import { MODULES, type ModuleDef } from "./modules";
import { renderBoard } from "./render";

/** Numbers an agent can read in place of listening (ADR-0006). Levels are dB re full scale. */
export interface Descriptors {
  rmsDb: number;
  peakDb: number;
  /** Peak over RMS: low for squashed or clipped sound, high for sparse peaky sound. */
  crestDb: number;
  /** Where the spectrum's centre of mass sits: higher is brighter. */
  centroidHz: number;
  /** Frequency below which 85% of the energy lies. */
  rolloffHz: number;
  /** Energy per band in dB relative to the total, so they say where the energy is, not how loud it is. */
  bandsDb: { low: number; lowMid: number; mid: number; high: number; air: number };
  /** Distortion of a 110 Hz tone through the same board, harmonics 2-8 over the fundamental. */
  thdPercent: number;
  /**
   * How long a tone's sound lasts after the playing stops: ms until the level, measured in 10 ms windows, has
   * fallen 60 dB below what it was while playing (0 if it stops at once, capped at 6000).
   */
  tailMs: number;
}

const FFT = 4096;
const BANDS = {
  low: [20, 200],
  lowMid: [200, 800],
  mid: [800, 3000],
  high: [3000, 8000],
  air: [8000, 24000],
} as const;
const r2 = (v: number) => Math.round(v * 100) / 100;
const db = (ratio: number) => 20 * Math.log10(Math.max(ratio, 1e-6));

/** Average power spectrum over the whole signal, in linear power per bin. */
function meanPower(x: Float32Array): Float64Array {
  const sum = new Float64Array(FFT / 2);
  let frames = 0;
  for (let at = 0; at + FFT <= x.length; at += FFT) {
    const d = powerDb(x.subarray(at, at + FFT));
    for (let k = 0; k < FFT / 2; k++) sum[k] = (sum[k] ?? 0) + 10 ** ((d[k] ?? -120) / 10);
    frames++;
  }
  return sum.map((v) => v / Math.max(1, frames));
}

/** Loudness and spectral shape of a signal. */
export function spectralDescriptors(x: Float32Array, sampleRate: number) {
  let [sumSq, peak] = [0, 0];
  for (const v of x) {
    sumSq += v * v;
    peak = Math.max(peak, Math.abs(v));
  }
  const rms = Math.sqrt(sumSq / Math.max(1, x.length));
  const p = meanPower(x);
  const hz = sampleRate / FFT;
  const total = p.reduce((a, v, k) => (k > 0 ? a + v : a), 0);
  const silent = total < 1e-12; // the FFT adds a floor, so silence is not exactly zero
  let [centroid, acc, rolloff] = [0, 0, 0];
  p.forEach((v, k) => {
    if (k === 0) return;
    centroid += k * hz * v;
    acc += v;
    if (rolloff === 0 && acc >= 0.85 * total) rolloff = k * hz;
  });
  const band = ([lo, hi]: readonly [number, number]) =>
    p.reduce((a, v, k) => (k * hz >= lo && k * hz < hi ? a + v : a), 0);
  const rel = (b: readonly [number, number]) =>
    r2(10 * Math.log10(Math.max(band(b) / (total || 1), 1e-12)));
  return {
    rmsDb: r2(db(rms)),
    peakDb: r2(db(peak)),
    crestDb: r2(db(peak) - db(rms)),
    centroidHz: silent ? 0 : r2(centroid / total),
    rolloffHz: silent ? 0 : r2(rolloff),
    bandsDb: {
      low: rel(BANDS.low),
      lowMid: rel(BANDS.lowMid),
      mid: rel(BANDS.mid),
      high: rel(BANDS.high),
      air: rel(BANDS.air),
    },
  };
}

/** Total harmonic distortion in percent: harmonics 2-8 of `f0` against its fundamental. */
export function thdPercent(x: Float32Array, sampleRate: number, f0: number): number {
  const p = meanPower(x);
  const hz = sampleRate / FFT;
  const at = (f: number) => {
    const c = Math.round(f / hz);
    return p.slice(Math.max(1, c - 2), c + 3).reduce((a, v) => a + v, 0); // the Hann main lobe
  };
  let harmonics = 0;
  for (let n = 2; n <= 8 && n * f0 < sampleRate / 2; n++) harmonics += at(n * f0);
  return r2(100 * Math.sqrt(harmonics / Math.max(at(f0), 1e-30)));
}

const TONE_HZ = 110;
const TONE_LEVEL = 0.25;
const TAIL_MAX_S = 6;

/** Time after `tone` ends for the sound in `after` to fall 60 dB below its level at the end of the tone. */
export function tailMs(played: Float32Array, after: Float32Array, sampleRate: number): number {
  const rms = (x: Float32Array) =>
    Math.sqrt(x.reduce((a, v) => a + v * v, 0) / Math.max(1, x.length));
  const ref = rms(played.subarray(played.length - sampleRate / 10));
  if (ref < 1e-6) return 0;
  const win = Math.round(sampleRate / 100);
  let last = -1;
  for (let w = 0; (w + 1) * win <= after.length; w++)
    if (rms(after.subarray(w * win, (w + 1) * win)) >= ref * 1e-3) last = w;
  return (last + 1) * 10;
}

/** Describe what `board` did: spectral descriptors of its `output`, and its response to a fresh tone. */
export function describeBoard(
  wasm: WebAssembly.Module,
  board: Board,
  output: Float32Array,
  sampleRate = 48000,
  registry: Record<string, ModuleDef> = MODULES,
): Descriptors {
  // one second of tone, then silence for the tail
  const tone = new Float32Array(sampleRate * (1 + TAIL_MAX_S));
  for (let i = 0; i < sampleRate; i++)
    tone[i] = TONE_LEVEL * Math.sin((2 * Math.PI * TONE_HZ * i) / sampleRate);
  const heard = renderBoard(wasm, board, tone, sampleRate, registry);
  const played = heard.subarray(0, sampleRate);
  return {
    ...spectralDescriptors(output, sampleRate),
    thdPercent: thdPercent(played.subarray(sampleRate / 2), sampleRate, TONE_HZ),
    tailMs: tailMs(played, heard.subarray(sampleRate), sampleRate),
  };
}
