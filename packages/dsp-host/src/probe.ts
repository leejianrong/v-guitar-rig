import { BLOCK } from "./chain";
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
