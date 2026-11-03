import { readFileSync } from "node:fs";
import { type Board, testClip } from "@rig/shared";
import { describe, expect, it } from "vitest";
import { BLOCK, Chain } from "./chain";
import { MODULES, type ModuleDef } from "./modules";
import { measureTransfer } from "./probe";
import { ModuleError, renderBoard } from "./render";

const wasm = new WebAssembly.Module(
  readFileSync(
    new URL("../../../target/wasm32-unknown-unknown/release/rig_core.wasm", import.meta.url),
  ),
);
const board = (bypass: boolean): Board => ({
  schema: 1,
  id: "t",
  name: "t",
  rev: 0,
  slots: [{ id: "s", module: "diode-clipper@1", bypass, params: {} }],
});

describe("renderBoard", () => {
  it("is deterministic", () => {
    const clip = testClip(12000);
    expect(renderBoard(wasm, board(false), clip)).toEqual(renderBoard(wasm, board(false), clip));
  });

  it("a bypassed slot passes audio through unchanged", () => {
    const clip = testClip(5000);
    expect(renderBoard(wasm, board(true), clip)).toEqual(clip);
  });

  it("handles lengths that are not a multiple of the block size", () => {
    expect(renderBoard(wasm, board(false), testClip(1000)).length).toBe(1000);
  });

  it("reports a broken module as ModuleError", () => {
    const registry = {
      "diode-clipper@1": {
        ...MODULES["diode-clipper@1"],
        create: () => {
          throw new Error("bad netlist");
        },
      },
    } as unknown as Record<string, ModuleDef>;
    expect(() => renderBoard(wasm, board(false), testClip(256), 48000, registry)).toThrow(
      ModuleError,
    );
  });
});

describe("measureTransfer on the circuit module", () => {
  const clipper = MODULES["diode-clipper@1"] as ModuleDef;

  it("shows the diodes compressing loud signals", () => {
    const c = measureTransfer(clipper, wasm, {});
    const gain = (i: number) => (c[i]?.outDb ?? 0) - (c[i]?.inDb ?? 0);
    expect(gain(0) - gain(c.length - 1)).toBeGreaterThan(6);
  });

  it("does not change live output: bit-identical with the probe running between blocks", () => {
    const clip = testClip(BLOCK * 200);
    const live = (probe: boolean) => {
      const chain = new Chain(wasm);
      chain.setSlots(board(false).slots);
      const [out, o] = [new Float32Array(clip.length), new Float32Array(BLOCK)];
      for (let at = 0; at < clip.length; at += BLOCK) {
        chain.process(clip.subarray(at, at + BLOCK), o);
        out.set(o, at);
        if (probe && at % (BLOCK * 20) === 0) measureTransfer(clipper, wasm, { drive: 18 });
      }
      return out;
    };
    expect(live(true)).toEqual(live(false));
  });
});
