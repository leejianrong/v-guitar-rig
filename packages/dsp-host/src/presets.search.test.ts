import { searchPresets } from "@rig/shared";
import { describe, expect, it } from "vitest";
import { STARTER_PRESETS } from "./presets";

/** Ten requests as a person would type them, each with a tag the top result must carry. */
const PROMPTS: [string, string][] = [
  ["I want to sound like David Gilmour", "artist:david-gilmour"],
  ["something dreamy and ambient for pads", "ambient"],
  ["heavy metal riffing, tight and scooped", "genre:metal"],
  ["warm clean jazz chords", "genre:jazz"],
  ["bluesy crunch like Clapton", "genre:blues"],
  ["surf guitar with lots of reverb", "genre:surf"],
  ["shoegaze wall of sound", "genre:shoegaze"],
  ["sparkly country clean", "genre:country"],
  ["fuzzy psychedelic Hendrix", "artist:jimi-hendrix"],
  ["rockabilly with a slapback echo", "genre:rockabilly"],
];

describe("searching the starter presets", () => {
  it("returns a preset whose tags match for at least 8 of 10 prompts", () => {
    const results = PROMPTS.map(([q, tag]) => {
      const top = searchPresets(STARTER_PRESETS, q)[0];
      return { q, tag, got: top?.id, ok: !!top?.tags.includes(tag) };
    });
    console.log(results.map((r) => `${r.ok ? "ok  " : "MISS"} ${r.q} -> ${r.got}`).join("\n"));
    expect(results.filter((r) => r.ok).length).toBeGreaterThanOrEqual(8);
  });

  it("is deterministic and independent of the order the library is given in", () => {
    const q = "dreamy clean ambient";
    const a = searchPresets(STARTER_PRESETS, q);
    expect(searchPresets(STARTER_PRESETS, q)).toEqual(a);
    expect(searchPresets([...STARTER_PRESETS].reverse(), q)).toEqual(a);
  });
});
