import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { applyTone, TAB_EXAMPLE } from "@rig/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Running, startServer } from "./server";

const WASM = new URL(
  "../../../target/wasm32-unknown-unknown/release/rig_core.wasm",
  import.meta.url,
).pathname;
const DIST = new URL("../dist/", import.meta.url).pathname; // built by test:int

let run: Running;
let dir: string;
let child: ReturnType<typeof spawn>;
const pending = new Map<number, (m: Record<string, unknown>) => void>();
let nextId = 1;

/** A scripted MCP client: one JSON message per line over the child's stdio. */
const rpc = (method: string, params: unknown = {}) =>
  new Promise<Record<string, unknown>>((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
const tool = async (name: string, args: unknown = {}) => {
  const r = (await rpc("tools/call", { name, arguments: args })).result as {
    isError: boolean;
    content: { text: string }[];
  };
  const text = r.content[0]?.text ?? "";
  return { isError: r.isError, text, json: () => JSON.parse(text) };
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "rig-mcp-"));
  run = await startServer({
    rigDir: dir,
    wasmPath: WASM,
    sandboxScript: `${DIST}sandbox.mjs`,
    port: 0,
  });
  child = spawn("node", [`${DIST}rig.mjs`, "mcp", "--url", run.url, "--rig-dir", dir], {
    env: { PATH: process.env.PATH, RIG_TOKEN: run.token },
  });
  createInterface({ input: child.stdout as NodeJS.ReadableStream }).on("line", (l) => {
    const m = JSON.parse(l);
    pending.get(m.id)?.(m);
  });
  await rpc("initialize", { protocolVersion: "2025-06-18" });
});
afterAll(async () => {
  child.kill();
  await run.close();
});

// Written as an LLM would, from a spec: "a soft-clipping drive with one knob". Attempt 1 has the mistakes
// a model really makes (a typo'd category, an unbounded gain); attempt 2 fixes what the tool reported.
const pedal = (category: string, body: string) => `
return { id: "soft-drive@1", name: "Soft Drive", category: "${category}", description: "tanh drive",
  params: [{ id: "drive", label: "Drive", min: 1, max: 20, default: 4, unit: "x", taper: "log" }],
  create() { return { process(input, output, p) { ${body} } }; } };`;
const SAT =
  "for (let i = 0; i < input.length; i++) output[i] = Math.tanh(input[i] * p.drive) * 0.8;";

