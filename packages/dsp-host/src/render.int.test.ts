import { readFileSync } from "node:fs";
import { type Board, testClip } from "@rig/shared";
import { describe, expect, it } from "vitest";
import { MODULES, type ModuleDef } from "./modules";
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
