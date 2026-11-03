import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { KNOWN_MODULES, ModuleError, renderBoard } from "@rig/dsp-host";
import { type Board, testClip, validateBoard } from "@rig/shared";
import { startServer } from "./server";
import { RigStore } from "./store";
import { decodeWav, encodeWav } from "./wav";

/** Exit codes (docs/QUESTIONS.md Q20). */
export const EXIT = { ok: 0, error: 1, validation: 2, staleRev: 3, module: 4 } as const;

export interface Io {
  out(s: string): void;
  err(s: string): void;
  env: Record<string, string | undefined>;
  cwd: string;
}

interface Args {
  pos: string[];
  flags: Record<string, string | true>;
}

function parse(argv: string[]): Args {
  const pos: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a.startsWith("--")) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[a.slice(2)] = next;
        i++;
      } else flags[a.slice(2)] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}

export function exitCodeFor(e: unknown): number {
  return e instanceof ModuleError ? EXIT.module : EXIT.error;
}

const USAGE = `rig: virtual guitar rig

  rig serve  [--rig-dir DIR] [--port N] [--host H] [--web-dir DIR]
  rig render --board FILE|ID [--input FILE.wav|test] [--seconds N] --out FILE.wav [--rig-dir DIR] [--json]
  rig board get ID [--json]            talk to a running daemon (--url, token from RIG_TOKEN or <rig-dir>/.rig/token)
  rig board set FILE [--expected-rev N] [--json]

Exit codes: 0 ok, 1 error, 2 validation, 3 stale rev, 4 module failure.`;

function wasmPath(io: Io): string {
  return (
    io.env.RIG_WASM ??
    new URL("../../../target/wasm32-unknown-unknown/release/rig_core.wasm", import.meta.url)
      .pathname
  );
}

export async function runCli(argv: string[], io: Io): Promise<number> {
  const { pos, flags } = parse(argv);
  const str = (k: string): string | undefined =>
    typeof flags[k] === "string" ? (flags[k] as string) : undefined;
  const json = flags.json === true;
  const rigDir = resolve(io.cwd, str("rig-dir") ?? io.env.RIG_DIR ?? "rig");
  const [cmd, sub] = pos;

  try {
    if (cmd === "serve") {
      const run = await startServer({
        rigDir,
        wasmPath: wasmPath(io),
        webDir: str("web-dir") ? resolve(io.cwd, str("web-dir") as string) : undefined,
        host: str("host") ?? io.env.RIG_HOST ?? "127.0.0.1",
        port: Number(str("port") ?? io.env.RIG_PORT ?? 7878),
      });
      io.out(
        `rig daemon listening on ${run.url} (rig dir ${rigDir}); token in ${join(rigDir, ".rig", "token")}\n`,
      );
      await new Promise(() => {}); // run until the process is stopped
      return EXIT.ok;
    }

    if (cmd === "render") {
      const boardArg = str("board");
      const outPath = str("out");
      if (!boardArg || !outPath) {
        io.err(`rig render needs --board and --out\n${USAGE}\n`);
        return EXIT.validation;
      }
      let board: Board | null;
      const file = resolve(io.cwd, boardArg);
      if (boardArg.endsWith(".json") || existsSync(file)) {
        const v = validateBoard(JSON.parse(readFileSync(file, "utf8")), KNOWN_MODULES);
        if (!v.ok) {
          io.err(`invalid board:\n  ${v.errors.join("\n  ")}\n`);
          return EXIT.validation;
        }
        board = v.board;
      } else {
        board = new RigStore(rigDir).getBoard(boardArg);
        if (!board) {
          io.err(`no board '${boardArg}' in ${rigDir}\n`);
          return EXIT.validation;
        }
      }
      const inputArg = str("input") ?? "test";
      let input: Float32Array;
      let sampleRate = 48000;
      if (inputArg === "test") input = testClip(Math.round(Number(str("seconds") ?? 5) * 48000));
      else {
        const w = decodeWav(readFileSync(resolve(io.cwd, inputArg)));
        input = w.samples;
        sampleRate = w.sampleRate;
      }
      const out = renderBoard(
        new WebAssembly.Module(readFileSync(wasmPath(io))),
        board,
        input,
        sampleRate,
      );
      writeFileSync(resolve(io.cwd, outPath), encodeWav(out, sampleRate));
      let peak = 0;
      for (const v of out) peak = Math.max(peak, Math.abs(v));
      const summary = { out: outPath, frames: out.length, sampleRate, peak };
      io.out(
        json
          ? `${JSON.stringify(summary)}\n`
          : `wrote ${outPath} (${out.length} frames, peak ${peak.toFixed(3)})\n`,
      );
      return EXIT.ok;
    }

    if (cmd === "board" && (sub === "get" || sub === "set")) {
      const base = str("url") ?? io.env.RIG_URL ?? "http://127.0.0.1:7878";
      let token = io.env.RIG_TOKEN;
      if (!token) {
        try {
          token = readFileSync(join(rigDir, ".rig", "token"), "utf8").trim();
        } catch {
          io.err("no token: set RIG_TOKEN or point --rig-dir at the daemon's rig directory\n");
          return EXIT.error;
        }
      }
      const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
      let res: Response;
      if (sub === "get") {
        if (!pos[2]) return io.err("rig board get needs a board id\n"), EXIT.validation;
        res = await fetch(`${base}/api/boards/${pos[2]}`, { headers });
      } else {
        if (!pos[2]) return io.err("rig board set needs a board file\n"), EXIT.validation;
        const board = JSON.parse(readFileSync(resolve(io.cwd, pos[2]), "utf8")) as Board;
        const expectedRev =
          str("expected-rev") !== undefined ? Number(str("expected-rev")) : board.rev;
        res = await fetch(`${base}/api/boards/${board.id}`, {
          method: "PUT",
          headers,
          body: JSON.stringify({ expectedRev, board }),
        });
      }
      const body = (await res.json()) as Record<string, unknown>;
      const text = json ? JSON.stringify(body) : JSON.stringify(body, null, 2);
      if (res.ok) {
        io.out(`${text}\n`);
        return EXIT.ok;
      }
      io.err(`${text}\n`);
      if (res.status === 409) return EXIT.staleRev;
      if (res.status === 422)
        return body.error === "module_failure" ? EXIT.module : EXIT.validation;
      return EXIT.error;
    }

    io.err(`${USAGE}\n`);
    return cmd ? EXIT.validation : EXIT.ok;
  } catch (e) {
    io.err(`${e instanceof Error ? e.message : String(e)}\n`);
    return exitCodeFor(e);
  }
}
