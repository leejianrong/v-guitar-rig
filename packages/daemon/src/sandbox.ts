import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ModuleError } from "@rig/dsp-host";
import type { Board } from "@rig/shared";

/** Where the bundled sandbox process lives: next to the daemon bundle. */
export const SANDBOX_SCRIPT = fileURLToPath(new URL("./sandbox.mjs", import.meta.url));

export interface ModuleInfo {
  id: string;
  name: string;
  category: string;
  description: string;
  params: unknown[];
}

interface Options {
  wasmPath: string;
  script?: string;
  timeoutMs?: number;
}

/** Node flags for the sandbox: the permission model with read access to only what the process needs. */
export const sandboxArgs = (script: string, wasmPath: string) => [
  "--permission",
  `--allow-fs-read=${script}`,
  `--allow-fs-read=${wasmPath}`,
  script,
];

/**
 * Run one request in a fresh sandbox process and return its reply, or throw `ModuleError` (CLI exit 4)
 * if the module fails, is denied, or does not finish within `timeoutMs` and is killed.
 */
function call<T>(
  request: object,
  { wasmPath, script = SANDBOX_SCRIPT, timeoutMs = 20_000 }: Options,
) {
  return new Promise<T>((resolve, reject) => {
    const child = spawn(process.execPath, sandboxArgs(script, wasmPath), {
      stdio: ["pipe", "pipe", "pipe"],
      env: {}, // nothing from the daemon's environment
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => {
      out += c;
    });
    child.stderr.on("data", (c) => {
      err += c;
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new ModuleError("(sandbox)", `did not finish within ${timeoutMs} ms and was stopped`));
    }, timeoutMs);
    child.on("close", () => {
      clearTimeout(timer);
      try {
        const reply = JSON.parse(out) as { ok: boolean; reason?: string } & T;
        if (!reply.ok) reject(new ModuleError("(module)", reply.reason ?? "failed"));
        else resolve(reply);
      } catch {
        reject(new ModuleError("(sandbox)", `crashed: ${err.slice(0, 300) || "no output"}`));
      }
    });
    child.stdin.end(JSON.stringify({ ...request, wasmPath }));
  });
}

/** Compile a module's source and run it through the safety gate, in the sandbox. */
export async function checkModule(source: string, o: Options): Promise<ModuleInfo> {
  return (await call<{ module: ModuleInfo }>({ op: "check", source }, o)).module;
}

/** Render a board that uses the given generated modules, in the sandbox. Each must pass the gate first. */
export async function renderWithModules(
  sources: string[],
  board: Board,
  input: Float32Array,
  o: Options,
): Promise<Float32Array> {
  const r = await call<{ output: number[] }>(
    { op: "render", sources, board, input: Array.from(input) },
    o,
  );
  return Float32Array.from(r.output);
}
