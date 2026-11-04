import type { Slot } from "./board";
import { validateBoard } from "./board";

/**
 * A board someone can start from, plus the words used to find it. Tags are lowercase slugs, optionally
 * `kind:value` (`artist:david-gilmour`, `era:70s`, `genre:psychedelic`, or a plain descriptor such as `dreamy`).
 */
export interface Preset {
  schema: 1;
  id: string;
  name: string;
  description: string;
  tags: string[];
  /** Incremented by the daemon on every accepted write, as for boards. */
  rev: number;
  slots: Slot[];
}

export type PresetValidation = { ok: true; preset: Preset } | { ok: false; errors: string[] };

const TAG = /^[a-z0-9][a-z0-9-]*(:[a-z0-9][a-z0-9-]*)?$/;
export const MAX_TAGS = 16;

export function validatePreset(
  input: unknown,
  knownModules: ReadonlySet<string>,
): PresetValidation {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    return { ok: false, errors: ["preset must be a JSON object"] };
  const p = input as Record<string, unknown>;
  // slots, id, name, rev and schema follow the board rules, so check them as a board
  const board = validateBoard({ ...p, tags: undefined, description: undefined }, knownModules);
  const errors = board.ok ? [] : board.errors;
  if (typeof p.description !== "string" || p.description.length === 0)
    errors.push("`description` must be a non-empty string");
  if (!Array.isArray(p.tags) || p.tags.length === 0 || p.tags.length > MAX_TAGS)
    errors.push(`\`tags\` must be a list of 1 to ${MAX_TAGS} tags`);
  else
    for (const t of p.tags)
      if (typeof t !== "string" || !TAG.test(t))
        errors.push(`tag ${JSON.stringify(t)} must be a lowercase slug or kind:value`);
  if (Array.isArray(p.tags) && new Set(p.tags).size !== p.tags.length)
    errors.push("`tags` has duplicates");
  return errors.length > 0 ? { ok: false, errors } : { ok: true, preset: input as Preset };
}
