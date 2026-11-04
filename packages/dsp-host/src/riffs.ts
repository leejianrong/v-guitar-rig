import type { Riff, RiffNote } from "@rig/shared";

const riff = (id: string, name: string, bpm: number, beats: number, notes: RiffNote[]): Riff => ({
  schema: 1,
  id,
  name,
  bpm,
  beats,
  notes,
  rev: 0,
});

const n = (
  string: number,
  fret: number,
  at: number,
  length: number,
  tech?: RiffNote["tech"],
  bend?: number,
): RiffNote => ({ string, fret, at, length, ...(tech && { tech }), ...(bend && { bend }) });

/** A power chord on strings 6 and 5 with the root at `fret`, struck together. */
const power = (fret: number, at: number, length: number, tech?: RiffNote["tech"]): RiffNote[] => [
  n(6, fret, at, length, tech),
  n(5, fret + 2, at, length, tech),
];

/** Shipped riffs, one for each thing a tone has to survive: a lead line, rhythm chugs, a clean arpeggio. */
export const STARTER_RIFFS: Riff[] = [
  riff("pentatonic-lick", "Pentatonic lick", 110, 8, [
    n(1, 5, 0, 0.5),
    n(1, 8, 0.5, 0.5, "hammer"),
    n(1, 5, 1, 0.5, "pull"),
    n(2, 8, 1.5, 0.5),
    n(2, 5, 2, 0.5, "pull"),
    n(3, 7, 2.5, 0.5),
    n(3, 5, 3, 0.5, "pull"),
    n(4, 7, 3.5, 0.5),
    n(1, 8, 4, 2, "bend", 1),
    n(1, 5, 6, 1, "slide"),
    n(2, 5, 7, 1),
  ]),
  riff("palm-mute-chug", "Palm-muted chug", 120, 8, [
    ...[0, 0.5, 1, 1.5, 2, 2.5].flatMap((at) => power(0, at, 0.4, "palm")),
    ...power(0, 3, 1),
    ...[4, 4.5, 5, 5.5, 6, 6.5].flatMap((at) => power(3, at, 0.4, "palm")),
    ...power(3, 7, 1),
  ]),
  riff("clean-arpeggio", "Clean arpeggio", 90, 8, [
    ...[
      [5, 0],
      [4, 2],
      [3, 2],
      [2, 1],
      [3, 2],
      [4, 2],
      [5, 0],
      [4, 2],
    ].map(([s, f], i) => n(s as number, f as number, i * 0.5, 2)),
    ...[
      [5, 3],
      [4, 3],
      [3, 2],
      [2, 1],
      [3, 2],
      [4, 3],
      [5, 3],
      [4, 3],
    ].map(([s, f], i) => n(s as number, f as number, 4 + i * 0.5, 2)),
  ]),
];
