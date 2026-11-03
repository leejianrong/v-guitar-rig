import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize, sep } from "node:path";
import { ModuleError, renderBoard } from "@rig/dsp-host";
import { testClip } from "@rig/shared";
import { RigStore } from "./store";
import { encodeWav } from "./wav";

export interface ServeOptions {
  rigDir: string;
  wasmPath: string;
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
        if (r.ok) return send(res, 200, r.board);
        if (r.kind === "stale") return send(res, 409, { error: "stale_rev", current: r.current });
        return send(res, 422, { error: "invalid", errors: r.errors });
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
        const out = renderBoard(wasm, board, input);
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
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
