import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Board } from "@rig/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EXIT, runCli } from "./cli";
import { type Running, startServer } from "./server";
import { decodeWav } from "./wav";

const WASM = new URL(
  "../../../target/wasm32-unknown-unknown/release/rig_core.wasm",
  import.meta.url,
).pathname;
const SANDBOX = new URL("../dist/sandbox.mjs", import.meta.url).pathname; // built by test:int
let dir: string;
let run: Running;
const auth = () => ({ authorization: `Bearer ${run.token}`, "content-type": "application/json" });
const api = (path: string, init: RequestInit = {}) =>
  fetch(`${run.url}${path}`, { ...init, headers: { ...auth(), ...init.headers } });

const cli = async (args: string[]) => {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(args, {
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    env: { RIG_WASM: WASM, RIG_SANDBOX: SANDBOX, RIG_TOKEN: run.token, RIG_URL: run.url },
    cwd: dir,
  });
  return { code, out: out.join(""), err: err.join("") };
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "rig-"));
  run = await startServer({ rigDir: dir, wasmPath: WASM, sandboxScript: SANDBOX, port: 0 });
});
afterAll(async () => {
  await run.close();
});

describe("daemon security", () => {
  it("binds loopback by default", () => {
    const addr = run.server.address();
    expect(typeof addr === "object" && addr?.address).toBe("127.0.0.1");
  });

  it("rejects API calls without the session token (401) and with a wrong one", async () => {
    expect((await fetch(`${run.url}/api/boards`)).status).toBe(401);
    expect(
      (await fetch(`${run.url}/api/boards`, { headers: { authorization: "Bearer nope" } })).status,
    ).toBe(401);
    expect((await api("/api/boards")).status).toBe(200);
  });

  it("rejects non-loopback Host headers (DNS rebinding)", async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        `${run.url}/api/health`,
        { headers: { host: "evil.example", ...auth() } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(403);
  });

  it("writes the token file with owner-only permissions", () => {
    const file = join(dir, ".rig", "token");
    expect(readFileSync(file, "utf8")).toBe(run.token);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });
});

describe("boards", () => {
  it("seeds a default board", async () => {
    const b = (await (await api("/api/boards/default")).json()) as Board;
    expect(b.schema).toBe(1);
    expect(b.slots[0]?.module).toBe("diode-clipper@1");
  });

  it("rejects a stale write with 409 and the current state, never silently losing it", async () => {
    const b = (await (await api("/api/boards/default")).json()) as Board;
    const ok = await api("/api/boards/default", {
      method: "PUT",
      body: JSON.stringify({ expectedRev: b.rev, board: { ...b, name: "first" } }),
    });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as Board).rev).toBe(b.rev + 1);
    const stale = await api("/api/boards/default", {
      method: "PUT",
      body: JSON.stringify({ expectedRev: b.rev, board: { ...b, name: "second" } }),
    });
    expect(stale.status).toBe(409);
    const body = (await stale.json()) as { current: Board };
    expect(body.current.name).toBe("first");
  });

  it("rejects an invalid board with 422", async () => {
    const r = await api("/api/boards/default", {
      method: "PUT",
      body: JSON.stringify({ expectedRev: 0, board: { id: "default" } }),
    });
    expect(r.status).toBe(422);
  });

  it("picks up edits made directly to the file", async () => {
    const b = (await (await api("/api/boards/default")).json()) as Board;
    writeFileSync(
      join(dir, "boards", "default.json"),
      JSON.stringify({ ...b, name: "edited by hand" }),
    );
    expect(((await (await api("/api/boards/default")).json()) as Board).name).toBe(
      "edited by hand",
    );
  });
});

describe("live updates", () => {
  it("streams an accepted board write to subscribers", async () => {
    const res = await api("/api/events");
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const b = (await (await api("/api/boards/default")).json()) as Board;
    await api("/api/boards/default", {
      method: "PUT",
      body: JSON.stringify({ expectedRev: b.rev, board: { ...b, name: "streamed" } }),
    });
    let text = "";
    while (!text.includes("streamed"))
      text += new TextDecoder().decode((await reader.read()).value);
    await reader.cancel();
    expect(text).toContain('"name":"streamed"');
  });
});

describe("render", () => {
  it("returns the same descriptors every time for the same board and input", async () => {
    const run = async () =>
      (
        (await (
          await api("/api/render", { method: "POST", body: JSON.stringify({ seconds: 1 }) })
        ).json()) as { descriptors: Record<string, unknown> }
      ).descriptors;
    const [a, b] = [await run(), await run()];
    expect(a).toEqual(b);
    expect(a).toMatchObject({ thdPercent: expect.any(Number), centroidHz: expect.any(Number) });
    expect(a.thdPercent as number).toBeGreaterThan(1); // the default board's diode clipper distorts a tone
  });

  it("renders the default board through the API", async () => {
    const r = (await (
      await api("/api/render", { method: "POST", body: JSON.stringify({ seconds: 1 }) })
    ).json()) as { peak: number; frames: number };
    expect(r.frames).toBe(48000);
    expect(r.peak).toBeGreaterThan(0.3);
    expect(r.peak).toBeLessThan(1.5);
  });
});

