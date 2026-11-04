import { describe, expect, it } from "vitest";
import { formatTab, parseTab, type Riff, TAB_EXAMPLE, validateRiff } from "./riff";

const good: Riff = {
  schema: 1,
  id: "lick",
  name: "Lick",
  bpm: 100,
  beats: 4,
  rev: 0,
  notes: [{ string: 1, fret: 5, at: 0, length: 1 }],
};
const errors = (r: unknown) => {
  const v = validateRiff(r);
  return v.ok ? "" : v.errors.join("; ");
};

describe("validateRiff", () => {
  it("accepts a good riff and says what is wrong with a bad one", () => {
    expect(validateRiff(good).ok).toBe(true);
    expect(errors({ ...good, bpm: 10 })).toContain("bpm");
    expect(errors({ ...good, id: "Not A Slug" })).toContain("id");
    expect(errors({ ...good, notes: [] })).toContain("notes");
    expect(errors({ ...good, notes: [{ ...good.notes[0], string: 7 }] })).toContain(
      "notes[0]: `string`",
    );
    expect(errors({ ...good, notes: [{ ...good.notes[0], fret: 2.5 }] })).toContain(
      "notes[0]: `fret`",
    );
    expect(errors({ ...good, notes: [{ ...good.notes[0], at: 4 }] })).toContain("start inside");
    expect(errors({ ...good, notes: [{ ...good.notes[0], tech: "tap" }] })).toContain("tech");
    expect(errors({ ...good, notes: [{ ...good.notes[0], bend: 2 }] })).toContain("bend");
  });
});

const tab = (rows: string[]) => rows.map((r, i) => `${"eBGDAE"[i % 6]}|${r}|`).join("\n");
const parsed = (rows: string[], step?: number) => {
  const r = parseTab(tab(rows), step);
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r;
};

describe("parseTab", () => {
  it("reads frets, hammer-ons, pull-offs and two-digit frets as time on a grid", () => {
    const r = parsed([
      "5h8p5-10-",
      "---------",
      "---------",
      "---------",
      "---------",
      "0--------",
    ]);
    expect(r.beats).toBe(3); // 6 columns that take time, half a beat each
    expect(r.notes).toEqual([
      { string: 1, fret: 5, at: 0, length: 0.5 },
      { string: 1, fret: 8, at: 0.5, length: 0.5, tech: "hammer" },
      { string: 1, fret: 5, at: 1, length: 1, tech: "pull" },
      { string: 1, fret: 10, at: 2, length: 1 },
      { string: 6, fret: 0, at: 0, length: 3 },
    ]);
  });

  it("reads bends, slides and palm mutes, and the step sets the grid", () => {
    const r = parsed(
      ["7b9---5/7-", "0m--------", "----------", "----------", "----------", "----------"],
      0.25,
    );
    expect(r.notes).toContainEqual({
      string: 1,
      fret: 7,
      at: 0,
      length: 1,
      tech: "bend",
      bend: 2,
    });
    expect(r.notes).toContainEqual({ string: 1, fret: 5, at: 1, length: 0.25 });
    expect(r.notes).toContainEqual({ string: 1, fret: 7, at: 1.25, length: 0.5, tech: "slide" });
    expect(r.notes).toContainEqual({ string: 2, fret: 0, at: 0, length: 1.75, tech: "palm" });
  });

  it("joins systems one after another and explains what it cannot read", () => {
    const one = ["5-", "--", "--", "--", "--", "--"];
    const r = parsed([...one, ...one].map((x) => x)).beats;
    expect(r).toBe(2);
    const bad = parseTab(tab(["5x8", "-", "-", "-", "-", "-"]));
    expect(bad.ok ? "" : bad.errors[0]).toContain('unexpected "x"');
    expect(parseTab("5 8 10").ok).toBe(false);
  });
});

describe("TAB_EXAMPLE", () => {
  it("reads as the notes its comment promises", () => {
    const r = parseTab(TAB_EXAMPLE);
    if (!r.ok) throw new Error(r.errors.join("; "));
    const at = (string: number) =>
      r.notes.filter((n) => n.string === string).map((n) => `${n.fret}@${n.at}${n.tech ?? ""}`);
    expect(at(1)).toEqual(["5@0", "8@0.5hammer", "5@1pull"]);
    expect(at(2)).toEqual(["7@2bend"]);
    expect(at(5)).toEqual(["12@3"]);
    expect(at(6)).toEqual(["0@0palm", "0@1palm", "0@3"]);
    expect(r.beats).toBe(4);
  });
});

describe("formatTab", () => {
  it("writes a tab that parseTab reads back as the same notes", () => {
    const riff: Riff = {
      ...good,
      beats: 4,
      notes: [
        { string: 1, fret: 12, at: 0, length: 0.5 },
        { string: 1, fret: 14, at: 0.5, length: 0.5, tech: "hammer" },
        { string: 2, fret: 7, at: 0.5, length: 1, tech: "bend", bend: 2 },
        { string: 6, fret: 0, at: 1, length: 1, tech: "palm" },
        { string: 5, fret: 5, at: 3, length: 1, tech: "slide" },
      ],
    };
    const back = parseTab(formatTab(riff));
    expect(back.ok).toBe(true);
    const strip = (ns: Riff["notes"]) =>
      ns.map(({ length, ...n }) => n).sort((a, b) => a.at - b.at || a.string - b.string);
    if (back.ok) {
      expect(strip(back.notes)).toEqual(strip(riff.notes));
      expect(back.beats).toBe(4);
    }
  });
});
