import { describe, expect, it } from "vitest";
import { DIODE_CLIPPER, RigCircuit } from "./core";

// Unit level: wrapper behaviour that needs no WASM file is limited to constants.
describe("netlist constant", () => {
  it("declares an input and an output", () => {
    expect(DIODE_CLIPPER).toMatch(/\bIN\b/);
    expect(DIODE_CLIPPER).toMatch(/^OUT /m);
    expect(typeof RigCircuit).toBe("function");
  });
});
