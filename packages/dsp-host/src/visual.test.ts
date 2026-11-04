import { describe, expect, it } from "vitest";
import { BLOCK } from "./chain";
import { MODULES, type ModuleDef } from "./modules";

const wasm = {} as WebAssembly.Module;
const def = (id: string) => MODULES[id] as ModuleDef;

/** Feed `input` through a fresh instance block by block. */
function render(m: ModuleDef, p: Record<string, number>, input: Float32Array) {
  const proc = m.create(48000, wasm);
  const out = new Float32Array(input.length);
  const o = new Float32Array(BLOCK);
  const full = Object.fromEntries(m.params.map((s) => [s.id, p[s.id] ?? s.default]));
  for (let at = 0; at < input.length; at += BLOCK) {
    proc.process(input.subarray(at, at + BLOCK), o, full);
    out.set(o, at);
  }
  return out;
}

describe("delay visual", () => {
  it("lists taps at multiples of the time with levels falling by the feedback", () => {
    const v = def("delay@1").visual?.({ time: 380, feedback: 0.4, mix: 0.3 });
    if (v?.kind !== "echoes") throw new Error("expected echoes");
    expect(v.taps.slice(0, 3).map((t) => Math.round(t.ms))).toEqual([380, 760, 1140]);
    expect(v.taps[0]?.level).toBeCloseTo(0.3, 5);
    expect(v.taps[1]?.level).toBeCloseTo(0.12, 5);
    expect(v.taps.at(-1)?.level).toBeGreaterThanOrEqual(0.01); // inaudible ones are dropped
  });

  it("is true to the sound: an impulse through the real delay echoes where the taps say", () => {
    const p = { time: 100, feedback: 0.5, mix: 0.6 };
    const x = new Float32Array(48000);
    x[0] = 1;
    const y = render(def("delay@1"), p, x);
    const v = def("delay@1").visual?.(p);
    if (v?.kind !== "echoes") throw new Error("expected echoes");
    for (const t of v.taps.slice(0, 4)) {
      const at = Math.round((t.ms / 1000) * 48000);
      expect(y[at]).toBeCloseTo(t.level, 2);
    }
  });
});

describe("chorus visual", () => {
  it("is true to the sound: the swept delay stays inside the declared range and uses all of it", () => {
    const p = { rate: 4, depth: 1, mix: 1 };
    const v = def("chorus@1").visual?.(p);
    if (v?.kind !== "sweep") throw new Error("expected sweep");
    expect(v.rateHz).toBe(4);
    const spacing = 1000; // an impulse every 1000 samples; the wet copy lands 6-18 ms (288-864 samples) after
    const x = new Float32Array(48000);
    for (let i = 0; i < x.length; i += spacing) x[i] = 1;
    const y = render(def("chorus@1"), p, x);
    const delays: number[] = [];
    for (let i = 0; i < x.length - spacing; i += spacing) {
      let best = 100; // skip the dry copy at 0
      for (let k = 100; k < spacing; k++) if ((y[i + k] ?? 0) > (y[i + best] ?? 0)) best = k;
      delays.push((best / 48000) * 1000);
    }
    expect(Math.min(...delays)).toBeGreaterThan(v.minMs - 0.1);
    expect(Math.min(...delays)).toBeLessThan(v.minMs + 1);
    expect(Math.max(...delays)).toBeLessThan(v.maxMs + 0.1);
    expect(Math.max(...delays)).toBeGreaterThan(v.maxMs - 1);
  });

  it("narrows the sweep as depth falls", () => {
    const v = def("chorus@1").visual?.({ rate: 1, depth: 0 });
    expect(v).toEqual({ kind: "sweep", rateHz: 1, minMs: 12, maxMs: 12 });
  });
});
