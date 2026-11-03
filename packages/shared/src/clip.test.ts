import { expect, it } from "vitest";
import { testClip } from "./clip";

it("is deterministic and bounded", () => {
  const a = testClip(48000);
  const b = testClip(48000);
  expect(a).toEqual(b);
  expect(Math.max(...a.map(Math.abs))).toBeLessThan(1);
});
