/** Board file contract (docs/PLAN.md, Q15/Q27). `schema` is present from day one. */
export interface Slot {
  /** Stable across reorder (UUID). */
  id: string;
  /** Module reference `slug@major`. */
  module: string;
  bypass: boolean;
  params: Record<string, number>;
}

export interface Board {
  schema: 1;
  id: string;
  name: string;
  /** Incremented by the daemon on every accepted write (ADR-0002). */
  rev: number;
  slots: Slot[];
}

export type Validation = { ok: true; board: Board } | { ok: false; errors: string[] };

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

export function validateBoard(input: unknown, knownModules: ReadonlySet<string>): Validation {
  const errors: string[] = [];
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errors: ["board must be a JSON object"] };
  }
  const b = input as Record<string, unknown>;
  if (b.schema === undefined) errors.push("missing `schema` (expected 1)");
  else if (b.schema !== 1)
    errors.push(`unsupported schema ${JSON.stringify(b.schema)} (expected 1)`);
  if (typeof b.id !== "string" || !ID_RE.test(b.id)) errors.push("`id` must be a lowercase slug");
  if (typeof b.name !== "string" || b.name.length === 0)
    errors.push("`name` must be a non-empty string");
  if (!Number.isInteger(b.rev) || (b.rev as number) < 0)
    errors.push("`rev` must be a non-negative integer");
  if (!Array.isArray(b.slots)) errors.push("`slots` must be an array");
  else {
    const seen = new Set<string>();
    b.slots.forEach((raw, i) => {
      const s = (raw ?? {}) as Record<string, unknown>;
      const at = `slots[${i}]`;
      if (typeof s.id !== "string" || s.id.length === 0)
        errors.push(`${at}.id must be a non-empty string`);
      else if (seen.has(s.id)) errors.push(`${at}.id duplicates another slot`);
      else seen.add(s.id);
      if (typeof s.module !== "string" || !knownModules.has(s.module)) {
        errors.push(`${at}.module ${JSON.stringify(s.module)} is not a known module`);
      }
      if (typeof s.bypass !== "boolean") errors.push(`${at}.bypass must be a boolean`);
      const p = s.params as Record<string, unknown> | undefined;
      if (typeof p !== "object" || p === null || Array.isArray(p))
        errors.push(`${at}.params must be an object`);
      else {
        for (const [k, v] of Object.entries(p)) {
          if (typeof v !== "number" || !Number.isFinite(v))
            errors.push(`${at}.params.${k} must be a finite number`);
        }
      }
    });
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, board: input as Board };
}
