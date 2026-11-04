import { describe, expect, it } from "vitest";
import { MODULES, type ModuleDef } from "./modules";
import { measureResponse, measureTransfer, rolloffHz } from "./probe";

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

describe("measureResponse", () => {
  it("matches the analytic one-pole response of the overdrive tone control within 0.5 dB", () => {
    const od = MODULES["overdrive@1"] as ModuleDef;
    const [tone, drive, level, sr] = [3000, 6, 0.7, 48000];
    const curve = measureResponse(od, wasm, { tone, drive, level });
    const a = 1 - Math.exp((-2 * Math.PI * tone) / sr);
    const analytic = (hz: number) => {
      const w = (2 * Math.PI * hz) / sr;
      const den = Math.hypot(1 - (1 - a) * Math.cos(w), (1 - a) * Math.sin(w));
      return 20 * Math.log10((drive * level * a) / den);
    };
    for (const hz of [200, 1000, 3000, 6000, 10000]) {
      const pt = curve.reduce((b, c) => (Math.abs(c.hz - hz) < Math.abs(b.hz - hz) ? c : b));
      expect(Math.abs(pt.db - analytic(pt.hz))).toBeLessThan(0.5);
    }
  });

  it("reads a pure gain as a flat line at that gain", () => {
    const flat = measureResponse(
      synthetic((x, g) => x * g),
      wasm,
      { gain: 4 },
    );
    for (const pt of flat) expect(pt.db).toBeCloseTo(20 * Math.log10(4), 1);
  });
});

describe("rolloffHz", () => {
  it("finds the overdrive tone control's -3 dB point near its setting, and none for a flat gain", () => {
    const od = MODULES["overdrive@1"] as ModuleDef;
    for (const tone of [1500, 3000]) {
      const hz = rolloffHz(measureResponse(od, wasm, { tone })) ?? 0;
      expect(Math.abs(hz - tone) / tone).toBeLessThan(0.1);
    }
    const flat = synthetic((x, g) => x * g);
    expect(rolloffHz(measureResponse(flat, wasm, {}))).toBeNull();
  });
});
