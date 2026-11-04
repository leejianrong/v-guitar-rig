// Runs inside the sandbox process, which the parent starts with `node --permission` (no file writes, no
// child processes, no workers) and reads one JSON request from stdin. Untrusted module source runs in a
// bare `node:vm` realm: no `process`, `require`, `fetch`, or dynamic `import()`. Node's permission model
// does NOT block the network, so that realm is what keeps module code away from it (ADR-0004).
import { readFileSync } from "node:fs";
import vm from "node:vm";
import {
  compileModule,
  describeBoard,
  gateModule,
  MODULES,
  type ModuleDef,
  ModuleError,
  type Realm,
  renderBoard,
} from "@rig/dsp-host";
import type { Board } from "@rig/shared";

type Request =
  | { op: "check"; source: string; wasmPath: string }
  | {
      op: "render";
      sources: string[];
      board: Board;
      input: number[];
      sampleRate: number;
      wasmPath: string;
    };

const ctx = vm.createContext({}, { codeGeneration: { strings: true, wasm: false } });
const inRealm = <T>(code: string) => vm.runInContext(code, ctx) as T;
const realm: Realm = {
  evaluate: (code) => vm.runInContext(code, ctx, { timeout: 2000 }),
  newFloat32: (n) => inRealm<(n: number) => Float32Array>("(n) => new Float32Array(n)")(n),
  newParams: () => inRealm<Record<string, number>>("({})"),
};

function load(req: Request, sources: string[]): { wasm: WebAssembly.Module; defs: ModuleDef[] } {
  const wasm = new WebAssembly.Module(readFileSync(req.wasmPath));
  const defs = sources.map((s) => compileModule(s, realm));
  for (const d of defs) {
    const g = gateModule(d, wasm);
    if (!g.ok) throw new ModuleError(d.id, `failed the safety gate: ${g.reason}`);
  }
  return { wasm, defs };
}

function run(req: Request) {
  if (req.op === "check") {
    const { defs } = load(req, [req.source]);
    const { id, name, category, description, params } = defs[0] as ModuleDef;
    return { ok: true, module: { id, name, category, description, params } };
  }
  const { wasm, defs } = load(req, req.sources);
  const registry = { ...MODULES, ...Object.fromEntries(defs.map((d) => [d.id, d])) };
  const out = renderBoard(wasm, req.board, Float32Array.from(req.input), req.sampleRate, registry);
  const descriptors = describeBoard(wasm, req.board, out, req.sampleRate, registry);
  return { ok: true, output: Array.from(out), descriptors };
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => {
  raw += c;
});
process.stdin.on("end", () => {
  let reply: unknown;
  try {
    reply = run(JSON.parse(raw) as Request);
  } catch (e) {
    reply = { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
  process.stdout.write(JSON.stringify(reply));
});
