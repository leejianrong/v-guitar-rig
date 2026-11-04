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

export type RiffValidation = { ok: true; riff: Riff } | { ok: false; errors: string[] };

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const TECHS: readonly string[] = ["hammer", "pull", "slide", "bend", "palm"];
export const MAX_NOTES = 512;
export const MAX_FRET = 24;

export function validateRiff(input: unknown): RiffValidation {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    return { ok: false, errors: ["riff must be a JSON object"] };
  const r = input as Record<string, unknown>;
  const errors: string[] = [];
  const num = (v: unknown, lo: number, hi: number) => typeof v === "number" && v >= lo && v <= hi;
  if (r.schema !== 1) errors.push("`schema` must be 1");
  if (typeof r.id !== "string" || !SLUG.test(r.id) || r.id.length > 60)
    errors.push("`id` must be a lowercase slug of at most 60 characters");
  if (typeof r.name !== "string" || r.name.length === 0 || r.name.length > 60)
    errors.push("`name` must be 1 to 60 characters");
  if (!num(r.bpm, 30, 300)) errors.push("`bpm` must be a number from 30 to 300");
  if (!num(r.beats, 0.25, 64)) errors.push("`beats` must be a number from 0.25 to 64");
  if (!Number.isInteger(r.rev) || (r.rev as number) < 0)
    errors.push("`rev` must be a non-negative integer");
  if (!Array.isArray(r.notes) || r.notes.length === 0 || r.notes.length > MAX_NOTES)
    errors.push(`\`notes\` must be a list of 1 to ${MAX_NOTES} notes`);
  else
    for (const [i, n] of (r.notes as (Record<string, unknown> | null)[]).entries()) {
      const bad = (what: string) => errors.push(`notes[${i}]: ${what}`);
      if (typeof n !== "object" || n === null) {
        bad("must be an object");
        continue;
      }
      if (!Number.isInteger(n.string) || !num(n.string, 1, 6)) bad("`string` must be 1 to 6");
      if (!Number.isInteger(n.fret) || !num(n.fret, 0, MAX_FRET))
        bad(`\`fret\` must be a whole number from 0 to ${MAX_FRET}`);
      if (!num(n.at, 0, 64) || (typeof n.at === "number" && n.at >= (r.beats as number)))
        bad("`at` must start inside the riff (0 up to `beats`)");
      if (!num(n.length, 0.01, 64)) bad("`length` must be a number of beats above 0");
      if (n.tech !== undefined && !TECHS.includes(n.tech as string))
        bad(`\`tech\` must be one of ${TECHS.join(", ")}`);
      if (n.bend !== undefined && (n.tech !== "bend" || !num(n.bend, 0.5, 4)))
        bad('`bend` is 0.5 to 4 semitones and goes with tech "bend"');
    }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, riff: input as Riff };
}

/** `notes` with each length set the way a tab implies: until the next note on its string, or the end. */
export function relength(notes: RiffNote[], beats: number, min = 0.25): RiffNote[] {
  return notes.map((n) => {
    const next = notes.filter((m) => m.string === n.string && m.at > n.at).map((m) => m.at);
    return { ...n, length: Math.max(Math.min(...next, beats) - n.at, min) };
  });
}

/** A tab in the layout `formatTab` writes: first digits line up, marks take no time (see `parseTab`). */
export const TAB_EXAMPLE = `e|5-h8p5---------|
B|--------7b9----|
G|---------------|
D|---------------|
A|------------12-|
E|0m---0m-----0--|`;

export type TabParse =
  | { ok: true; notes: RiffNote[]; beats: number }
  | { ok: false; errors: string[] };

const CONNECTORS = "hp/\\bm";
const isDigit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";

/**
 * ASCII tab to notes. Six lines of `e|--5h8p5--|` (high string first); more than six lines are read as
 * the next system after the first. One column is one `step` of time, so notes line up as they do on
 * the page. Digits and the marks around them take no time of their own, so `10` and `5h8` work:
 * `h` hammer-on, `p` pull-off, `/` or `\` slide, `7b9` bend from 7 up to 9, `0m` palm mute.
 * A note rings until the next note on its string, or the end of the riff.
 */
