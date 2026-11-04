import { describe, expect, it } from "vitest";
import { amp } from "./amp";
import { cab, cabIr } from "./cab";
import { BLOCK } from "./chain";
import { Convolver, irSpectra } from "./convolver";
import { spectralDescriptors } from "./describe";

const SR = 48000;
const wasm = {} as WebAssembly.Module;
const white = (n: number, seed = 1) => {
  let s = seed;
  return Float32Array.from({ length: n }, () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s / 2 ** 32 - 0.5) * 1.6;
  });
};

function convolve(c: Convolver, x: Float32Array): Float32Array {
  const out = new Float32Array(x.length);
  const o = new Float32Array(BLOCK);
  for (let at = 0; at + BLOCK <= x.length; at += BLOCK) {
    c.process(x.subarray(at, at + BLOCK), o);
    out.set(o, at);
  }
  return out;
}

describe("partitioned convolution", () => {
  const ir = cabIr(2, SR);
  it("turns an impulse into the impulse response, within 1e-6", () => {
    const impulse = new Float32Array(BLOCK * 12);
    impulse[0] = 1;
    const out = convolve(new Convolver(irSpectra(ir, BLOCK), BLOCK), impulse);
    let worst = 0;
    for (let i = 0; i < ir.length; i++)
      worst = Math.max(worst, Math.abs((out[i] ?? 0) - (ir[i] ?? 0)));
    expect(worst).toBeLessThan(1e-6);
    expect(Math.max(...out.subarray(ir.length).map(Math.abs))).toBeLessThan(1e-6); // and nothing after it
  });

  it("matches a direct convolution of a long signal, block by block", () => {
    const x = white(BLOCK * 60);
    const out = convolve(new Convolver(irSpectra(ir, BLOCK), BLOCK), x);
    let worst = 0;
    for (let n = 0; n < x.length; n += 7) {
      let direct = 0;
      for (let k = 0; k < ir.length && k <= n; k++) direct += (ir[k] ?? 0) * (x[n - k] ?? 0);
      worst = Math.max(worst, Math.abs(direct - (out[n] ?? 0)));
    }
    expect(worst).toBeLessThan(1e-5);
  });
});

describe("speaker cab", () => {
  const play = (mod: typeof amp, x: Float32Array, params: Record<string, number> = {}) => {
    const proc = mod.create(SR, wasm);
    const p = { ...Object.fromEntries(mod.params.map((q) => [q.id, q.default])), ...params };
    const out = new Float32Array(x.length);
    const o = new Float32Array(BLOCK);
    for (let at = 0; at + BLOCK <= x.length; at += BLOCK) {
      proc.process(x.subarray(at, at + BLOCK), o, p);
      out.set(o, at);
    }
    return out;
  };

  it("has unit gain at 1 kHz for every voicing", () => {
    for (let i = 0; i < 4; i++) {
      const tone = Float32Array.from(
        { length: SR },
        (_, n) => 0.5 * Math.sin((2 * Math.PI * 1000 * n) / SR),
      );
      const out = play(cab, tone, { cab: i });
      const tail = out.subarray(SR / 2);
      const rms = Math.sqrt(tail.reduce((a, v) => a + v * v, 0) / tail.length);
      expect(rms / (0.5 / Math.SQRT2)).toBeCloseTo(1, 1);
    }
  });

  it("takes the fizz off a driven amp: its rolloff is lower than the amp alone", () => {
    const driven = play(amp, white(SR * 2), { gain: 60 });
    const bare = spectralDescriptors(driven, SR).rolloffHz;
    const cabbed = spectralDescriptors(play(cab, driven), SR).rolloffHz;
    expect(cabbed).toBeLessThan(bare * 0.7);
  });

  it("changing cab mid-stream adds no step larger than the signal's own", () => {
    const x = white(BLOCK * 400);
    const proc = cab.create(SR, wasm);
    const o = new Float32Array(BLOCK);
    const out = new Float32Array(x.length);
    for (let b = 0; b < 400; b++) {
      proc.process(x.subarray(b * BLOCK, (b + 1) * BLOCK), o, { cab: b < 200 ? 0 : 2, level: 1 });
      out.set(o, b * BLOCK);
    }
    const step = (from: number, to: number) => {
      let m = 0;
      for (let i = from + 1; i < to; i++)
        m = Math.max(m, Math.abs((out[i] ?? 0) - (out[i - 1] ?? 0)));
      return m;
    };
    expect(step(200 * BLOCK, 210 * BLOCK)).toBeLessThanOrEqual(
      step(100 * BLOCK, 110 * BLOCK) * 1.5,
    );
  });

  it("amp plus cab leaves at least 4x real-time headroom", () => {
    const x = white(BLOCK * 500);
    const run = () => {
      const [a, c] = [amp.create(SR, wasm), cab.create(SR, wasm)];
      const [m, o] = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
      const [pa, pc] = [
        { gain: 30, bass: 0.5, mid: 0.5, treble: 0.5, sag: 0.3, master: 1 },
        { cab: 1, level: 1 },
      ];
      const t0 = performance.now();
      for (let b = 0; b < 500; b++) {
        a.process(x.subarray(b * BLOCK, (b + 1) * BLOCK), m, pa);
        c.process(m, o, pc);
      }
      return performance.now() - t0;
    };
    const best = Math.min(run(), run(), run());
    const headroom = (((500 * BLOCK) / SR) * 1000) / best;
    console.log(`amp + cab: ${headroom.toFixed(0)}x real time`);
    expect(headroom).toBeGreaterThan(4);
  });
});