describe("cli against the daemon", () => {
  it("board get prints the board (exit 0)", async () => {
    const r = await cli(["board", "get", "default", "--rig-dir", dir, "--url", run.url, "--json"]);
    expect(r.code).toBe(EXIT.ok);
    expect(JSON.parse(r.out).id).toBe("default");
  });

  it("board set with a stale rev exits 3 and prints the current state", async () => {
    const cur = JSON.parse(
      (await cli(["board", "get", "default", "--rig-dir", dir, "--url", run.url, "--json"])).out,
    ) as Board;
    const file = join(dir, "mine.json");
    writeFileSync(file, JSON.stringify({ ...cur, name: "mine" }));
    const r = await cli([
      "board",
      "set",
      file,
      "--expected-rev",
      String(cur.rev - 1),
      "--rig-dir",
      dir,
      "--url",
      run.url,
    ]);
    expect(r.code).toBe(EXIT.staleRev);
    expect(r.err).toMatch(/current/);
  });

  it("board set with an invalid board exits 2", async () => {
    const file = join(dir, "bad.json");
    writeFileSync(file, JSON.stringify({ id: "default", rev: 0 }));
    const r = await cli([
      "board",
      "set",
      file,
      "--expected-rev",
      "0",
      "--rig-dir",
      dir,
      "--url",
      run.url,
    ]);
    expect(r.code).toBe(EXIT.validation);
  });

  it("render writes a WAV that matches the API render", async () => {
    const out = join(dir, "out.wav");
    const r = await cli([
      "render",
      "--board",
      "default",
      "--seconds",
      "1",
      "--out",
      out,
      "--rig-dir",
      dir,
      "--json",
    ]);
    expect(r.code).toBe(EXIT.ok);
    const w = decodeWav(readFileSync(out));
    expect(w.samples.length).toBe(48000);
    const api2 = (await (
      await api("/api/render", {
        method: "POST",
        body: JSON.stringify({ seconds: 1, includeWav: true }),
      })
    ).json()) as { wav: string };
    const w2 = decodeWav(Buffer.from(api2.wav, "base64"));
    expect(w2.samples).toEqual(w.samples);
    const printed = JSON.parse(r.out) as { descriptors: { rmsDb: number; bandsDb: object } };
    expect(printed.descriptors.rmsDb).toBeLessThan(0);
    expect(Object.keys(printed.descriptors.bandsDb)).toEqual([
      "low",
      "lowMid",
      "mid",
      "high",
      "air",
    ]);
  });

  it("render of an unknown board exits 2", async () => {
    const r = await cli([
      "render",
      "--board",
      "nope",
      "--out",
      join(dir, "x.wav"),
      "--rig-dir",
      dir,
    ]);
    expect(r.code).toBe(EXIT.validation);
  });
});

const MODULE = (id: string, body: string) => `
  return {
    id: "${id}", name: "Test Echo", category: "time", description: "t",
    params: [{ id: "amount", label: "Amount", min: 0, max: 1, default: 0.5, unit: "", taper: "linear" }],
    create() { return { process(input, output, p) { ${body} } }; },
  };`;
const GAIN = "for (let i = 0; i < input.length; i++) output[i] = input[i] * (0.5 + p.amount);";
const NAN = "for (let i = 0; i < input.length; i++) output[i] = NaN;";
const post = (source: string, expectedRev?: number) =>
  api("/api/modules", { method: "POST", body: JSON.stringify({ source, expectedRev }) });
const boardWith = (module: string, rev: number) => ({
  schema: 1,
  id: "with-module",
  name: "with module",
  rev,
  slots: [{ id: "m1", module, bypass: false, params: {} }],
});
const putBoard = (b: object, expectedRev: number) =>
  api("/api/boards/with-module", {
    method: "PUT",
    body: JSON.stringify({ expectedRev, board: b }),
  });

