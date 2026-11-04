import { describe, expect, it } from "vitest";
import { type Preset, validatePreset } from "./preset";

const known = new Set(["overdrive@1"]);
const good: Preset = {
  schema: 1,
  id: "crunch",
  name: "Crunch",
  description: "Edge-of-breakup crunch.",
  tags: ["genre:blues", "warm"],
  rev: 0,
  slots: [{ id: "a", module: "overdrive@1", bypass: false, params: {} }],
};
const errors = (p: unknown) => {
  const r = validatePreset(p, known);
  return r.ok ? [] : r.errors.join("; ");
};

describe("validatePreset", () => {
  it("accepts a good preset", () => {
    expect(validatePreset(good, known).ok).toBe(true);
  });
  it.each([
    ["no tags", { tags: [] }, /tags/],
    ["an uppercase tag", { tags: ["Blues"] }, /Blues/],
    ["a tag with a space", { tags: ["warm tone"] }, /warm tone/],
    ["a duplicate tag", { tags: ["warm", "warm"] }, /duplicates/],
    ["too many tags", { tags: Array.from({ length: 17 }, (_, i) => `t${i}`) }, /1 to 16/],
    ["no description", { description: "" }, /description/],
    ["an unknown module", { slots: [{ ...good.slots[0], module: "nope@1" }] }, /nope@1/],
  ])("rejects %s", (_n, change, re) => {
    expect(errors({ ...good, ...change })).toMatch(re);
  });
});
