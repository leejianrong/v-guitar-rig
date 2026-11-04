import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize, sep } from "node:path";
import { MODULES, ModuleError } from "@rig/dsp-host";
import { testClip } from "@rig/shared";
import { renderAny } from "./render";
import { checkModule, SANDBOX_SCRIPT } from "./sandbox";
import { RigStore } from "./store";
import { encodeWav } from "./wav";

export interface ServeOptions {
  rigDir: string;
  wasmPath: string;
  /** The bundled sandbox process; defaults to the one next to this bundle. */
  sandboxScript?: string;
  /** Directory of the built web app, served at `/` with the session token injected. */
  webDir?: string;
  host?: string;
  port?: number;
  token?: string;
}

export interface Running {
  server: Server;
  token: string;
  url: string;
  close(): Promise<void>;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(text);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 1_000_000) throw new Error("request body too large");
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function tokenOk(header: string | undefined, token: string): boolean {
  const m = /^Bearer (.+)$/.exec(header ?? "");
  if (!m?.[1]) return false;
  const a = Buffer.from(m[1]);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Only loopback host names are accepted, which blocks DNS-rebinding from other web pages. */
function hostOk(host: string | undefined): boolean {
  const h = (host ?? "").replace(/:\d+$/, "").toLowerCase();
  return h === "127.0.0.1" || h === "localhost" || h === "[::1]";
}

export async function startServer(opts: ServeOptions): Promise<Running> {
  const store = new RigStore(opts.rigDir);
  const wasm = new WebAssembly.Module(readFileSync(opts.wasmPath));
  const token = opts.token ?? randomBytes(24).toString("hex");
  mkdirSync(join(opts.rigDir, ".rig"), { recursive: true });
  writeFileSync(join(opts.rigDir, ".rig", "token"), token, { mode: 0o600 });

  const sandbox = { wasmPath: opts.wasmPath, script: opts.sandboxScript ?? SANDBOX_SCRIPT };
  const env = { wasm, wasmPath: opts.wasmPath, sandboxScript: sandbox.script, store };
  const moduleFailure = (res: ServerResponse, e: unknown) =>
    e instanceof ModuleError
      ? send(res, 422, { error: "module_failure", message: e.message })
      : send(res, 500, { error: "internal", message: String(e) });

  const watchers = new Set<ServerResponse>();
  const broadcast = (data: unknown, event?: string) => {
    for (const w of watchers)
      w.write(`${event ? `event: ${event}\n` : ""}data: ${JSON.stringify(data)}\n\n`);
  };

  const server = createServer(async (req, res) => {
    try {
      if (!hostOk(req.headers.host)) return send(res, 403, { error: "bad_host" });
      const url = new URL(req.url ?? "/", "http://local");
      if (url.pathname.startsWith("/api/")) {
        if (!tokenOk(req.headers.authorization, token))
          return send(res, 401, { error: "unauthorized" });
        return await api(req, res, url);
      }
      return serveStatic(res, url.pathname);
    } catch (e) {
      send(res, 500, { error: "internal", message: e instanceof Error ? e.message : String(e) });
    }
  });

  async function api(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const parts = url.pathname.split("/").filter(Boolean); // ["api", ...]
    const method = req.method ?? "GET";
    if (method === "GET" && parts[1] === "health" && parts.length === 2) {
      return send(res, 200, { ok: true, boards: store.listBoards().length });
    }
    if (method === "GET" && parts[1] === "events" && parts.length === 2) {
      // Server-sent events: the UI hears about every accepted board write, including the agent's.
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
      });
      res.write(": connected\n\n");
      watchers.add(res);
      req.on("close", () => watchers.delete(res));
      return;
    }
    if (parts[1] === "boards" && parts.length === 2 && method === "GET") {
      return send(res, 200, { boards: store.listBoards() });
    }
    if (parts[1] === "boards" && parts.length === 3 && parts[2]) {
      const id = parts[2];
      if (method === "GET") {
        const b = store.getBoard(id);
        return b ? send(res, 200, b) : send(res, 404, { error: "not_found" });
      }
      if (method === "PUT") {
        const body = (await readJson(req)) as { expectedRev?: unknown; board?: unknown };
        if (!Number.isInteger(body.expectedRev)) {
          return send(res, 422, { error: "invalid", errors: ["`expectedRev` must be an integer"] });
        }
        const r = store.putBoard(id, body.board, body.expectedRev as number);
        if (r.ok) {
          broadcast(r.board);
          return send(res, 200, r.board);
        }
        if (r.kind === "stale") return send(res, 409, { error: "stale_rev", current: r.current });
        return send(res, 422, { error: "invalid", errors: r.errors });
      }
    }
    if (parts[1] === "modules") {
      const id = parts[2] && decodeURIComponent(parts[2]);
      if (parts.length === 2 && method === "GET") {
        const builtin = Object.values(MODULES).map(
          ({ id, name, category, description, params }) => ({
            id,
            name,
            category,
            description,
            params,
            kind: "builtin",
          }),
        );
        return send(res, 200, {
          modules: [...builtin, ...store.listModules().map((m) => ({ ...m, kind: "stored" }))],
        });
      }
      if (parts.length === 2 && method === "POST") {
        const body = (await readJson(req)) as { source?: unknown; expectedRev?: unknown };
        if (typeof body.source !== "string")
          return send(res, 422, {
            error: "invalid",
            errors: ["`source` must be the module's code"],
          });
        try {
          const info = await checkModule(body.source, sandbox);
          const r = store.putModule(
            info,
            body.source,
            typeof body.expectedRev === "number" ? body.expectedRev : undefined,
          );
          if (r.ok) {
            broadcast({ id: r.module.id, rev: r.module.rev }, "modules");
            return send(res, 200, r.module);
          }
          return send(res, 409, { error: "stale_rev", current: r.current });
        } catch (e) {
          return moduleFailure(res, e);
        }
      }
      if (id && parts.length === 3 && method === "GET") {
        const m = store.getModule(id);
        return m
          ? send(res, 200, { ...m.info, source: m.source })
          : send(res, 404, { error: "not_found" });
      }
      if (id && parts.length === 4 && parts[3] === "check" && method === "POST") {
        const m = store.getModule(id);
        if (!m) return send(res, 404, { error: "not_found" });
        try {
          await checkModule(m.source, sandbox);
          return send(res, 200, { ok: true, ...m.info });
        } catch (e) {
          return moduleFailure(res, e);
        }
      }
    }
    if (parts[1] === "render" && parts.length === 2 && method === "POST") {
      const body = (await readJson(req)) as {
        board?: string;
        seconds?: number;
        includeWav?: boolean;
      };
      const board = store.getBoard(body.board ?? "default");
      if (!board) return send(res, 404, { error: "not_found" });
      const seconds = Math.min(30, Math.max(0.1, Number(body.seconds ?? 2)));
      const input = testClip(Math.round(seconds * 48000));
      try {
        const { output: out, descriptors } = await renderAny(env, board, input);
        let peak = 0;
        let sum = 0;
        for (const v of out) {
          peak = Math.max(peak, Math.abs(v));
          sum += v * v;
        }
        return send(res, 200, {
          sampleRate: 48000,
          frames: out.length,
          peak,
          rms: Math.sqrt(sum / out.length),
          descriptors,
          wav: body.includeWav ? encodeWav(out, 48000).toString("base64") : undefined,
        });
      } catch (e) {
        if (e instanceof ModuleError)
          return send(res, 422, { error: "module_failure", message: e.message });
        throw e;
      }
    }
    return send(res, 404, { error: "not_found" });
  }

  function serveStatic(res: ServerResponse, pathname: string) {
    if (!opts.webDir)
      return send(res, 404, {
        error: "no_web_ui",
        message: "start with --web-dir to serve the UI",
      });
    const rel = normalize(decodeURIComponent(pathname === "/" ? "/index.html" : pathname));
    const file = join(opts.webDir, rel);
    if (!file.startsWith(opts.webDir + sep)) return send(res, 403, { error: "forbidden" });
    let body: Buffer;
    try {
      body = readFileSync(file);
    } catch {
      return send(res, 404, { error: "not_found" });
    }
    const type = TYPES[extname(file)] ?? "application/octet-stream";
    if (extname(file) === ".html") {
      // The page is same-origin only: other origins cannot read this response (no CORS headers).
      const html = body
        .toString("utf8")
        .replace("<head>", `<head><meta name="rig-token" content="${token}" />`);
      res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
      return void res.end(html);
    }
    res.writeHead(200, { "content-type": type });
    res.end(body);
  }

  await new Promise<void>((resolve) =>
    server.listen(opts.port ?? 7878, opts.host ?? "127.0.0.1", resolve),
  );
  const addr = server.address() as AddressInfo;
  return {
    server,
    token,
    url: `http://127.0.0.1:${addr.port}`,
    close: () =>
      new Promise((resolve) => {
        for (const w of watchers) w.end();
        server.close(() => resolve());
      }),
  };
}
