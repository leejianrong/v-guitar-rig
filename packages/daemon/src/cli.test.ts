import { ModuleError } from "@rig/dsp-host";
import { describe, expect, it } from "vitest";
import { EXIT, exitCodeFor, runCli } from "./cli";

const io = () => {
  const o: string[] = [];
  const e: string[] = [];
  return {
    o,
    e,
    io: {
      out: (s: string) => o.push(s),
      err: (s: string) => e.push(s),
      env: {},
      cwd: process.cwd(),
    },
  };
};

describe("cli", () => {
  it("maps a module failure to exit code 4 and other errors to 1", () => {
    expect(exitCodeFor(new ModuleError("x@1", "boom"))).toBe(EXIT.module);
    expect(exitCodeFor(new Error("other"))).toBe(EXIT.error);
  });

  it("render without required flags is a validation error (2)", async () => {
    const t = io();
    expect(await runCli(["render"], t.io)).toBe(EXIT.validation);
    expect(t.e.join()).toMatch(/--board and --out/);
  });

  it("an unknown command prints usage and returns 2; no command returns 0", async () => {
    expect(await runCli(["wat"], io().io)).toBe(EXIT.validation);
    expect(await runCli([], io().io)).toBe(EXIT.ok);
  });
});
