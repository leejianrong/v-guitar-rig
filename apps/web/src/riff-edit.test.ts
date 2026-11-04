import type { Riff } from "@rig/shared";
import { describe, expect, it } from "vitest";
import { clearCell, noteAt, resize, setFret, stepFor, toggleTech } from "./riff-edit";

const empty: Riff = { schema: 1, id: "x", name: "X", bpm: 100, beats: 4, notes: [], rev: 0 };
const S = 0.5;

describe("riff edits", () => {
  it("puts a fret in a cell, and a note rings until the next one on its string", () => {
    let r = setFret(empty, 5, 0, S, 0);
    expect(r.notes).toEqual([{ string: 5, fret: 0, at: 0, length: 4 }]);
    r = setFret(r, 5, 4, S, 7); // 2 beats in
    expect(r.notes.map((n) => [n.fret, n.at, n.length])).toEqual([
      [0, 0, 2],
      [7, 2, 2],
    ]);
    r = setFret(r, 5, 4, S, 9); // typing over a cell replaces it
    expect(noteAt(r, 5, 4, S)?.fret).toBe(9);
    expect(r.notes).toHaveLength(2);
  });

  it("keeps a note's technique when its fret changes, and clears a cell", () => {
    let r = setFret(empty, 1, 2, S, 5);
    r = toggleTech(r, 1, 2, S, "palm");
    r = setFret(r, 1, 2, S, 7);
    expect(noteAt(r, 1, 2, S)).toMatchObject({ fret: 7, tech: "palm" });
    r = clearCell(r, 1, 2, S);
    expect(r.notes).toEqual([]);
  });

  it("toggles a technique, and cycles a bend one semitone, two, then off", () => {
    let r = setFret(empty, 2, 0, S, 7);
    r = toggleTech(r, 2, 0, S, "hammer");
    expect(noteAt(r, 2, 0, S)?.tech).toBe("hammer");
    r = toggleTech(r, 2, 0, S, "hammer");
    expect(noteAt(r, 2, 0, S)?.tech).toBeUndefined();
    r = toggleTech(r, 2, 0, S, "bend");
    expect(noteAt(r, 2, 0, S)).toMatchObject({ tech: "bend", bend: 1 });
    r = toggleTech(r, 2, 0, S, "bend");
    expect(noteAt(r, 2, 0, S)).toMatchObject({ tech: "bend", bend: 2 });
    r = toggleTech(r, 2, 0, S, "bend");
    expect(noteAt(r, 2, 0, S)?.tech).toBeUndefined();
    expect(noteAt(r, 2, 0, S)?.bend).toBeUndefined();
    expect(toggleTech(r, 3, 3, S, "palm")).toBe(r); // nothing in that cell
  });

  it("drops notes past a shorter riff, and picks sixteenths only when a note needs them", () => {
    let r = setFret(setFret(empty, 1, 0, S, 5), 1, 6, S, 8); // at 0 and 3 beats
    r = resize(r, 2, S);
    expect(r.notes.map((n) => n.at)).toEqual([0]);
    expect(r.notes[0]?.length).toBe(2);
    expect(stepFor(r)).toBe(0.5);
    expect(stepFor({ ...r, notes: [{ string: 1, fret: 0, at: 0.25, length: 1 }] })).toBe(0.25);
  });
});
