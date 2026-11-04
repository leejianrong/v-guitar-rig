/**
 * A riff: what the virtual guitar plays (ADR-0008). Strings are numbered as on a tab, 1 = high e and
 * 6 = low E. Times are in beats, so the tempo can change without touching the notes.
 *
 * - `hammer` / `pull`: no new pluck; the string's pitch changes to this fret.
 * - `slide`: no new pluck; glides from the string's previous pitch to this fret.
 * - `bend`: plucks, then bends up `bend` semitones (default 1).
 * - `palm`: a palm-muted pluck, short and dark.
 */
export type Technique = "hammer" | "pull" | "slide" | "bend" | "palm";

export interface RiffNote {
  string: number;
  fret: number;
  at: number;
  length: number;
  tech?: Technique;
  bend?: number;
}

export interface Riff {
  schema: 1;
  id: string;
  name: string;
  bpm: number;
  /** Length of one pass in beats; the riff loops after this. */
  beats: number;
  notes: RiffNote[];
  rev: number;
}
