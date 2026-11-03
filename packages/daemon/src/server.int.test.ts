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
    env: { RIG_WASM: WASM },
    cwd: dir,
  });
  return { code, out: out.join(""), err: err.join("") };
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "rig-"));
  run = await startServer({ rigDir: dir, wasmPath: WASM, port: 0 });
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

describe("render", () => {
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