describe("modules", () => {
  it("adds a good module, lists it, puts it on a board and renders it with descriptors", async () => {
    const r = await post(MODULE("add-gain@1", GAIN));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ id: "add-gain@1", rev: 1, name: "Test Echo" });

    const list = (await (await api("/api/modules")).json()) as {
      modules: { id: string; kind: string }[];
    };
    expect(list.modules.find((m) => m.id === "add-gain@1")?.kind).toBe("stored");
    expect(list.modules.find((m) => m.id === "overdrive@1")?.kind).toBe("builtin");
    expect(
      ((await (await api("/api/modules/add-gain@1")).json()) as { source: string }).source,
    ).toContain("output[i]");

    expect((await putBoard(boardWith("add-gain@1", 0), 0)).status).toBe(200);
    const render = async () =>
      (await (
        await api("/api/render", {
          method: "POST",
          body: JSON.stringify({ board: "with-module", seconds: 1 }),
        })
      ).json()) as { descriptors: object; peak: number };
    const [a, b] = [await render(), await render()];
    expect(a.descriptors).toEqual(b.descriptors);
    expect(a.peak).toBeGreaterThan(0);
  });

  it("refuses a module that fails the gate, with the reason, and does not keep it", async () => {
    const r = await post(MODULE("broken-fx@1", NAN));
    expect(r.status).toBe(422);
    expect(await r.json()).toMatchObject({
      error: "module_failure",
      message: expect.stringContaining("output is NaN"),
    });
    expect((await api("/api/modules/broken-fx@1")).status).toBe(404);
    expect((await putBoard(boardWith("broken-fx@1", 0), 0)).status).toBe(422); // unknown module
  });

  it("replaces a module only with the current rev, like a board", async () => {
    await post(MODULE("rev-fx@1", GAIN));
    const stale = await post(MODULE("rev-fx@1", GAIN.replace("0.5", "0.6")));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: "stale_rev", current: { rev: 1 } });
    const ok = await post(MODULE("rev-fx@1", GAIN.replace("0.5", "0.6")), 1);
    expect(await ok.json()).toMatchObject({ rev: 2 });
  });

  it("needs the session token", async () => {
    expect((await fetch(`${run.url}/api/modules`)).status).toBe(401);
    expect((await fetch(`${run.url}/api/modules`, { method: "POST", body: "{}" })).status).toBe(
      401,
    );
  });

  it("is driven from the CLI: new, list, check, a refused module exits 4, a stale one exits 3, render", async () => {
    const good = join(dir, "cli-fx.js");
    writeFileSync(good, MODULE("cli-fx@1", GAIN));
    expect((await cli(["module", "new", good, "--rig-dir", dir])).code).toBe(EXIT.ok);
    expect((await cli(["module", "new", good, "--rig-dir", dir])).code).toBe(EXIT.staleRev);
    const list = await cli(["module", "list", "--rig-dir", dir, "--json"]);
    expect(list.out).toContain("cli-fx@1");
    expect((await cli(["module", "check", "cli-fx@1", "--rig-dir", dir])).code).toBe(EXIT.ok);

    const bad = join(dir, "bad-fx.js");
    writeFileSync(bad, MODULE("bad-cli-fx@1", NAN));
    const refused = await cli(["module", "new", bad, "--rig-dir", dir]);
    expect(refused.code).toBe(EXIT.module);
    expect(refused.err).toContain("output is NaN");

    const boardFile = join(dir, "cli-board.json");
    writeFileSync(boardFile, JSON.stringify({ ...boardWith("cli-fx@1", 0), id: "cli-board" }));
    const out = join(dir, "cli-out.wav");
    const r = await cli([
      "render",
      "--board",
      boardFile,
      "--seconds",
      "1",
      "--out",
      out,
      "--rig-dir",
      dir,
      "--json",
    ]);
    expect(r.code).toBe(EXIT.ok);
    expect(JSON.parse(r.out).descriptors.rmsDb).toBeLessThan(0);
    expect(decodeWav(readFileSync(out)).samples.length).toBe(48000);
  });
});

describe("presets", () => {
  const preset = {
    schema: 1,
    id: "test-crunch",
    name: "Test Crunch",
    description: "A preset for the test.",
    tags: ["genre:blues", "warm"],
    rev: 0,
    slots: [{ id: "a", module: "overdrive@1", bypass: false, params: { drive: 9 } }],
  };
  const file = (name: string, body: unknown) => {
    writeFileSync(join(dir, name), JSON.stringify(body));
    return name;
  };

  it("round-trips through the CLI and the API, and a stale write is exit 3", async () => {
    const made = await cli(["preset", "new", file("p.json", preset)]);
    expect(made.code).toBe(EXIT.ok);
    const got = (await (await api("/api/presets/test-crunch")).json()) as typeof preset;
    expect(got.slots[0]?.params.drive).toBe(9);
    expect(
      ((await (await api("/api/presets")).json()) as { presets: unknown[] }).presets,
    ).toHaveLength(1);
    expect((await cli(["preset", "get", "test-crunch"])).out).toContain("Test Crunch");

    expect((await cli(["preset", "new", file("p.json", preset), "--expected-rev", "5"])).code).toBe(
      EXIT.staleRev,
    );
    expect((await cli(["preset", "new", file("p.json", preset), "--expected-rev", "0"])).code).toBe(
      EXIT.ok,
    );
  });

  it("refuses bad tags and unknown modules with exit 2", async () => {
    const badTag = file("t.json", { ...preset, id: "bad-tag", tags: ["Not A Slug"] });
    expect((await cli(["preset", "new", badTag])).code).toBe(EXIT.validation);
    const noMod = file("m.json", {
      ...preset,
      id: "no-mod",
      slots: [{ id: "a", module: "ghost@1", bypass: false, params: {} }],
    });
    expect((await cli(["preset", "new", noMod])).code).toBe(EXIT.validation);
    expect((await api("/api/presets/bad-tag")).status).toBe(404);
  });
});
