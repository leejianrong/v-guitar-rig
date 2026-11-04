import { readFileSync } from "node:fs";
import { applyTone, testClip } from "@rig/shared";
import { describe, expect, it } from "vitest";
import { describeBoard } from "./describe";
import { STARTER_PRESETS } from "./presets";
import { renderBoard } from "./render";

const wasm = new WebAssembly.Module(
  readFileSync(
    new URL("../../../target/wasm32-unknown-unknown/release/rig_core.wasm", import.meta.url),
  ),
);
const hear = (slots: (typeof STARTER_PRESETS)[number]["slots"]) => {
  const board = { schema: 1 as const, id: "t", name: "t", rev: 0, slots };
  return describeBoard(wasm, board, renderBoard(wasm, board, testClip(96000)));
};

describe('"more spacey" on every starter preset', () => {
  // Measured: the tail grew by 1010 ms or more (to the 6000 ms cap) on all twelve; the loudest gain in
  // peak was 4.7 dB (haze-wall), so those are the limits asserted, with a little room.
  it.each(STARTER_PRESETS)(
    "$id: tail rises by 1 s (or is already at the cap), peak stays under +6 dBFS",
    (p) => {
      const [before, after] = [hear(p.slots), hear(applyTone(p.slots, "spacier"))];
      expect(after.tailMs).toBeGreaterThanOrEqual(Math.min(before.tailMs + 1000, 6000));
      expect(after.peakDb).toBeLessThan(6);
      expect(after.peakDb - before.peakDb).toBeLessThan(5);
    },
  );

  it("is capped: repeated use never pushes a knob past its documented maximum", () => {
    let slots = STARTER_PRESETS[2]?.slots ?? [];
    for (let i = 0; i < 10; i++) slots = applyTone(slots, "spacier");
    expect(slots.find((s) => s.module === "delay@1")?.params.feedback).toBe(0.85);
    expect(slots.find((s) => s.module === "reverb@1")?.params.mix).toBe(0.8);
  });
});
