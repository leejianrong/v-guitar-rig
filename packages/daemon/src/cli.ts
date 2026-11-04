import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ModuleError, renderRiff } from "@rig/dsp-host";
import {
  type Board,
  type Preset,
  type Riff,
  testClip,
  validateBoard,
  validateRiff,
} from "@rig/shared";
import { daemonClient } from "./client";
import { runMcp } from "./mcp";
import { renderAny } from "./render";
import { SANDBOX_SCRIPT } from "./sandbox";
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
  rig render --board FILE|ID [--input FILE.wav|test | --riff ID|FILE.json] [--seconds N] --out FILE.wav [--rig-dir DIR] [--json]
  rig board get ID [--json]            talk to a running daemon (--url, token from RIG_TOKEN or <rig-dir>/.rig/token)
  rig board set FILE [--expected-rev N] [--json]
  rig module new FILE.js [--expected-rev N]   add a generated module (checked in the sandbox first)
  rig module check ID                         re-run the safety gate on a stored module
  rig module list
  rig preset list | get ID | search WORDS... | new FILE.json [--expected-rev N]   presets (a board plus tags)
  rig riff list | get ID | new FILE.json | new FILE.txt --id ID [--name N --bpm N --step BEATS]   riffs the virtual guitar plays (JSON, or ASCII tab)
  rig mcp [--url URL] [--rig-dir DIR]          MCP server on stdio for an LLM client (needs a running daemon)

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
        const v = validateBoard(
          JSON.parse(readFileSync(file, "utf8")),
          new RigStore(rigDir).knownModules(),
        );
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
      if (str("riff")) {
        const given = str("riff") as string;
        const store = new RigStore(rigDir);
        const v = given.endsWith(".json")
          ? validateRiff(JSON.parse(readFileSync(resolve(io.cwd, given), "utf8")))
          : { ok: true as const, riff: store.getRiff(given) as Riff };
        if (!v.ok || !v.riff) {
          io.err(`invalid riff: ${v.ok ? `no riff '${given}'` : v.errors.join("; ")}\n`);
          return EXIT.validation;
        }
        input = renderRiff(v.riff, 48000, 1.5);
      } else if (inputArg === "test")
        input = testClip(Math.round(Number(str("seconds") ?? 5) * 48000));
      else {
        const w = decodeWav(readFileSync(resolve(io.cwd, inputArg)));
        input = w.samples;
        sampleRate = w.sampleRate;
      }
      const env = {
        wasm: new WebAssembly.Module(readFileSync(wasmPath(io))),
        wasmPath: wasmPath(io),
        sandboxScript: io.env.RIG_SANDBOX ?? SANDBOX_SCRIPT,
        store: new RigStore(rigDir),
      };
      const { output: out, descriptors } = await renderAny(env, board, input, sampleRate);
      writeFileSync(resolve(io.cwd, outPath), encodeWav(out, sampleRate));
      const summary = { out: outPath, frames: out.length, sampleRate, descriptors };
      io.out(
        json
          ? `${JSON.stringify(summary)}\n`
          : `wrote ${outPath} (${out.length} frames, peak ${descriptors.peakDb} dB, centroid ${descriptors.centroidHz} Hz, THD ${descriptors.thdPercent}%)\n`,
      );
      return EXIT.ok;
    }

    if (cmd === "mcp") {
      await runMcp(
        daemonClient(
          str("url") ?? io.env.RIG_URL ?? "http://127.0.0.1:7878",
          rigDir,
          io.env.RIG_TOKEN,
        ),
      );
      return EXIT.ok;
    }

    if (
      (cmd === "board" && (sub === "get" || sub === "set")) ||
      cmd === "module" ||
      cmd === "preset" ||
      cmd === "riff"
    ) {
      const call = daemonClient(
        str("url") ?? io.env.RIG_URL ?? "http://127.0.0.1:7878",
        rigDir,
        io.env.RIG_TOKEN,
      );
      const need = (what: string, v: string | undefined) => {
        if (v) return v;
        throw Object.assign(new Error(`rig ${cmd} ${sub} needs ${what}`), {
          exit: EXIT.validation,
        });
      };
      let res: Awaited<ReturnType<typeof call>>;
      if (cmd === "board" && sub === "get") {
        res = await call("GET", `/api/boards/${need("a board id", pos[2])}`);
      } else if (cmd === "preset" && sub === "list") {
        res = await call("GET", "/api/presets");
      } else if (cmd === "preset" && sub === "search") {
        res = await call(
          "GET",
          `/api/presets/search?q=${encodeURIComponent(need("what to look for", pos.slice(2).join(" ")))}`,
        );
      } else if (cmd === "preset" && sub === "get") {
        res = await call("GET", `/api/presets/${need("a preset id", pos[2])}`);
      } else if (cmd === "preset" && sub === "new") {
        const preset = JSON.parse(
          readFileSync(resolve(io.cwd, need("a preset file", pos[2])), "utf8"),
        ) as Preset;
        const rev = str("expected-rev");
        res = await call("PUT", `/api/presets/${preset.id}`, {
          expectedRev: rev === undefined ? 0 : Number(rev),
          preset,
        });
      } else if (cmd === "riff" && sub === "list") {
        res = await call("GET", "/api/riffs");
      } else if (cmd === "riff" && sub === "get") {
        res = await call("GET", `/api/riffs/${need("a riff id", pos[2])}`);
      } else if (cmd === "riff" && sub === "new") {
        const file = need("a riff file", pos[2]);
        const text = readFileSync(resolve(io.cwd, file), "utf8");
        const rev = str("expected-rev") === undefined ? 0 : Number(str("expected-rev"));
        if (file.endsWith(".json")) {
          const riff = JSON.parse(text) as Riff;
          res = await call("PUT", `/api/riffs/${riff.id}`, { expectedRev: rev, riff });
        } else {
          const id = need("--id for a tab file", str("id"));
          const tab = {
            tab: text,
            name: str("name"),
            bpm: str("bpm") && Number(str("bpm")),
            step: str("step") && Number(str("step")),
          };
          res = await call("PUT", `/api/riffs/${id}`, { expectedRev: rev, tab });
        }
      } else if (cmd === "board") {
        const board = JSON.parse(
          readFileSync(resolve(io.cwd, need("a board file", pos[2])), "utf8"),
        ) as Board;
        const expectedRev =
          str("expected-rev") !== undefined ? Number(str("expected-rev")) : board.rev;
        res = await call("PUT", `/api/boards/${board.id}`, { expectedRev, board });
      } else if (sub === "new") {
        const source = readFileSync(resolve(io.cwd, need("a module file", pos[2])), "utf8");
        const rev = str("expected-rev");
        res = await call("POST", "/api/modules", {
          source,
          expectedRev: rev === undefined ? undefined : Number(rev),
        });
      } else if (sub === "check") {
        res = await call(
          "POST",
          `/api/modules/${encodeURIComponent(need("a module id", pos[2]))}/check`,
        );
      } else if (sub === "list") {
        res = await call("GET", "/api/modules");
      } else {
        io.err(`${USAGE}\n`);
        return EXIT.validation;
      }
      const text = json ? JSON.stringify(res.body) : JSON.stringify(res.body, null, 2);
      if (res.ok) {
        io.out(`${text}\n`);
        return EXIT.ok;
      }
      io.err(`${text}\n`);
      if (res.status === 409) return EXIT.staleRev;
      if (res.status === 422)
        return res.body.error === "module_failure" ? EXIT.module : EXIT.validation;
      return EXIT.error;
    }

    io.err(`${USAGE}\n`);
    return cmd ? EXIT.validation : EXIT.ok;
  } catch (e) {
    io.err(`${e instanceof Error ? e.message : String(e)}\n`);
    return (e as { exit?: number }).exit ?? exitCodeFor(e);
  }
}
