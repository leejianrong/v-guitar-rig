import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DIODE_CLIPPER, RigCircuit } from "./core";

const wasm = readFileSync(
  new URL("../../../target/wasm32-unknown-unknown/release/rig_core.wasm", import.meta.url),
);
const instance = () => new WebAssembly.Instance(new WebAssembly.Module(wasm), {});

describe("rig-core in WASM (Node host)", () => {
  it("reports a netlist error with the core's message", () => {
    expect(() => new RigCircuit(instance(), "R r a b 1k", 48000, 4)).toThrow(/input source/);
  });

  it("clips a loud sine and stays finite", () => {
    const c = new RigCircuit(instance(), DIODE_CLIPPER, 48000, 4);
    const inp = new Float32Array(128);
    const out = new Float32Array(128);
    let peak = 0;
    for (let b = 0; b < 400; b++) {
      for (let i = 0; i < 128; i++)
        inp[i] = 0.9 * Math.sin((2 * Math.PI * 110 * (b * 128 + i)) / 48000);
      c.process(inp, out);
      for (const v of out) {
        expect(Number.isFinite(v)).toBe(true);
        peak = Math.max(peak, Math.abs(v));
      }
    }
    expect(peak).toBeGreaterThan(0.5);
    expect(peak).toBeLessThan(1.3);
    c.destroy();
  });

  it("leaves at least 4x CPU headroom per 128-frame block (V1 acceptance)", () => {
    const c = new RigCircuit(instance(), DIODE_CLIPPER, 48000, 4);
    const inp = new Float32Array(128);
    const out = new Float32Array(128);
    const blocks = 3000;
    const t0 = performance.now();
    for (let b = 0; b < blocks; b++) {
      for (let i = 0; i < 128; i++)
        inp[i] = 0.9 * Math.sin((2 * Math.PI * 110 * (b * 128 + i)) / 48000);
      c.process(inp, out);
    }
    const perBlockMs = (performance.now() - t0) / blocks;
    const blockMs = (128 / 48000) * 1000;
    const headroom = blockMs / perBlockMs;
    console.log(`render ${perBlockMs.toFixed(4)} ms/block, headroom ${headroom.toFixed(1)}x`);
    expect(headroom).toBeGreaterThanOrEqual(4);
  });
});
