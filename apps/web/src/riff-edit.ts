import { MAX_FRET, type Riff, type RiffNote, relength, type Technique } from "@rig/shared";

/** The grid slot a note sits in. */
const slotOf = (n: RiffNote, step: number) => Math.round(n.at / step);

export const noteAt = (riff: Riff, string: number, slot: number, step: number) =>
  riff.notes.find((n) => n.string === string && slotOf(n, step) === slot);

const sorted = (notes: RiffNote[]) => notes.toSorted((a, b) => a.at - b.at || a.string - b.string);

const withNotes = (riff: Riff, notes: RiffNote[], step: number): Riff => ({
  ...riff,
  notes: relength(sorted(notes), riff.beats, step),
});

const without = (riff: Riff, string: number, slot: number, step: number) =>
  riff.notes.filter((n) => !(n.string === string && slotOf(n, step) === slot));

/** Put `fret` in a cell. An existing note keeps its technique. */
export function setFret(
  riff: Riff,
  string: number,
  slot: number,
  step: number,
  fret: number,
): Riff {
  const old = noteAt(riff, string, slot, step);
  const note = {
    ...old,
    string,
    fret: Math.min(MAX_FRET, Math.max(0, fret)),
    at: slot * step,
    length: step,
  };
  return withNotes(riff, [...without(riff, string, slot, step), note], step);
}

export const clearCell = (riff: Riff, string: number, slot: number, step: number): Riff =>
  withNotes(riff, without(riff, string, slot, step), step);

/** Set (or with no `tech`, remove) the technique of the note in a cell; nothing happens in an empty cell. */
export function setTech(
  riff: Riff,
  string: number,
  slot: number,
  step: number,
  tech?: Technique,
  bend = 1,
): Riff {
  const old = noteAt(riff, string, slot, step);
  if (!old) return riff;
  const { tech: _t, bend: _b, ...rest } = old;
  const next: RiffNote = tech ? { ...rest, tech, ...(tech === "bend" && { bend }) } : rest;
  return withNotes(riff, [...without(riff, string, slot, step), next], step);
}

/**
 * The key shortcut: mark the note with `tech`, or take the mark off if it already has it. A bend goes
 * one semitone, then two, then off.
 */
export function toggleTech(
  riff: Riff,
  string: number,
  slot: number,
  step: number,
  tech: Technique,
): Riff {
  const old = noteAt(riff, string, slot, step);
  if (!old) return riff;
  if (tech !== "bend")
    return setTech(riff, string, slot, step, old.tech === tech ? undefined : tech);
  if (old.tech !== "bend") return setTech(riff, string, slot, step, "bend", 1);
  return (old.bend ?? 1) < 2
    ? setTech(riff, string, slot, step, "bend", 2)
    : setTech(riff, string, slot, step);
}

/** Change the length of one pass; notes that no longer fit are dropped. */
export function resize(riff: Riff, beats: number, step: number): Riff {
  const next = { ...riff, beats };
  return withNotes(
    next,
    riff.notes.filter((n) => n.at < beats),
    step,
  );
}

/** An eighth-note grid, or sixteenths if some note needs them. */
export const stepFor = (riff: Riff): number =>
  riff.notes.every((n) => Number.isInteger(n.at / 0.5)) ? 0.5 : 0.25;

/** A riff with nothing in it yet, under an id that is not taken. */
export const blankRiff = (): Riff => ({
  schema: 1,
  id: `untitled-${Date.now().toString(36)}`,
  name: "Untitled riff",
  bpm: 100,
  beats: 4,
  notes: [],
  rev: 0,
});

/** The id a riff is saved under when it is named `name`. */
export const slugOf = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "riff";
