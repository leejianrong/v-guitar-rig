import type { Riff } from "@rig/shared";
import { describe, expect, it } from "vitest";
import { GuitarSynth, OPEN_STRINGS, renderRiff } from "./guitar";

const SR = 48000;
const riffOf = (notes: Riff["notes"], beats = 4, bpm = 120): Riff => ({
  schema: 1,
  id: "t",
  name: "t",
  bpm,
  beats,
  notes,
  rev: 0,
});

/** Fundamental in Hz of `x` between samples [from, to), by autocorrelation with parabolic refinement. */
function pitchHz(x: Float32Array, from: number, to: number): number {
  const corr = (lag: number) => {
    let s = 0;
    for (let i = from; i + lag < to; i++) s += (x[i] as number) * (x[i + lag] as number);
    return s;
  };
  let best = 0;
  let bestLag = 0;
  for (let lag = 40; lag < 900; lag++) {
    const c = corr(lag);
    if (c > best) {
      best = c;
      bestLag = lag;
    }
  }
  const [a, b, c] = [corr(bestLag - 1), corr(bestLag), corr(bestLag + 1)];
  return SR / (bestLag + (0.5 * (a - c)) / (a - 2 * b + c));
}

const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);
const cents = (hz: number, ref: number) => 1200 * Math.log2(hz / ref);

describe("guitar synth tuning", () => {
  it("plays every string at its fret to within 2 cents", () => {
    for (let string = 1; string <= 6; string++) {
      for (const fret of [0, 5, 12]) {
        const out = renderRiff(riffOf([{ string, fret, at: 0, length: 3 }]), SR, 0);
        const hz = pitchHz(out, 0.1 * SR, 0.4 * SR);
        const want = midiHz((OPEN_STRINGS[string - 1] as number) + fret);
        expect(
          Math.abs(cents(hz, want)),
          `string ${string} fret ${fret}: ${hz} vs ${want}`,
        ).toBeLessThan(2);
      }
    }
  });
});

const rms = (x: Float32Array, from: number, to: number) => {
  let s = 0;
  for (let i = from; i < to; i++) s += (x[i] as number) ** 2;
  return Math.sqrt(s / (to - from));
};
const peak = (x: Float32Array, from: number, to: number) => {
  let p = 0;
  for (let i = from; i < to; i++) p = Math.max(p, Math.abs(x[i] as number));
  return p;
};
const at = (sec: number) => Math.round(sec * SR);

describe("guitar synth techniques", () => {
  // 120 bpm: one beat is 0.5 s
  it("a hammer-on changes pitch without a new pluck", () => {
    const out = renderRiff(
      riffOf([
        { string: 3, fret: 0, at: 0, length: 1 },
        { string: 3, fret: 2, at: 1, length: 1, tech: "hammer" },
      ]),
      SR,
      0,
    );
    expect(cents(pitchHz(out, at(0.2), at(0.45)), midiHz(55))).toBeLessThan(2);
    expect(Math.abs(cents(pitchHz(out, at(0.7), at(0.95)), midiHz(57)))).toBeLessThan(5);
    // no attack: nothing louder just after the hammer than just before it
    expect(peak(out, at(0.5), at(0.52))).toBeLessThan(1.5 * peak(out, at(0.46), at(0.49)));
  });

  it("a slide lands on its fret and a bend rises by its semitones", () => {
    const slide = renderRiff(
      riffOf([
        { string: 3, fret: 5, at: 0, length: 1 },
        { string: 3, fret: 9, at: 1, length: 2, tech: "slide" },
      ]),
      SR,
      0,
    );
    expect(Math.abs(cents(pitchHz(slide, at(0.8), at(1.0)), midiHz(55 + 9)))).toBeLessThan(8);
    const bend = renderRiff(
      riffOf([{ string: 2, fret: 7, at: 0, length: 2, tech: "bend", bend: 2 }]),
      SR,
      0,
    );
    expect(Math.abs(cents(pitchHz(bend, at(0.5), at(0.75)), midiHz(59 + 7 + 2)))).toBeLessThan(15);
  });

  it("a palm mute dies away much faster than an open note, and a note stops when it ends", () => {
    const decay = (tech?: "palm") => {
      const out = renderRiff(riffOf([{ string: 5, fret: 0, at: 0, length: 4, tech }]), SR, 0);
      return rms(out, at(0.5), at(0.6)) / rms(out, at(0.02), at(0.12));
    };
    expect(decay("palm")).toBeLessThan(0.2 * decay());
    const stop = renderRiff(riffOf([{ string: 5, fret: 0, at: 0, length: 1 }]), SR, 0);
    expect(rms(stop, at(0.7), at(0.8))).toBeLessThan(0.02 * rms(stop, at(0.2), at(0.3)));
  });

  it("plays at a usable guitar level, the same every time, and loops", () => {
    const chord = riffOf(
      [6, 5, 4, 3, 2, 1].map((string, i) => ({
        string,
        fret: [0, 2, 2, 1, 0, 0][i] as number,
        at: 0,
        length: 3,
      })),
    );
    const a = renderRiff(chord, SR, 0);
    expect(peak(a, 0, a.length)).toBeGreaterThan(0.1);
    expect(peak(a, 0, a.length)).toBeLessThan(1);
    expect(renderRiff(chord, SR, 0)).toEqual(a);

    // a one-note, one-second loop: the second pass plucks again
    const synth = new GuitarSynth(SR);
    synth.play(riffOf([{ string: 1, fret: 0, at: 0, length: 0.5 }], 2), true);
    const looped = new Float32Array(3 * SR);
    const block = new Float32Array(128);
    for (let i = 0; i < looped.length; i += 128) {
      synth.process(block);
      looped.set(block.subarray(0, Math.min(128, looped.length - i)), i);
    }
    expect(synth.playing).toBe(true);
    expect(peak(looped, at(0.7), at(0.95))).toBeLessThan(0.05); // silent between plucks
    expect(peak(looped, at(1.0), at(1.1))).toBeGreaterThan(0.1);
    expect(peak(looped, at(2.0), at(2.1))).toBeGreaterThan(0.1);
  });
});
