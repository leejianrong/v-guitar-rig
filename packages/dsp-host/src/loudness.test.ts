import { describe, expect, it } from "vitest";
import { LoudnessMeter, measureLoudness } from "./loudness";

const SR = 48000;
const sine = (hz: number, amp: number, seconds: number) =>
  Float32Array.from(
    { length: SR * seconds },
    (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR),
  );
const db = (x: number) => 10 ** (x / 20);

describe("loudness meter", () => {
  it("reads the EBU reference: a 1 kHz sine at -23 dBFS on both channels is -23.0 LUFS", () => {
    const r = measureLoudness(sine(1000, db(-23), 10), SR);
    expect(r.integrated).toBeCloseTo(-23, 1);
    expect(r.shortTermMax).toBeCloseTo(-23, 1);
    expect(r.peak).toBeCloseTo(-23, 1);
  });

  it("weights frequencies like the ear: the same level reads quieter at 50 Hz and louder at 3 kHz", () => {
    const at = (hz: number) => measureLoudness(sine(hz, db(-23), 6), SR).integrated;
    expect(at(50)).toBeLessThan(at(1000) - 1);
    expect(at(3000)).toBeGreaterThan(at(1000) + 2);
  });

  it("gates out silence, so a quiet pause does not drag the integrated reading down", () => {
    const loud = sine(1000, db(-20), 4);
    const mixed = new Float32Array(SR * 12);
    mixed.set(loud, 0);
    mixed.set(loud, SR * 8);
    // blocks that straddle an edge are part of the programme, so a little under -20; ungated it would be -21.8
    const got = measureLoudness(mixed, SR).integrated;
    expect(got).toBeGreaterThan(-20.4);
    expect(got).toBeLessThan(-20);
  });

  it("follows the moment, forgets on reset, and reads silence as the floor", () => {
    const m = new LoudnessMeter(SR);
    m.push(sine(1000, db(-14), 8));
    expect(m.read().momentary).toBeCloseTo(-14, 1);
    m.push(new Float32Array(SR)); // a second of silence: the last 400 ms are empty
    expect(m.read().momentary).toBeLessThan(-100);
    expect(m.read().integrated).toBeCloseTo(-14, 0); // the loud part is still the programme
    m.reset();
    expect(m.read()).toEqual({ momentary: -120, shortTerm: -120, integrated: -120, peak: -120 });
  });
});
