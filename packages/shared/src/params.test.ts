import { describe, expect, it } from "vitest";
import { knobToValue, type ParamSpec } from "./params";

const base: ParamSpec = {
  id: "gain",
  label: "Gain",
  min: 1,
  max: 100,
  default: 10,
  unit: "x",
  taper: "linear",
};

describe("knobToValue", () => {
  it.each(["linear", "log", "audio"] as const)("%s taper hits the range ends", (taper) => {
    const spec = { ...base, taper };
    expect(knobToValue(spec, 0)).toBeCloseTo(spec.min);
    expect(knobToValue(spec, 1)).toBeCloseTo(spec.max);
  });

  it.each(["linear", "log", "audio"] as const)("%s taper is monotonic", (taper) => {
    const spec = { ...base, taper };
    let prev = Number.NEGATIVE_INFINITY;
    for (let i = 0; i <= 20; i++) {
      const v = knobToValue(spec, i / 20);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("clamps out-of-range positions", () => {
    expect(knobToValue(base, -3)).toBeCloseTo(base.min);
    expect(knobToValue(base, 7)).toBeCloseTo(base.max);
  });
});
