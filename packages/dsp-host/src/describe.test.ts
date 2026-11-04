import { describe, expect, it } from "vitest";
import { spectralDescriptors, thdPercent } from "./describe";

const SR = 48000;
const sine = (hz: number, amp: number, n = SR) =>
  Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR));
const clipped = (hz: number, amp: number, clip: number) =>
  sine(hz, amp).map((v) => Math.max(-clip, Math.min(clip, v)));

/** Harmonic n of a signal with whole cycles in it, by direct correlation: an independent route to THD. */
function harmonic(x: Float32Array, f0: number, n: number) {
  let [re, im] = [0, 0];
  x.forEach((v, i) => {
    re += v * Math.cos((2 * Math.PI * n * f0 * i) / SR);
    im += v * Math.sin((2 * Math.PI * n * f0 * i) / SR);
  });
  return (2 * Math.hypot(re, im)) / x.length;
}

describe("spectralDescriptors", () => {
  it("reads a half-scale 1 kHz sine by hand calculation", () => {
    const d = spectralDescriptors(sine(1000, 0.5), SR);
    expect(d.rmsDb).toBeCloseTo(20 * Math.log10(0.5 / Math.SQRT2), 1); // -9.03
    expect(d.peakDb).toBeCloseTo(20 * Math.log10(0.5), 1); // -6.02
    expect(d.crestDb).toBeCloseTo(3.01, 1); // a sine's crest factor is sqrt 2
    expect(Math.abs(d.centroidHz - 1000)).toBeLessThan(40);
    expect(d.bandsDb.mid).toBeGreaterThan(-0.5); // essentially all of it is in 800 Hz-3 kHz
    expect(d.bandsDb.air).toBeLessThan(-40);
  });

  it("puts the centroid higher for a brighter signal", () => {
    expect(spectralDescriptors(sine(4000, 0.3), SR).centroidHz).toBeGreaterThan(
      spectralDescriptors(sine(200, 0.3), SR).centroidHz * 10,
    );
  });

  it("clipping a sine lowers its crest factor", () => {
    expect(spectralDescriptors(clipped(110, 0.9, 0.3), SR).crestDb).toBeLessThan(
      spectralDescriptors(sine(110, 0.9), SR).crestDb - 1,
    );
  });

  it("reads silence as zeros, not NaN", () => {
    const d = spectralDescriptors(new Float32Array(SR), SR);
    expect(d.centroidHz).toBe(0);
    expect(Number.isFinite(d.rmsDb)).toBe(true);
  });
});

describe("thdPercent", () => {
  it("is near zero for a pure sine", () =>
    expect(thdPercent(sine(110, 0.25), SR, 110)).toBeLessThan(0.1));

  it("matches a direct calculation for a hard-clipped sine", () => {
    // 100 Hz has whole cycles in the second, so the correlation is exact
    const x = clipped(100, 0.9, 0.3);
    const f = harmonic(x, 100, 1);
    let h = 0;
    for (let n = 2; n <= 8; n++) h += harmonic(x, 100, n) ** 2;
    const expected = (100 * Math.sqrt(h)) / f;
    expect(Math.abs(thdPercent(x, SR, 100) - expected) / expected).toBeLessThan(0.03);
  });
});
