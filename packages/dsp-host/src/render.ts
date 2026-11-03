import type { Board } from "@rig/shared";
import { BLOCK, Chain } from "./chain";
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

/**
 * Offline render: run `input` through the board in 128-frame blocks, exactly as the AudioWorklet does
 * (it runs the same `Chain`). Pure function of its arguments (docs/PLAN.md, Q23).
 */
export function renderBoard(
  wasm: WebAssembly.Module,
  board: Board,
  input: Float32Array,
  sampleRate = 48000,
  registry: Record<string, ModuleDef> = MODULES,
): Float32Array {
  const chain = new Chain(wasm, sampleRate, registry);
  chain.setSlots(board.slots);
  const out = new Float32Array(input.length);
  const inBlock = new Float32Array(BLOCK);
  const outBlock = new Float32Array(BLOCK);
  for (let at = 0; at < input.length; at += BLOCK) {
    const n = Math.min(BLOCK, input.length - at);
    inBlock.fill(0);
    inBlock.set(input.subarray(at, at + n));
    chain.process(inBlock, outBlock);
    out.set(outBlock.subarray(0, n), at);
  }
  const f = chain.faults[0];
  if (f) {
    const slot = board.slots.find((s) => s.id === f.slotId);
    throw new ModuleError(slot?.module ?? f.slotId, f.message);
  }
  return out;
}
