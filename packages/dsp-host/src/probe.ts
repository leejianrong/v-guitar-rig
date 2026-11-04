import { BLOCK } from "./chain";
import { powerDb } from "./fft";
import type { ModuleDef } from "./modules";

export interface CurvePoint {
  /** Peak level of the 1 kHz test sine going in, dB re full scale. */
  inDb: number;
  /** Peak level coming out once settled. */
  outDb: number;
}

const SETTLE_BLOCKS = 4;
const MEASURE_BLOCKS = 4;
const db = (peak: number) => 20 * Math.log10(Math.max(peak, 1e-6));

/**
 * Transfer curve of one module at the given parameters: output peak against input peak for a 1 kHz sine,
 * from `fromDb` to `toDb`. It runs on a fresh instance of the module, never the live one, so measuring
 * cannot disturb what is playing.
 */
export function measureTransfer(
  def: ModuleDef,
  wasm: WebAssembly.Module,
  params: Readonly<Record<string, number>>,
  { sampleRate = 48000, points = 24, fromDb = -60, toDb = 6 } = {},
): CurvePoint[] {
  const proc = def.create(sampleRate, wasm);
  const p = Object.fromEntries(def.params.map((s) => [s.id, params[s.id] ?? s.default]));
  const [inp, out] = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
  let n = 0;
  return Array.from({ length: points }, (_, k) => {
    const inDb = fromDb + ((toDb - fromDb) * k) / (points - 1);
    const amp = 10 ** (inDb / 20);
    let peak = 0;
    for (let b = 0; b < SETTLE_BLOCKS + MEASURE_BLOCKS; b++) {
      for (let i = 0; i < BLOCK; i++)
        inp[i] = amp * Math.sin((2 * Math.PI * 1000 * n++) / sampleRate);
      proc.process(inp, out, p);
      if (b >= SETTLE_BLOCKS) for (const y of out) peak = Math.max(peak, Math.abs(y));
    }
    return { inDb, outDb: db(peak) };
  });
}

export interface ResponsePoint {
  hz: number;
  /** Gain at this frequency in dB (output level over input level). */
  db: number;
}

/**
 * Small-signal frequency response: seeded white noise at `noiseDb` rms through a fresh instance of the
 * module, as the ratio of output to input power per FFT bin, summed over several segments. The level is
 * low on purpose, so a drive pedal is measured before it clips (the transfer curve shows the rest).
 */
export function measureResponse(
  def: ModuleDef,
  wasm: WebAssembly.Module,
  params: Readonly<Record<string, number>>,
  { sampleRate = 48000, noiseDb = -40, segments = 6 } = {},
): ResponsePoint[] {
  const SEG = 4096;
  const proc = def.create(sampleRate, wasm);
  const p = Object.fromEntries(def.params.map((s) => [s.id, params[s.id] ?? s.default]));
  const rms = 10 ** (noiseDb / 20);
  let seed = 12345;
  const noise = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed / 2 ** 32 - 0.5) * 2 * Math.sqrt(3) * rms; // uniform, unit variance times rms
  };
  const [inp, out] = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
  const run = () => {
    const [a, b] = [new Float32Array(SEG), new Float32Array(SEG)];
    for (let at = 0; at < SEG; at += BLOCK) {
      for (let i = 0; i < BLOCK; i++) inp[i] = noise();
      proc.process(inp, out, p);
      a.set(inp, at);
      b.set(out, at);
    }
    return [powerDb(a), powerDb(b)] as const;
  };
  run(); // settle
  const sumIn = new Float64Array(SEG / 2);
  const sumOut = new Float64Array(SEG / 2);
  for (let s = 0; s < segments; s++) {
    const [a, b] = run();
    for (let k = 0; k < SEG / 2; k++) {
      sumIn[k] = (sumIn[k] ?? 0) + 10 ** ((a[k] ?? 0) / 10);
      sumOut[k] = (sumOut[k] ?? 0) + 10 ** ((b[k] ?? 0) / 10);
    }
  }
  return Array.from({ length: SEG / 2 - 1 }, (_, i) => ({
    hz: ((i + 1) * sampleRate) / SEG,
    db: 10 * Math.log10(((sumOut[i + 1] ?? 0) + 1e-30) / ((sumIn[i + 1] ?? 0) + 1e-30)),
  }));
}

/** Where the response, past its peak, has fallen 3 dB: the cutoff of a low-pass. Null if it never does. */
export function rolloffHz(curve: ResponsePoint[]): number | null {
  let peak = 0;
  curve.forEach((c, i) => {
    if (c.db > (curve[peak]?.db ?? Number.NEGATIVE_INFINITY)) peak = i;
  });
  const floor = (curve[peak]?.db ?? 0) - 3;
  return curve.slice(peak).find((c) => c.db <= floor)?.hz ?? null;
}
