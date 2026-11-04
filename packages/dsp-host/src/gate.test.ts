import { describe, expect, it } from "vitest";
import { compileModule } from "./compile";
import { gateModule } from "./gate";
import { ModuleError } from "./render";

const wasm = {} as WebAssembly.Module;
const spec = (process: string, extra = "") => `
  return {
    id: "test-fx@1", name: "Test", category: "drive", description: "t",
    params: [{ id: "amount", label: "Amount", min: 0, max: 1, default: 0.5, unit: "", taper: "linear" }${extra}],
    create(sampleRate) { let y = 0; return { process(input, output, p) { ${process} } }; },
  };`;
const gate = (body: string) => gateModule(compileModule(spec(body)), wasm);
const reason = (r: ReturnType<typeof gate>) => (r.ok ? "" : r.reason);

describe("gate", () => {
  it("accepts a well-behaved one-pole filter", () => {
    expect(
      gate("for (let i = 0; i < input.length; i++) { y += 0.1 * (input[i] - y); output[i] = y; }"),
    ).toEqual({ ok: true });
  });

  it("rejects infinite gain", () => {
    expect(
      reason(gate("for (let i = 0; i < input.length; i++) output[i] = input[i] / 0 * p.amount;")),
    ).toMatch(/NaN or infinite|exceeds/);
  });

  it("rejects NaN output", () => {
    expect(
      reason(gate("for (let i = 0; i < input.length; i++) output[i] = Math.sqrt(-1);")),
    ).toMatch(/NaN or infinite/);
  });

  it("rejects output that swells without ever reaching the peak limit", () => {
    // gain rises as the sixth power of time up to 6x: always under the peak limit, but runaway
    const r = gate(
      "y++; const g = 6 * (y / 400) ** 6; for (let i = 0; i < input.length; i++) output[i] = input[i] * g;",
    );
    expect(reason(r)).toMatch(/keeps growing/);
  });

  it("rejects a module that only misbehaves with a knob turned all the way up", () => {
    const r = gate(
      "for (let i = 0; i < input.length; i++) output[i] = input[i] * (p.amount > 0.9 ? 1e6 : 1);",
    );
    expect(reason(r)).toMatch(/exceeds .* with all knobs at maximum/);
  });

  it("rejects a module that throws", () => {
    expect(reason(gate("throw new Error('boom')"))).toMatch(/threw "boom"/);
  });

  it("rejects a module over its CPU budget", () => {
    let clock = 0;
    const tick = () => {
      clock += 3; // every call to the clock costs 3 ms, so every block looks slow
      return clock;
    };
    const slow = compileModule(spec("output.set(input)"));
    expect(reason({ ...gateModule(slow, wasm, tick) })).toMatch(/too slow/);
  });
});

describe("compileModule", () => {
  const ok = spec("output.set(input)");
  const expectRejected = (src: string, why: RegExp) => {
    expect(() => compileModule(src)).toThrow(ModuleError);
    expect(() => compileModule(src)).toThrow(why);
  };

  it("builds a working ModuleDef", () => {
    const m = compileModule(ok);
    expect(m.id).toBe("test-fx@1");
    expect(m.params[0]?.id).toBe("amount");
  });

  it("rejects source that does not compile", () => expectRejected("return {", /does not compile/));
  it("rejects a bad id", () =>
    expectRejected(ok.replace("test-fx@1", "Test FX"), /id must look like/));
  it("rejects a param whose range is backwards", () =>
    expectRejected(ok.replace("min: 0, max: 1", "min: 2, max: 1"), /min < max/));
  it("rejects a default outside the range", () =>
    expectRejected(ok.replace("default: 0.5", "default: 7"), /default must lie within/));
  it("rejects duplicate param ids", () => {
    const dup = spec(
      "output.set(input)",
      ', { id: "amount", label: "B", min: 0, max: 1, default: 0, unit: "", taper: "linear" }',
    );
    expectRejected(dup, /duplicate param id "amount"/);
  });
  it("rejects a log taper from zero", () =>
    expectRejected(ok.replace('taper: "linear"', 'taper: "log"'), /log-taper/));
  it("rejects a missing create", () =>
    expectRejected(ok.replace("create(sampleRate)", "notCreate(sampleRate)"), /needs a create/));
});
