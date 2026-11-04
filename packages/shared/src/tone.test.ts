import { describe, expect, it } from "vitest";
import { applyTone } from "./tone";

describe("applyTone on an amp with an effects loop", () => {
  it("adds the delay and reverb it lacks inside the loop, before the power amp", () => {
    const slot = (module: string) => ({ id: module, module, bypass: false, params: {} });
    const rig = [slot("preamp@1"), slot("poweramp@1"), slot("cab@1")];
    const order = applyTone(rig, "spacier").map((s) => s.module);
    expect(order.indexOf("delay@1")).toBeLessThan(order.indexOf("poweramp@1"));
    expect(order.indexOf("reverb@1")).toBeLessThan(order.indexOf("poweramp@1"));
    expect(order.indexOf("delay@1")).toBeGreaterThan(order.indexOf("preamp@1"));
    // a board without a loop still gets them on the end
    expect(
      applyTone([slot("amp@1"), slot("cab@1")], "spacier")
        .map((s) => s.module)
        .slice(-2),
    ).toEqual(["delay@1", "reverb@1"]);
  });
});
