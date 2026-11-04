import { type Descriptors, describeBoard, renderBoard } from "@rig/dsp-host";
import type { Board } from "@rig/shared";
import { renderWithModules } from "./sandbox";
import type { RigStore } from "./store";

export interface RenderEnv {
  wasm: WebAssembly.Module;
  wasmPath: string;
  sandboxScript: string;
  store: RigStore;
}

/**
 * Render a board and describe the result. Boards of built-in pedals render in this process; a board that
 * uses a stored (generated) module renders in the sandbox, where its code is allowed to run (ADR-0004).
 */
export async function renderAny(
  env: RenderEnv,
  board: Board,
  input: Float32Array,
  sampleRate = 48000,
): Promise<{ output: Float32Array; descriptors: Descriptors }> {
  const stored = [...new Set(board.slots.map((s) => s.module))].flatMap((id) => {
    const m = env.store.getModule(id);
    return m ? [m.source] : [];
  });
  if (stored.length > 0)
    return renderWithModules(stored, board, input, sampleRate, {
      wasmPath: env.wasmPath,
      script: env.sandboxScript,
    });
  const output = renderBoard(env.wasm, board, input, sampleRate);
  return { output, descriptors: describeBoard(env.wasm, board, output, sampleRate) };
}
