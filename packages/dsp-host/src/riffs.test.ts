import { formatTab, parseTab, validateRiff } from "@rig/shared";
import { describe, expect, it } from "vitest";
import { STARTER_RIFFS } from "./riffs";

describe("shipped riffs", () => {
  it.each(STARTER_RIFFS)("$name is valid and survives a round trip through tab text", (riff) => {
    expect(validateRiff(riff).ok).toBe(true);
    const back = parseTab(formatTab(riff));
    if (!back.ok) throw new Error(back.errors.join("; "));
    const key = (ns: typeof riff.notes) =>
      ns.map(({ length: _, ...n }) => JSON.stringify(n, Object.keys(n).sort())).sort();
    expect(key(back.notes)).toEqual(key(riff.notes));
    expect(back.beats).toBe(riff.beats);
  });
});
