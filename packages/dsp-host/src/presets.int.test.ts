import { readFileSync } from "node:fs";
import { testClip, validatePreset } from "@rig/shared";
import { describe, expect, it } from "vitest";
import { describeBoard } from "./describe";
import { renderRiff } from "./guitar";
import { measureLoudness } from "./loudness";
import { KNOWN_MODULES } from "./modules";
import { STARTER_PRESETS } from "./presets";
import { renderBoard } from "./render";
import { STARTER_RIFFS } from "./riffs";

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

  // Headroom is checked at guitar level on the riffs (below); the test clip is much hotter than a guitar.
  it.each(measured)("$p.id renders finite and loud enough to hear", ({ out, d }) => {
    expect(out.every(Number.isFinite)).toBe(true);
    expect(d.rmsDb).toBeGreaterThan(-30);
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

describe("preset loudness", () => {
  it("is within 1 LU of -16 LUFS on the shipped riffs for every preset, without clipping", () => {
    const clips = STARTER_RIFFS.map((r) => renderRiff(r, 48000, 1.5));
    const means = STARTER_PRESETS.map((p) => {
      const board = { schema: 1 as const, id: p.id, name: p.name, rev: 0, slots: p.slots };
      const l = clips.map((c) => measureLoudness(renderBoard(wasm, board, c), 48000));
      const mean = l.reduce((a, x) => a + x.integrated, 0) / l.length;
      expect(Math.abs(mean + 16), `${p.id} reads ${mean.toFixed(1)} LUFS`).toBeLessThan(1);
      expect(Math.max(...l.map((x) => x.peak)), `${p.id} peak`).toBeLessThan(-1);
      return mean;
    });
    // before levelling the presets spanned 24 LU
    expect(Math.max(...means) - Math.min(...means)).toBeLessThan(2);
  });
});
