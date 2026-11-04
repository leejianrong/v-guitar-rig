import type { Preset } from "./preset";

export interface SearchHit {
  id: string;
  name: string;
  description: string;
  tags: string[];
  score: number;
  /** The tags that matched, for the agent to quote back. */
  matched: string[];
}

const STOP = new Set(
  "i want to sound like the a an of with some my me guitar tone sound sounds and for in on that is it be make get can you please give style".split(
    " ",
  ),
);

/** Words people use that mean a tag we have. */
const SYNONYMS: Record<string, string[]> = {
  spacy: ["spacey"],
  space: ["spacey"],
  cosmic: ["spacey"],
  floaty: ["dreamy", "ambient"],
  ethereal: ["dreamy", "ambient"],
  atmospheric: ["ambient"],
  pad: ["ambient"],
  pads: ["ambient"],
  heavy: ["high-gain", "metal"],
  distorted: ["high-gain", "crunch"],
  distortion: ["high-gain", "crunch"],
  gritty: ["crunch"],
  overdriven: ["crunch"],
  overdrive: ["crunch"],
  sparkly: ["bright"],
  chimey: ["bright"],
  jangly: ["bright", "indie"],
  shimmery: ["bright"],
  mellow: ["dark", "warm"],
  smooth: ["warm"],
  round: ["warm", "dark"],
  solo: ["lead"],
  singing: ["lead", "sustain"],
  seventies: ["70s"],
  eighties: ["80s"],
  sixties: ["60s"],
  nineties: ["90s"],
  fifties: ["50s"],
  fuzzy: ["fuzz"],
  twang: ["bright"],
  twangy: ["bright"],
};

/** Bands and nicknames that stand for an artist or a genre tag. Multi-word keys match as phrases. */
const PHRASES: Record<string, string[]> = {
  "pink floyd": ["artist:david-gilmour", "genre:progressive"],
  floyd: ["artist:david-gilmour", "genre:progressive"],
  hendrix: ["artist:jimi-hendrix"],
  clapton: ["artist:eric-clapton"],
  "wall of sound": ["genre:shoegaze"],
  "hard rock": ["genre:hard-rock"],
  "heavy metal": ["genre:metal"],
  u2: ["artist:the-edge"],
};

/** Strip a plural, adjective or gerund ending so "bluesy", "blues" and "blue" compare alike. */
const stem = (w: string): string => {
  const next = w.replace(/(ing|ed|y|s)$/, "");
  return next !== w && next.length >= 3 ? stem(next) : w;
};

const WEIGHT = { artist: 5, genre: 3, era: 2, plain: 2 } as const;

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w));

/** Tags this query asks for, as stems of single words plus whole tags named by phrase. */
function wanted(query: string): { stems: Set<string>; tags: Set<string> } {
  const q = query.toLowerCase().replace(/[^a-z0-9\s-]/g, " ");
  const tags = new Set<string>();
  for (const [phrase, t] of Object.entries(PHRASES))
    if (` ${q} `.includes(` ${phrase} `)) for (const x of t) tags.add(x);
  const stems = new Set<string>();
  for (const w of words(q)) {
    stems.add(stem(w));
    for (const s of SYNONYMS[w] ?? []) stems.add(stem(s));
  }
  return { stems, tags };
}

/** The words a tag is known by: its value (split on `-`) and, for `kind:value`, nothing else. */
const tagStems = (tag: string) => (tag.split(":")[1] ?? tag).split("-").map(stem);

/**
 * Rank presets for a free-text request. Pure and deterministic: the same library and query always give the
 * same order (score, then id). Artist, genre, era and descriptor tags score differently; words in the name or
 * description add a little. Presets that match nothing are left out.
 */
export function searchPresets(presets: Preset[], query: string): SearchHit[] {
  const { stems, tags } = wanted(query);
  const hits: SearchHit[] = [];
  for (const p of presets) {
    let score = 0;
    const matched: string[] = [];
    for (const tag of p.tags) {
      const kind = tag.includes(":") ? (tag.split(":")[0] as keyof typeof WEIGHT) : "plain";
      const stemsOfTag = tagStems(tag);
      const long = (s: string) => s.length >= 4 || kind !== "artist"; // a surname, not a stray syllable
      const byWord =
        stemsOfTag.some((s) => stems.has(s) && long(s)) || stems.has(stemsOfTag.join("-"));
      if (tags.has(tag) || byWord) {
        score += WEIGHT[kind] ?? WEIGHT.plain;
        matched.push(tag);
      }
    }
    for (const w of words(`${p.name} ${p.description}`))
      if (stems.has(stem(w)) && w.length > 3) score += 0.25;
    if (score > 0)
      hits.push({
        id: p.id,
        name: p.name,
        description: p.description,
        tags: p.tags,
        score,
        matched,
      });
  }
  return hits.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
}
