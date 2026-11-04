import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KNOWN_MODULES, STARTER_PRESETS, STARTER_RIFFS } from "@rig/dsp-host";
import {
  type Board,
  type Preset,
  type Riff,
  validateBoard,
  validatePreset,
  validateRiff,
} from "@rig/shared";
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

/** A preset or riff write: stored with the rev bumped, or refused. */
export type PutDocResult<T> =
  | { ok: true; doc: T }
  | { ok: false; kind: "stale"; current: T }
  | { ok: false; kind: "invalid"; errors: string[] };

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

/** A validator's result for a preset or riff, with the document under one name. */
function okDoc<T extends object>(
  v: ({ ok: true } & Record<string, unknown>) | { ok: false; errors: string[] },
  key: string,
): { ok: true; doc: T } | { ok: false; errors: string[] } {
  return v.ok ? { ok: true, doc: v[key] as T } : v;
}
const MODULE_ID = /^[a-z][a-z0-9-]{0,40}@[1-9][0-9]{0,3}$/;

/**
 * Boards live as plain JSON files, one per board (ADR-0002). The daemon is the single writer and
 * reads from disk on every call, so edits made with a text editor or git are picked up immediately.
 */
export class RigStore {
  private readonly boardsDir: string;
  private readonly modulesDir: string;
  private readonly presetsDir: string;
  private readonly riffsDir: string;

  constructor(readonly rigDir: string) {
    this.boardsDir = join(rigDir, "boards");
    this.modulesDir = join(rigDir, "modules");
    mkdirSync(this.boardsDir, { recursive: true });
    this.presetsDir = join(rigDir, "presets");
    mkdirSync(this.modulesDir, { recursive: true });
    mkdirSync(this.presetsDir, { recursive: true });
    this.riffsDir = join(rigDir, "riffs");
    mkdirSync(this.riffsDir, { recursive: true });
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

  /** The shipped presets first, then the user's. Shipped ones are read-only. */
  listPresets(): Preset[] {
    return this.listDocs(this.presetsDir, STARTER_PRESETS, (id) => this.getPreset(id));
  }

  getPreset(id: string): Preset | null {
    return this.getDoc(this.presetsDir, id, STARTER_PRESETS, (raw) =>
      okDoc(validatePreset(raw, this.knownModules()), "preset"),
    );
  }

  /** Same rule as boards: a stale `expectedRev` is rejected, a new preset is written with 0. */
  putPreset(id: string, preset: unknown, expectedRev: number): PutDocResult<Preset> {
    return this.putDoc(
      this.presetsDir,
      id,
      okDoc(validatePreset(preset, this.knownModules()), "preset"),
      STARTER_PRESETS,
      "preset",
      expectedRev,
    );
  }

  /** The shipped riffs first, then the user's, as for presets. */
  listRiffs(): Riff[] {
    return this.listDocs(this.riffsDir, STARTER_RIFFS, (id) => this.getRiff(id));
  }

  getRiff(id: string): Riff | null {
    return this.getDoc(this.riffsDir, id, STARTER_RIFFS, (raw) => okDoc(validateRiff(raw), "riff"));
  }

  putRiff(id: string, riff: unknown, expectedRev: number): PutDocResult<Riff> {
    return this.putDoc(
      this.riffsDir,
      id,
      okDoc(validateRiff(riff), "riff"),
      STARTER_RIFFS,
      "riff",
      expectedRev,
    );
  }

  private listDocs<T>(dir: string, shipped: T[], get: (id: string) => T | null): T[] {
    const mine = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => get(f.slice(0, -5)))
      .filter((d): d is T => d !== null);
    return [...shipped, ...mine];
  }

  private getDoc<T extends { id: string }>(
    dir: string,
    id: string,
    shipped: T[],
    validate: (raw: unknown) => { ok: true; doc: T } | { ok: false },
  ): T | null {
    if (!SLUG.test(id)) return null;
    const found = shipped.find((d) => d.id === id);
    if (found) return found;
    try {
      const v = validate(JSON.parse(readFileSync(join(dir, `${id}.json`), "utf8")));
      return v.ok ? v.doc : null;
    } catch {
      return null;
    }
  }

  private putDoc<T extends { id: string; rev: number }>(
    dir: string,
    id: string,
    v: { ok: true; doc: T } | { ok: false; errors: string[] },
    shipped: T[],
    what: string,
    expectedRev: number,
  ): PutDocResult<T> {
    if (!v.ok) return { ok: false, kind: "invalid", errors: v.errors };
    if (shipped.some((d) => d.id === id))
      return {
        ok: false,
        kind: "invalid",
        errors: [
          `"${id}" is a shipped ${what} and cannot be changed; save a copy under another id`,
        ],
      };
    if (v.doc.id !== id)
      return { ok: false, kind: "invalid", errors: [`${what} id does not match the URL`] };
    const current = this.getDoc(dir, id, [], (raw) => ({ ok: true, doc: raw as T }));
    if (current && current.rev !== expectedRev) return { ok: false, kind: "stale", current };
    if (!current && expectedRev !== 0)
      return {
        ok: false,
        kind: "invalid",
        errors: [`new ${what}s must be written with expectedRev 0`],
      };
    const next: T = { ...v.doc, rev: (current?.rev ?? -1) + 1 };
    const tmp = join(dir, `${id}.json.tmp`);
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
    renameSync(tmp, join(dir, `${id}.json`));
    return { ok: true, doc: next };
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
