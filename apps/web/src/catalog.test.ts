import type { Slot } from "@rig/shared";
import { describe, expect, it } from "vitest";
import { withPedal } from "./catalog";

const s = (module: string): Slot => ({ id: module, module, bypass: false, params: {} });
const order = (slots: Slot[]) => slots.map((x) => x.module);

describe("withPedal", () => {
  const rig = [s("overdrive@1"), s("preamp@1"), s("poweramp@1"), s("cab@1")];

  it("puts time and modulation pedals in the amp's effects loop, and others on the end", () => {
    expect(order(withPedal(rig, "delay@1", "time"))).toEqual([
      "overdrive@1",
      "preamp@1",
      "delay@1",
      "poweramp@1",
      "cab@1",
    ]);
    expect(order(withPedal(rig, "chorus@1", "mod")).indexOf("chorus@1")).toBe(2);
    expect(order(withPedal(rig, "fuzz@1", "drive")).at(-1)).toBe("fuzz@1");
  });

  it("appends everything when there is no loop to put it in", () => {
    for (const board of [[s("amp@1"), s("cab@1")], [s("poweramp@1"), s("preamp@1")], []])
      expect(order(withPedal(board, "delay@1", "time")).at(-1)).toBe("delay@1");
  });
});
