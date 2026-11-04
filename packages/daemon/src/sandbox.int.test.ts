import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MODULES, ModuleError, renderBoard } from "@rig/dsp-host";
import { type Board, testClip } from "@rig/shared";
import { describe, expect, it } from "vitest";
import { checkModule, renderWithModules, sandboxArgs } from "./sandbox";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const script = here("../dist/sandbox.mjs"); // built by `pnpm build`, which test:int runs first
const wasmPath = here("../../../target/wasm32-unknown-unknown/release/rig_core.wasm");
const opts = { script, wasmPath };

const module = (process: string, id = "test-fx@1") => `
  return {
    id: "${id}", name: "Test", category: "drive", description: "t",
    params: [{ id: "amount", label: "Amount", min: 0, max: 1, default: 0.5, unit: "", taper: "linear" }],
    create(sampleRate) { let y = 0; return { process(input, output, p) { ${process} } }; },
  };`;
const gain = "for (let i = 0; i < input.length; i++) output[i] = input[i] * (0.5 + p.amount);";
const board = (id: string): Board => ({
  schema: 1,
  id: "t",
  name: "t",
  rev: 0,
  slots: [{ id: "s", module: id, bypass: false, params: { amount: 0.25 } }],
});

describe("sandbox", () => {
  it("relies on a vm realm refusing dynamic import() (it returns a promise, so the gate cannot see it fail)", () => {
    const code = `import vm from "node:vm";
      const ctx = vm.createContext({}, { codeGeneration: { strings: true, wasm: false } });
      vm.runInContext("import('node:net')", ctx).catch((e) => console.log(e.code));`;
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
      encoding: "utf8",
    });
    expect(r.stdout.trim()).toBe("ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING");
  });

  it("accepts a good module and describes it", async () => {
    const info = await checkModule(module(gain), opts);
    expect(info).toMatchObject({ id: "test-fx@1", name: "Test", category: "drive" });
    expect(info.params).toHaveLength(1);
  });

  it("renders a board with a generated module identically to running it in-process", async () => {
    const clip = testClip(12000);
    const viaSandbox = await renderWithModules([module(gain)], board("test-fx@1"), clip, opts);
    const wasm = new WebAssembly.Module(readFileSync(wasmPath));
    const { compileModule } = await import("@rig/dsp-host");
    const def = compileModule(module(gain));
    const direct = renderBoard(wasm, board("test-fx@1"), clip, 48000, {
      ...MODULES,
      [def.id]: def,
    });
    expect(viaSandbox).toEqual(direct);
  });

  it("denies a module that reaches for files, the process, the network or a dynamic import", async () => {
    for (const reach of [
      "process.binding('fs')",
      "require('fs').readFileSync('/etc/passwd')",
      "fetch('http://127.0.0.1:1/')",
      "globalThis.process.mainModule",
    ]) {
      const bad = module(`${reach}; output.set(input);`);
      const err = await checkModule(bad, opts).catch((e) => e);
      expect(err, reach).toBeInstanceOf(ModuleError);
      expect(String(err.message), reach).toMatch(/threw/);
    }
  });

  it("contains the module: the buffers it is handed come from its own realm, not the host's", async () => {
    // If the host's Float32Array leaked in, input.constructor.constructor would be the host's Function and
    // see the host's `process`. The module throws when contained, so a leak would let it through the gate.
    const probe = module(
      "if (input.constructor.constructor('return typeof process')() !== 'object') throw new Error('contained'); output.set(input);",
    );
    await expect(checkModule(probe, opts)).rejects.toThrow(/threw "contained"/);
  });

  it("rejects a module that fails the gate, with the gate's reason", async () => {
    const nan = module("for (let i = 0; i < input.length; i++) output[i] = NaN;");
    await expect(checkModule(nan, opts)).rejects.toThrow(/safety gate: output is NaN/);
  });

  it("stops a module with an infinite loop within the time limit", async () => {
    const t0 = Date.now();
    const hang = module("while (true) {}");
    await expect(checkModule(hang, { ...opts, timeoutMs: 1500 })).rejects.toThrow(/was stopped/);
    expect(Date.now() - t0).toBeLessThan(4000);
  });

  it("starts the sandbox with the permission model: no file writes, no reads beyond its two files, no child processes", () => {
    const args = sandboxArgs(script, wasmPath).slice(0, -1); // the flags without the script
    const attempt = (code: string) =>
      spawnSync(process.execPath, [...args, "--input-type=module", "-e", code], {
        encoding: "utf8",
      });
    expect(attempt("import fs from 'node:fs'; fs.readFileSync('/etc/passwd')").stderr).toMatch(
      /ERR_ACCESS_DENIED/,
    );
    expect(
      attempt("import fs from 'node:fs'; fs.writeFileSync('/tmp/sandbox-should-not-exist', 'x')")
        .stderr,
    ).toMatch(/ERR_ACCESS_DENIED/);
    expect(attempt("import cp from 'node:child_process'; cp.spawnSync('id')").stderr).toMatch(
      /ERR_ACCESS_DENIED/,
    );
  });
});