export function parseTab(text: string, step = 0.5): TabParse {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const body = lines.map((l) => /^[A-Ga-g#]?\s*\|(.*)$/.exec(l)?.[1]?.replaceAll("|", ""));
  if (lines.length === 0 || lines.length % 6 !== 0 || body.some((b) => b === undefined))
    return {
      ok: false,
      errors: ["a tab is 6 lines (high string first), each like `e|--5h8--|`"],
    };
  const errors: string[] = [];
  const notes: RiffNote[] = [];
  let slots = 0;
  for (let sys = 0; sys < lines.length; sys += 6) {
    const rows = body.slice(sys, sys + 6) as string[];
    const width = Math.max(...rows.map((r) => r.length));
    const at: number[] = []; // slot columns before each column
    let count = 0;
    for (let c = 0; c < width; c++) {
      at.push(count);
      const joins = rows.some((r) => {
        const ch = r[c];
        return (
          ch !== undefined &&
          (CONNECTORS.includes(ch) || (isDigit(ch) && (isDigit(r[c - 1]) || r[c - 1] === "b")))
        );
      });
      if (!joins) count++;
    }
    rows.forEach((row, s) => {
      let tech: RiffNote["tech"];
      let last: RiffNote | undefined;
      for (let c = 0; c < row.length; c++) {
        const ch = row[c] as string;
        if (isDigit(ch)) {
          let end = c;
          while (isDigit(row[end + 1])) end++;
          const fret = Number(row.slice(c, end + 1));
          if (row[c - 1] === "b" && last) {
            last.tech = "bend";
            last.bend = fret - last.fret;
          } else {
            last = {
              string: s + 1,
              fret,
              at: (slots + (at[c] as number)) * step,
              length: 0,
              ...(tech && { tech }),
            };
            tech = undefined;
            notes.push(last);
          }
          c = end;
        } else if (ch === "h" || ch === "p") tech = ch === "h" ? "hammer" : "pull";
        else if (ch === "/" || ch === "\\") tech = "slide";
        else if (ch === "m" && last) last.tech = "palm";
        else if (ch !== "-" && ch !== "b")
          errors.push(`string ${s + 1}, column ${c + 1}: unexpected "${ch}"`);
      }
    });
    slots += count;
  }
  const beats = slots * step;
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, notes: relength(notes, beats, step), beats };
}

/** The tab text for `riff`, notes snapped to `step`. The inverse of `parseTab` for everything but lengths. */
export function formatTab(riff: Riff, step = 0.5): string {
  const slots = Math.max(1, Math.round(riff.beats / step));
  const names = ["e", "B", "G", "D", "A", "E"];
  const rows = names.map(() => "");
  for (let s = 0; s < slots; s++) {
    const here = riff.notes.filter((n) => Math.round(n.at / step) === s);
    const piece = (string: number) => {
      const n = here.find((m) => m.string === string);
      if (!n) return { pre: "", digits: "", post: "" };
      const pre = { hammer: "h", pull: "p", slide: "/" }[n.tech as string] ?? "";
      const post =
        n.tech === "palm"
          ? "m"
          : n.tech === "bend"
            ? `b${n.fret + Math.max(1, Math.round(n.bend ?? 1))}`
            : "";
      return { pre, digits: String(n.fret), post };
    };
    const ps = [1, 2, 3, 4, 5, 6].map(piece);
    const pre = Math.max(0, ...ps.map((p) => p.pre.length));
    const post = Math.max(1, ...ps.map((p) => p.digits.length + p.post.length));
    ps.forEach((p, i) => {
      const note = p.digits.length > 0;
      rows[i] += note
        ? `${"-".repeat(pre - p.pre.length)}${p.pre}${(p.digits + p.post).padEnd(post, "-")}`
        : "-".repeat(pre + post);
    });
  }
  return rows.map((r, i) => `${names[i]}|${r}|`).join("\n");
}

/** A riff built from ASCII tab and the few things a tab does not say; validated like any other. */
export function riffFromTab(o: {
  id: string;
  name?: string;
  bpm?: number;
  step?: number;
  tab: string;
}): RiffValidation {
  const t = parseTab(o.tab, o.step);
  if (!t.ok) return t;
  return validateRiff({
    schema: 1,
    id: o.id,
    name: o.name ?? o.id,
    bpm: o.bpm ?? 100,
    beats: t.beats,
    notes: t.notes,
    rev: 0,
  });
}
