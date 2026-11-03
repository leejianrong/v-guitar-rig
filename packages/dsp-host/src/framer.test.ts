import { describe, expect, it } from "vitest";
import { BLOCK, Chain } from "./chain";
import { Framer } from "./framer";

const wasm = {} as WebAssembly.Module; // behavioral modules never touch it
const slots = [
  { id: "a", module: "overdrive@1", bypass: false, params: {} },
  { id: "b", module: "fuzz@1", bypass: false, params: {} },
  { id: "c", module: "delay@1", bypass: false, params: {} },
];
const sine = Float32Array.from(
  { length: BLOCK * 32 },
  (_, i) => 0.5 * Math.sin((2 * Math.PI * 110 * i) / 48000),
);

/** Run the chain; with `size` set, also frame the input and output of slot `k`, as the worklet does. */
function run(board: typeof slots, k?: number, size = BLOCK * 4) {
  const chain = new Chain(wasm);
  chain.setSlots(board);
  const [before, after] = [new Framer(size), new Framer(size)];
  const frames: { before: Float32Array; after: Float32Array }[] = [];
  const out = new Float32Array(sine.length);
  const o = new Float32Array(BLOCK);
  for (let at = 0; at < sine.length; at += BLOCK) {
    chain.process(sine.subarray(at, at + BLOCK), o);
    out.set(o, at);
    if (k === undefined) continue;
    const b = before.push(chain.taps[k] as Float32Array);
    const a = after.push(chain.taps[k + 1] as Float32Array);
    if (b && a) frames.push({ before: b, after: a });
  }
  return { out, frames };
}

describe("Framer", () => {
  it("returns a frame only when full, then starts a fresh one", () => {
    const f = new Framer(4);
    expect(f.push(Float32Array.of(1, 2))).toBeNull();
    expect(Array.from(f.push(Float32Array.of(3, 4)) ?? [])).toEqual([1, 2, 3, 4]);
    expect(f.push(Float32Array.of(5, 6))).toBeNull();
  });

  it("frames the selected pedal's input and output, wherever it sits", () => {
    for (const k of [0, 1, 2]) {
      const { frames } = run(slots, k);
      const into = run(slots.slice(0, k)).out; // everything before pedal k
      const outOf = run(slots.slice(0, k + 1)).out; // ... and through it
      const first = frames[0];
      expect(first?.before).toEqual(into.subarray(0, first?.before.length));
      expect(first?.after).toEqual(outOf.subarray(0, first?.after.length));
    }
  });

  it("does not change the board's output", () => {
    expect(run(slots, 1).out).toEqual(run(slots).out);
  });
});