describe("MCP server", () => {
  it("lists the tools and serves the workflow prompt", async () => {
    const tools = ((await rpc("tools/list")).result as { tools: { name: string }[] }).tools;
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        "list_modules",
        "new_module",
        "set_board",
        "render",
        "list_presets",
        "set_preset",
      ]),
    );
    const prompt = (await rpc("prompts/get", { name: "build-a-pedal" })).result as {
      messages: { content: { text: string } }[];
    };
    expect(prompt.messages[0]?.content.text).toContain("new_module");
  });

  it("builds a pedal from a spec within 3 attempts, puts it on the board and hears it", async () => {
    const attempts = [pedal("overdrive", SAT), pedal("drive", SAT)];
    let stored = false;
    const errors: string[] = [];
    for (const source of attempts) {
      const r = await tool("new_module", { source });
      if (!r.isError) {
        stored = true;
        break;
      }
      errors.push(r.text);
    }
    expect(stored).toBe(true);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("category"); // the tool said what to fix

    const board = (await tool("get_board")).json();
    board.slots.push({ id: "mcp-1", module: "soft-drive@1", bypass: false, params: { drive: 12 } });
    const saved = await tool("set_board", { board });
    expect(saved.isError).toBe(false);
    expect(saved.json().rev).toBe(board.rev + 1);

    const render = (await tool("render", { seconds: 1 })).json();
    expect(render.descriptors.thdPercent).toBeGreaterThan(1);
    expect(render.peak).toBeGreaterThan(0.1);
  });

  it("renders an unsaved board without saving it, and reports an invalid one", async () => {
    const saved = (await tool("get_board")).json();
    const [before, trial] = [(await tool("render", { seconds: 1 })).json(), structuredClone(saved)];
    trial.slots.push({ id: "try-fuzz", module: "fuzz@1", bypass: false, params: {} });
    const tried = (await tool("render", { board: trial, seconds: 1 })).json();
    expect(tried.descriptors.centroidHz).not.toBeCloseTo(before.descriptors.centroidHz, 0);
    expect((await tool("get_board")).json().rev).toBe(saved.rev); // nothing was written
    expect(((await tool("render", { seconds: 1 })).json() as typeof before).peak).toBe(before.peak);

    trial.slots.push({ id: "bad", module: "no-such@1", bypass: false, params: {} });
    const bad = await tool("render", { board: trial });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain("no-such@1");
  });

  it("serves the tone guide, and adding a delay and reverb grows the measured tail", async () => {
    const guide = (await rpc("prompts/get", { name: "tune-a-tone" })).result as {
      messages: { content: { text: string } }[];
    };
    expect(guide.messages[0]?.content.text).toContain("delay@1 feedback: +0.15");
    const base = (await tool("get_preset", { id: "blue-crunch" })).json();
    const board = { schema: 1, id: "default", name: "t", rev: 0, slots: base.slots };
    const spacier = structuredClone(board);
    spacier.slots.push(
      { id: "d", module: "delay@1", bypass: false, params: { feedback: 0.55, mix: 0.4 } },
      { id: "r", module: "reverb@1", bypass: false, params: { mix: 0.45, size: 0.7 } },
    );
    const [a, b] = [
      await tool("render", { board, seconds: 1 }),
      await tool("render", { board: spacier, seconds: 1 }),
    ];
    expect(b.json().descriptors.tailMs).toBeGreaterThan(a.json().descriptors.tailMs + 1000);
  });

  it("follows the preset-first prompt from a request to a tuned board with no module authoring", async () => {
    const list = (await rpc("prompts/list")).result as { prompts: { name: string }[] };
    expect(list.prompts.map((x) => x.name)).toContain("find-a-tone");
    const text = (
      (await rpc("prompts/get", { name: "find-a-tone" })).result as {
        messages: { content: { text: string } }[];
      }
    ).messages[0]?.content.text;
    expect(text).toContain("search_presets");

    const calls: string[] = [];
    const call = async (name: string, args: unknown) => {
      calls.push(name);
      return tool(name, args);
    };
    const hit = (
      await call("search_presets", { query: "I want to sound like David Gilmour" })
    ).json().hits[0];
    const preset = (await call("get_preset", { id: hit.id })).json();
    const board = (await call("get_board", {})).json();
    const loaded = (await call("set_board", { board: { ...board, slots: preset.slots } })).json();
    const before = (await call("render", { seconds: 1 })).json();
    // "more spacey": the documented moves, as the guide gives them
    const spacier = { ...loaded, slots: applyTone(loaded.slots, "spacier") };
    const after = (await call("render", { board: spacier, seconds: 1 })).json();

    expect(preset.tags).toContain("artist:david-gilmour");
    expect(loaded.slots.map((x: { module: string }) => x.module)).toEqual(
      preset.slots.map((x: { module: string }) => x.module),
    );
    expect(after.descriptors.tailMs).toBeGreaterThanOrEqual(
      Math.min(before.descriptors.tailMs + 1000, 6000),
    );
    expect(calls).not.toContain("new_module");
  });

  it("finds a preset from a plain-words request", async () => {
    const r = await tool("search_presets", { query: "heavy metal riffs" });
    expect(r.isError).toBe(false);
    expect(r.json().hits[0].id).toBe("iron-wall");
  });

  it("writes a riff as tab, reads it back, and hears it through a board", async () => {
    const saved = await tool("set_riff", {
      id: "mcp-riff",
      name: "MCP riff",
      bpm: 100,
      tab: TAB_EXAMPLE,
    });
    expect(saved.isError).toBe(false);
    const got = (await tool("get_riff", { id: "mcp-riff" })).json();
    expect(got.beats).toBe(4);
    expect(got.notes.map((n: { string: number }) => n.string)).toContain(6);
    const heard = (await tool("render", { board: "default", riff: "mcp-riff" })).json();
    expect(heard.peak).toBeGreaterThan(0.05);
    expect(heard.frames).toBe(Math.round(((4 * 60) / 100 + 1.5) * 48000));
    const bad = await tool("set_riff", { id: "bad-riff", tab: "e|5x|" });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain("6 lines");
  });

  it("returns a stale rev as a tool error the model can act on", async () => {
    const board = (await tool("get_board")).json();
    const r = await tool("set_board", { board, expectedRev: board.rev - 1 });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("stale_rev");
  });

  it("rejects a module that blows up, and says why", async () => {
    const r = await tool("new_module", {
      source: pedal("drive", "for (let i = 0; i < input.length; i++) output[i] = input[i] * 1e12;"),
    });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("exceeds 8x full scale");
  });
});
