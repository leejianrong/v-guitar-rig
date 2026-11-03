import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KNOWN_MODULES } from "@rig/dsp-host";
import { type Board, validateBoard } from "@rig/shared";

export type PutResult =
  | { ok: true; board: Board }
  | { ok: false; kind: "stale"; current: Board }
  | { ok: false; kind: "invalid"; errors: string[] };

/**
 * Boards live as plain JSON files, one per board (ADR-0002). The daemon is the single writer and
 * reads from disk on every call, so edits made with a text editor or git are picked up immediately.
 */
export class RigStore {
  private readonly boardsDir: string;

  constructor(readonly rigDir: string) {
    this.boardsDir = join(rigDir, "boards");
    mkdirSync(this.boardsDir, { recursive: true });
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
      const v = validateBoard(JSON.parse(readFileSync(this.file(id), "utf8")), KNOWN_MODULES);
      return v.ok ? v.board : null;
    } catch {
      return null;
    }
  }

  /** Write `board` if `expectedRev` matches the stored rev; a stale write is rejected, never lost. */
  putBoard(id: string, board: unknown, expectedRev: number): PutResult {
    const v = validateBoard(board, KNOWN_MODULES);
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
}
