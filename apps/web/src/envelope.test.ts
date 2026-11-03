import { describe, expect, it } from "vitest";
import { Envelope, toDb } from "./envelope";

const SR = 48000;
const ms = (t: number) => Math.round((t / 1000) * SR);

describe("Envelope", () => {
  it("reaches 90% of a step up within the attack time, and not much sooner", () => {
    const e = new Envelope(SR, 5, 150);
    const ramp = (n: number) => e.run(new Float32Array(n).fill(1));
    expect(ramp(ms(5))).toBeCloseTo(0.9, 2);
    expect(new Envelope(SR, 5, 150).run(new Float32Array(ms(2)).fill(1))).toBeLessThan(0.7);
  });

  it("falls to 10% of a held level within the release time", () => {
    const e = new Envelope(SR, 5, 150);
    e.run(new Float32Array(ms(200)).fill(1));
    e.run(new Float32Array(ms(150)).fill(0));
    expect(e.run(new Float32Array(1))).toBeCloseTo(0.1, 1);
  });

  it("reads a half-scale step as about -6 dB", () => {
    const e = new Envelope(SR);
    e.run(new Float32Array(ms(100)).fill(0.5));
    expect(toDb(e.run(new Float32Array(8).fill(0.5)))).toBeCloseTo(-6, 0);
  });
});
