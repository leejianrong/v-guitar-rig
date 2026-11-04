import { readFileSync } from "node:fs";
import { testClip, validatePreset } from "@rig/shared";
import { describe, expect, it } from "vitest";
import { describeBoard } from "./describe";
import { KNOWN_MODULES } from "./modules";
import { STARTER_PRESETS } from "./presets";
import { renderBoard } from "./render";

const wasm = new WebAssembly.Module(
  readFileSync(
    new URL("../../../target/wasm32-unknown-unknown/release/rig_core.wasm", import.meta.url),
  ),
);

const measured = STARTER_PRESETS.map((p) => {
  const board = { schema: 1 as const, id: p.id, name: p.name, rev: 0, slots: p.slots };
  const out = renderBoard(wasm, board, testClip(96000));
  return { p, out, d: describeBoard(wasm, board, out) };
});

describe("starter presets", () => {
  it("are twelve, valid, uniquely named, and free of brand names", () => {
    expect(STARTER_PRESETS).toHaveLength(12);
    expect(new Set(STARTER_PRESETS.map((p) => p.id)).size).toBe(12);
    for (const p of STARTER_PRESETS) {
      const v = validatePreset(p, KNOWN_MODULES);
      expect(v.ok, p.id).toBe(true);
      expect(`${p.name} ${p.description}`).not.toMatch(
        /fender|marshall|vox|boss|ibanez|mesa|orange|tube screamer|big muff|strat|les paul/i,
      );
    }
  });

  it.each(measured)("$p.id renders finite and below full scale", ({ out, d }) => {
    expect(out.every(Number.isFinite)).toBe(true);
    expect(d.peakDb).toBeLessThanOrEqual(0);
    expect(d.rmsDb).toBeGreaterThan(-30); // loud enough to hear
  });

  // The thresholds come from the measured set: every clean preset reads at most 15.5% THD, every
  // distorted one at least 18.6%; the bright ones have a centroid of 211 Hz or more, the dark one 124 Hz.
  it.each(measured)("$p.id tags agree with what it measures", ({ p, d }) => {
    const has = (t: string) => p.tags.includes(t);
    if (has("clean")) expect(d.thdPercent).toBeLessThanOrEqual(17);
    if (has("crunch") || has("high-gain") || has("fuzz"))
      expect(d.thdPercent).toBeGreaterThanOrEqual(18);
    if (has("bright")) expect(d.centroidHz).toBeGreaterThanOrEqual(185);
    if (has("dark")) expect(d.centroidHz).toBeLessThanOrEqual(130);
    if (has("clean")) expect(has("crunch") || has("high-gain") || has("fuzz")).toBe(false);
  });
});
