import { describe, expect, it } from "vitest";
import type { Preset } from "./preset";
import { searchPresets } from "./search";

const p = (id: string, tags: string[], name = id, description = "x"): Preset => ({
  schema: 1,
  id,
  name,
  description,
  tags,
  rev: 0,
  slots: [],
});
const lib = [
  p("a-lead", ["lead", "artist:david-gilmour", "dreamy"]),
  p("b-blues", ["crunch", "genre:blues", "era:60s"]),
  p("c-metal", ["high-gain", "genre:metal"]),
];

describe("searchPresets", () => {
  it("ranks an artist match above a descriptor match, and reports what matched", () => {
    const hits = searchPresets(lib, "dreamy david gilmour");
    expect(hits[0]?.id).toBe("a-lead");
    expect(hits[0]?.matched).toEqual(expect.arrayContaining(["artist:david-gilmour", "dreamy"]));
  });
  it("stems endings and understands synonyms", () => {
    expect(searchPresets(lib, "bluesy")[0]?.id).toBe("b-blues");
    expect(searchPresets(lib, "heavy")[0]?.id).toBe("c-metal");
  });
  it("breaks ties by id, and drops presets that match nothing", () => {
    const tie = [p("z-x", ["crunch"]), p("m-x", ["crunch"]), p("n-y", ["clean"])];
    expect(searchPresets(tie, "crunch").map((h) => h.id)).toEqual(["m-x", "z-x"]);
    expect(searchPresets(lib, "xylophone")).toEqual([]);
  });
  it("matches the 60s era by word or by spelled-out decade", () => {
    expect(searchPresets(lib, "sixties")[0]?.id).toBe("b-blues");
  });
});
