import type { Slot } from "@rig/shared";
import { describe, expect, it } from "vitest";
import { BLOCK, Chain, FADE_MS, SMOOTH_MS } from "./chain";
import { MODULES, type ModuleDef } from "./modules";

const wasm = {} as WebAssembly.Module; // behavioral modules never touch it
const slot = (
  id: string,
  module: string,
  params: Record<string, number> = {},
  bypass = false,
): Slot => ({
  id,
  module,
  bypass,
  params,
});

const sine = (n: number, amp = 0.5) =>
  Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * 110 * i) / 48000));

/** Run `chain` over `input`, calling `at(blockIndex)` before each block. */
function run(chain: Chain, input: Float32Array, at: (b: number) => void = () => {}): Float32Array {
  const out = new Float32Array(input.length);
  const o = new Float32Array(BLOCK);
  for (let b = 0; b * BLOCK < input.length; b++) {
    at(b);
    chain.process(input.subarray(b * BLOCK, (b + 1) * BLOCK), o);
    out.set(o, b * BLOCK);
  }
  return out;
}

const maxStep = (x: Float32Array, from = 1, to = x.length) => {
  let m = 0;
  for (let i = from; i < to; i++) m = Math.max(m, Math.abs((x[i] ?? 0) - (x[i - 1] ?? 0)));
  return m;
};

const probe: ModuleDef = {
  id: "probe@1",
  name: "Probe",
  category: "drive",
  description: "outputs its param",
  params: [{ id: "v", label: "V", min: 0, max: 1, default: 0, unit: "", taper: "linear" }],
  create: () => ({
    process: (_i, o, p) => {
      o.fill(p.v ?? 0);
    },
  }),
};

describe("parameter smoothing", () => {
  it(`gets within 1% of the target in 50 ms (time constant ${SMOOTH_MS} ms)`, () => {
    const c = new Chain(wasm, 48000, { "probe@1": probe });
    c.setSlots([slot("a", "probe@1", { v: 0 })]);
    const blk = new Float32Array(BLOCK);
    c.process(blk, blk);
    c.setSlots([slot("a", "probe@1", { v: 1 })]);
    let last = 0;
    const blocks = Math.ceil((0.05 * 48000) / BLOCK);
    for (let b = 0; b < blocks; b++) {
      c.process(blk, blk);
      last = blk[BLOCK - 1] ?? 0;
    }
    expect(last).toBeGreaterThan(0.99);
  });

  it("clamps a parameter into its declared range", () => {
    const c = new Chain(wasm, 48000, { "probe@1": probe });
    c.setSlots([slot("a", "probe@1", { v: 99 })]);
    const blk = new Float32Array(BLOCK);
    c.process(blk, blk);
    expect(blk[0]).toBe(1);
  });
});

describe("structural changes", () => {
  const board = (order: string[], bypassFuzz = false): Slot[] =>
    order.map((m) => slot(m, `${m}@1`, {}, m === "fuzz" && bypassFuzz));

  it("reordering mid-stream adds no click above -40 dBFS", () => {
    const input = sine(48000);
    const baseline = run(
      (() => {
        const c = new Chain(wasm);
        c.setSlots(board(["overdrive", "fuzz"]));
        return c;
      })(),
      input,
    );
    const c = new Chain(wasm);
    c.setSlots(board(["overdrive", "fuzz"]));
    const out = run(c, input, (b) => b === 200 && c.setSlots(board(["fuzz", "overdrive"])));
    const swap = [200 * BLOCK, 200 * BLOCK + 10 * BLOCK] as const;
    expect(maxStep(out, swap[0], swap[1])).toBeLessThanOrEqual(maxStep(baseline) + 0.01);
  });

  it("toggling bypass adds no click above -40 dBFS", () => {
    const input = sine(48000);
    const c = new Chain(wasm);
    c.setSlots(board(["overdrive", "fuzz"]));
    const out = run(c, input, (b) => b === 200 && c.setSlots(board(["overdrive", "fuzz"], true)));
    const base = run(
      (() => {
        const x = new Chain(wasm);
        x.setSlots(board(["overdrive", "fuzz"]));
        return x;
      })(),
      input,
    );
    expect(maxStep(out, 200 * BLOCK, 210 * BLOCK)).toBeLessThanOrEqual(maxStep(base) + 0.01);
  });

  it(`the change lands within ${FADE_MS * 2 + 6} ms`, () => {
    const c = new Chain(wasm);
    c.setSlots([slot("o", "overdrive@1")]);
    const input = sine(BLOCK * 188);
    const out = run(c, input, (b) => b === 50 && c.setSlots([slot("o", "overdrive@1", {}, true)]));
    // after fade-out and fade-in the bypassed slot passes the input through exactly
    const settled = 50 * BLOCK + Math.ceil(((FADE_MS * 2 + 6) / 1000) * 48000);
    expect(out[settled + 10]).toBeCloseTo(input[settled + 10] ?? 0, 6);
  });
});

describe("fault isolation (ADR-0004)", () => {
  const bomb = (mode: "throw" | "nan"): ModuleDef => ({
    ...probe,
    id: "bomb@1",
    create: () => ({
      process: (_i, o) => {
        if (mode === "throw") throw new Error("boom");
        o.fill(Number.NaN);
      },
    }),
  });

  it.each(["throw", "nan"] as const)(
    "a module that %ss is bypassed and reported, audio keeps flowing",
    (mode) => {
      const c = new Chain(wasm, 48000, { "bomb@1": bomb(mode) });
      c.setSlots([slot("x", "bomb@1")]);
      const input = sine(BLOCK * 4);
      const out = run(c, input);
      expect(c.faults[0]?.slotId).toBe("x");
      expect(out.every(Number.isFinite)).toBe(true);
      expect(out[BLOCK * 3 + 5]).toBeCloseTo(input[BLOCK * 3 + 5] ?? 0, 6);
    },
  );

  it("an unknown module id is a fault, not a crash", () => {
    const c = new Chain(wasm, 48000, {});
    c.setSlots([slot("x", "nope@1")]);
    run(c, sine(BLOCK));
    expect(c.faults[0]?.message).toMatch(/registry/);
  });
});

describe("starter pedals pass the stability gate", () => {
  const stimuli: Record<string, (n: number) => Float32Array> = {
    impulse: (n) => Float32Array.from({ length: n }, (_, i) => (i === 0 ? 1 : 0)),
    noise: (n) => Float32Array.from({ length: n }, (_, i) => Math.sin(i * 12.9898) * 0.9),
    "full-scale square": (n) =>
      Float32Array.from({ length: n }, (_, i) => (Math.floor(i / 60) % 2 ? 1 : -1)),
    dc: (n) => new Float32Array(n).fill(1),
  };
  for (const id of Object.keys(MODULES).filter((m) => m !== "diode-clipper@1")) {
    it.each(Object.keys(stimuli))(`${id} stays finite and bounded on %s`, (name) => {
      const c = new Chain(wasm);
      c.setSlots([slot("m", id)]);
      const out = run(c, (stimuli[name] as (n: number) => Float32Array)(BLOCK * 400));
      expect(c.faults).toEqual([]);
      expect(Math.max(...out.map(Math.abs))).toBeLessThan(8);
    });
  }
});
