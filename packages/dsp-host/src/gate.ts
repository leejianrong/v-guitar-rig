import { BLOCK } from "./chain";
import type { ModuleDef } from "./modules";

export type GateResult = { ok: true } | { ok: false; reason: string };

const SR = 48000;
const BLOCKS = 400; // just over a second per probe signal; divisible by 4 for the quarters below
const MAX_PEAK = 8; // +18 dB over full scale: generous for a pedal, far short of runaway
const GROWTH = 4; // loudness may not more than quadruple between the middle and the end of a signal
const CPU_SHARE = 0.5; // a block may take at most half its real-time duration, on average

type Signal = (n: number) => number;
const noiseFrom = () => {
  let s = 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 31 - 1;
  };
};
const SIGNALS: Record<string, () => Signal> = {
  impulse: () => (n) => (n === 0 ? 1 : 0),
  noise: () => {
    const r = noiseFrom();
    return () => 0.5 * r();
  },
  "full-scale square": () => (n) => (Math.floor(n / 218) % 2 === 0 ? 1 : -1), // about 110 Hz
  dc: () => () => 0.5,
};

const rms = (a: Float32Array) =>
  Math.sqrt(a.reduce((s, v) => s + v * v, 0) / Math.max(1, a.length));

/**
 * The ADR-0004 safety gate: a module may be put on a board only if, with its knobs at default, all
 * minimum and all maximum, it stays finite and bounded on an impulse, noise, a full-scale square and DC,
 * does not grow without limit, and runs within its CPU share. Like `compileModule`, this executes the
 * module, so run it in the sandboxed worker.
 */
export function gateModule(
  def: ModuleDef,
  wasm: WebAssembly.Module,
  now: () => number = () => performance.now(),
): GateResult {
  const settings: Record<string, Record<string, number>> = {
    "default knobs": Object.fromEntries(def.params.map((p) => [p.id, p.default])),
    "all knobs at minimum": Object.fromEntries(def.params.map((p) => [p.id, p.min])),
    "all knobs at maximum": Object.fromEntries(def.params.map((p) => [p.id, p.max])),
  };
  let spent = 0;
  let blocks = 0;
  for (const [where, p] of Object.entries(settings)) {
    for (const [name, make] of Object.entries(SIGNALS)) {
      const fail = (why: string): GateResult => ({
        ok: false,
        reason: `${why} on ${name} with ${where}`,
      });
      try {
        const proc = def.create(SR, wasm);
        const [sig, inp, out] = [make(), new Float32Array(BLOCK), new Float32Array(BLOCK)];
        const tail = new Float32Array(BLOCK * (BLOCKS / 4));
        const mid = new Float32Array(BLOCK * (BLOCKS / 4));
        for (let b = 0; b < BLOCKS; b++) {
          for (let i = 0; i < BLOCK; i++) inp[i] = sig(b * BLOCK + i);
          const t0 = now();
          proc.process(inp, out, p);
          spent += now() - t0;
          blocks++;
          for (const y of out) {
            if (!Number.isFinite(y)) return fail("output is NaN or infinite");
            if (Math.abs(y) > MAX_PEAK) return fail(`output exceeds ${MAX_PEAK}x full scale`);
          }
          const k = b - BLOCKS / 2;
          if (k >= 0 && k < BLOCKS / 4) mid.set(out, k * BLOCK);
          const j = b - (BLOCKS * 3) / 4;
          if (j >= 0) tail.set(out, j * BLOCK);
        }
        const [m, t] = [rms(mid), rms(tail)];
        if (t > GROWTH * m && t > 0.05) return fail("output keeps growing");
      } catch (e) {
        return fail(
          `threw "${String((e as { message?: unknown } | null)?.message ?? e).slice(0, 200)}"`,
        );
      }
    }
  }
  const per = spent / blocks;
  const budget = (BLOCK / SR) * 1000 * CPU_SHARE;
  if (per > budget)
    return {
      ok: false,
      reason: `too slow: ${per.toFixed(2)} ms per block, budget ${budget.toFixed(2)} ms`,
    };
  return { ok: true };
}
