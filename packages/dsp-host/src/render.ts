import type { Board } from "@rig/shared";
import { RigCircuit } from "./core";
import { MODULES, type ModuleDef } from "./modules";

/** A module failed to compile or run (ADR-0004); the CLI maps this to exit code 4. */
export class ModuleError extends Error {
  constructor(
    readonly moduleId: string,
    message: string,
  ) {
    super(`module ${moduleId}: ${message}`);
  }
}

const BLOCK = 128;

/**
 * Offline render: run `input` through every non-bypassed slot, in order, in 128-frame blocks,
 * exactly as the AudioWorklet does. Pure function of its arguments (docs/PLAN.md, Q23).
 */
export function renderBoard(
  wasm: WebAssembly.Module,
  board: Board,
  input: Float32Array,
  sampleRate = 48000,
  registry: Record<string, ModuleDef> = MODULES,
): Float32Array {
  let signal: Float32Array = input;
  for (const slot of board.slots) {
    if (slot.bypass) continue;
    const def = registry[slot.module];
    if (!def) throw new ModuleError(slot.module, "not in the module registry");
    let circuit: RigCircuit;
    try {
      circuit = new RigCircuit(
        new WebAssembly.Instance(wasm, {}),
        def.netlist,
        sampleRate,
        def.oversample,
        BLOCK,
      );
    } catch (e) {
      throw new ModuleError(slot.module, e instanceof Error ? e.message : String(e));
    }
    const out = new Float32Array(signal.length);
    const inBlock = new Float32Array(BLOCK);
    const outBlock = new Float32Array(BLOCK);
    for (let at = 0; at < signal.length; at += BLOCK) {
      const n = Math.min(BLOCK, signal.length - at);
      inBlock.fill(0);
      inBlock.set(signal.subarray(at, at + n));
      circuit.process(inBlock, outBlock);
      out.set(outBlock.subarray(0, n), at);
    }
    circuit.destroy();
    signal = out;
  }
  return signal === input ? input.slice() : signal;
}
