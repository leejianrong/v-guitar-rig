import { describe, expect, it } from "vitest";
import { MODULES, type ModuleDef } from "./modules";
import { measureTransfer } from "./probe";

const wasm = {} as WebAssembly.Module;
const synthetic = (shape: (x: number, g: number) => number): ModuleDef => ({
  id: "t@1",
  name: "t",
  category: "drive",
  description: "",
  params: [{ id: "gain", label: "Gain", min: 1, max: 100, default: 4, unit: "x", taper: "log" }],
  create: () => ({
    process(input, output, p) {
      for (let i = 0; i < input.length; i++) output[i] = shape(input[i] ?? 0, p.gain ?? 1);
    },
  }),
});

describe("measureTransfer", () => {
  it("a hard clipper flattens at its clip level, within 1 dB", () => {
    const clip = 0.5;
    const hard = synthetic((x, g) => Math.max(-clip, Math.min(clip, x * g)));
    const curve = measureTransfer(hard, wasm, { gain: 4 });
    const top = curve[curve.length - 1];
    expect(top?.outDb).toBeGreaterThan(20 * Math.log10(clip) - 1);
    expect(top?.outDb).toBeLessThan(20 * Math.log10(clip) + 1);
    expect(curve[0]?.outDb).toBeCloseTo(-60 + 20 * Math.log10(4), 0); // linear below the knee
  });

  it("a linear gain stage is a straight line of slope one", () => {
    const lin = measureTransfer(
      synthetic((x, g) => x * g),
      wasm,
      { gain: 2 },
    );
    for (const pt of lin) expect(pt.outDb - pt.inDb).toBeCloseTo(20 * Math.log10(2), 0);
  });

  it("uses the given parameters, and defaults for those not given", () => {
    const def = synthetic((x, g) => x * g);
    const at = (p: Record<string, number>) => measureTransfer(def, wasm, p)[0]?.outDb ?? 0;
    expect(at({ gain: 10 }) - at({})).toBeCloseTo(20 * Math.log10(10 / 4), 0);
  });

  it("shows the fuzz pedal compressing: loud inputs gain far less than quiet ones", () => {
    const fuzz = MODULES["fuzz@1"];
    if (!fuzz) throw new Error("fuzz missing");
    const c = measureTransfer(fuzz, wasm, {});
    const gain = (i: number) => (c[i]?.outDb ?? 0) - (c[i]?.inDb ?? 0);
    expect(gain(0) - gain(c.length - 1)).toBeGreaterThan(15);
  });
});
