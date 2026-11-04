import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KNOWN_MODULES } from "@rig/dsp-host";
import { type Board, validateBoard } from "@rig/shared";
import type { ModuleInfo } from "./sandbox";

export type PutResult =
  | { ok: true; board: Board }
  | { ok: false; kind: "stale"; current: Board }
  | { ok: false; kind: "invalid"; errors: string[] };

/** A module that passed the gate and is kept in the rig directory. */
export type StoredModule = ModuleInfo & { rev: number; sha256: string };

export type PutModuleResult =
  | { ok: true; module: StoredModule }
  | { ok: false; kind: "stale"; current: StoredModule };

const MODULE_ID = /^[a-z][a-z0-9-]{0,40}@[1-9][0-9]{0,3}$/;

/**
 * Boards live as plain JSON files, one per board (ADR-0002). The daemon is the single writer and
 * reads from disk on every call, so edits made with a text editor or git are picked up immediately.
 */
export class RigStore {
  private readonly boardsDir: string;
  private readonly modulesDir: string;

  constructor(readonly rigDir: string) {
    this.boardsDir = join(rigDir, "boards");
    this.modulesDir = join(rigDir, "modules");
    mkdirSync(this.boardsDir, { recursive: true });
    mkdirSync(this.modulesDir, { recursive: true });
    if (this.listBoards().length === 0) {
      this.write({
        schema: 1,
        id: "default",
        name: "Default board",
        rev: 0,
        slots: [{ id: randomUUID(), module: "diode-clipper@1", bypass: false, params: {} }],
      });
    }
  }

  private file(id: string): string {
    return join(this.boardsDir, `${id}.json`);
  }

  private write(board: Board): void {
    const tmp = `${this.file(board.id)}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(board, null, 2)}\n`);
    renameSync(tmp, this.file(board.id));
  }

  listBoards(): Board[] {
    return readdirSync(this.boardsDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => this.getBoard(f.slice(0, -5)))
      .filter((b): b is Board => b !== null);
  }

  getBoard(id: string): Board | null {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return null;
    try {
      const v = validateBoard(JSON.parse(readFileSync(this.file(id), "utf8")), this.knownModules());
      return v.ok ? v.board : null;
    } catch {
      return null;
    }
  }

  /** Write `board` if `expectedRev` matches the stored rev; a stale write is rejected, never lost. */
  putBoard(id: string, board: unknown, expectedRev: number): PutResult {
    const v = validateBoard(board, this.knownModules());
    if (!v.ok) return { ok: false, kind: "invalid", errors: v.errors };
    if (v.board.id !== id)
      return { ok: false, kind: "invalid", errors: ["board id does not match the URL"] };
    const current = this.getBoard(id);
    if (current && current.rev !== expectedRev) return { ok: false, kind: "stale", current };
    if (!current && expectedRev !== 0) {
      return {
        ok: false,
        kind: "invalid",
        errors: ["new boards must be written with expectedRev 0"],
      };
    }
    const next: Board = { ...v.board, rev: (current?.rev ?? -1) + 1 };
    this.write(next);
    return { ok: true, board: next };
  }

  /** Built-in modules plus those stored here: what a board may refer to. */
  knownModules(): ReadonlySet<string> {
    return new Set([...KNOWN_MODULES, ...this.listModules().map((m) => m.id)]);
  }

  listModules(): StoredModule[] {
    return readdirSync(this.modulesDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => this.getModule(f.slice(0, -5))?.info)
      .filter((m): m is StoredModule => m !== undefined);
  }

  getModule(id: string): { info: StoredModule; source: string } | null {
    if (!MODULE_ID.test(id)) return null;
    try {
      const info = JSON.parse(
        readFileSync(join(this.modulesDir, `${id}.json`), "utf8"),
      ) as StoredModule;
      return { info, source: readFileSync(join(this.modulesDir, `${id}.js`), "utf8") };
    } catch {
      return null;
    }
  }

  /**
   * Keep a module that has already passed the gate. A new id is written at rev 1; replacing one needs
   * `expectedRev` to match, as for boards, so two writers cannot silently overwrite each other.
   */
  putModule(info: ModuleInfo, source: string, expectedRev: number | undefined): PutModuleResult {
    if (!MODULE_ID.test(info.id)) throw new Error("module id is not storable");
    const current = this.getModule(info.id)?.info;
    if (current && current.rev !== expectedRev) return { ok: false, kind: "stale", current };
    const module: StoredModule = {
      ...info,
      rev: (current?.rev ?? 0) + 1,
      sha256: createHash("sha256").update(source).digest("hex"),
    };
    writeFileSync(join(this.modulesDir, `${info.id}.js`), source);
    const tmp = join(this.modulesDir, `${info.id}.json.tmp`);
    writeFileSync(tmp, `${JSON.stringify(module, null, 2)}\n`);
    renameSync(tmp, join(this.modulesDir, `${info.id}.json`)); // the info file lands last: it marks the module usable
    return { ok: true, module };
  }
}
