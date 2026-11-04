import { describe, expect, it } from "vitest";
import { BLOCK } from "./chain";
import { Fft } from "./fft";
import { renderRiff } from "./guitar";
import { STARTER_RIFFS } from "./riffs";
import { wah } from "./wah";

const SR = 48000;
const defaults = Object.fromEntries(wah.params.map((p) => [p.id, p.default]));

function play(x: Float32Array, params: (at: number) => Record<string, number>): Float32Array {
  const proc = wah.create(SR, {} as WebAssembly.Module);
  const out = new Float32Array(x.length);
  const o = new Float32Array(BLOCK);
  for (let at = 0; at + BLOCK <= x.length; at += BLOCK) {
    proc.process(x.subarray(at, at + BLOCK), o, { ...defaults, ...params(at) });
    out.set(o, at);
  }
  return out;
}
const still = (p: Record<string, number>) => () => p;

/** Seeded white noise: every frequency has energy for the filter to pick from. */
const noise = (n: number) => {
  let s = 99;
  return Float32Array.from({ length: n }, () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s / 2 ** 32 - 0.5) * 1.2;
  });
};

const N = 4096;
const fft = new Fft(N);
/** Power spectrum of `x` from `from`, averaged over `frames` Hann-windowed frames. */
function spectrum(x: Float32Array, from = 0, frames = 20): Float64Array {
  const acc = new Float64Array(N / 2);
  for (let f = 0; f < frames; f++) {
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i++)
      re[i] = (x[from + f * N + i] as number) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
    fft.forward(re, im);
    for (let k = 0; k < N / 2; k++)
      acc[k] = (acc[k] as number) + (re[k] as number) ** 2 + (im[k] as number) ** 2;
  }
  return acc;
}
const hz = (bin: number) => (bin * SR) / N;
const peakHz = (s: Float64Array) => {
  let best = 1;
  for (let k = 2; k < s.length; k++) if ((s[k] as number) > (s[best] as number)) best = k;
  return hz(best);
};
/** Width in Hz where the spectrum is within 3 dB of its peak. */
const widthHz = (s: Float64Array) => {
  const peak = Math.max(...s);
  return hz(s.filter((v) => v > peak / 2).length);
};
const centroid = (x: Float32Array, from: number) => {
  const s = spectrum(x, from, 1);
  let [num, den] = [0, 0];
  for (let k = 1; k < s.length; k++) {
    num += hz(k) * (s[k] as number);
    den += s[k] as number;
  }
  return num / den;
};
const rms = (x: Float32Array) => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);

describe("wah", () => {
  const x = noise(SR * 3);

  it("sweeps from about 350 Hz at the heel to 2.2 kHz at the toe", () => {
    const at = (pedal: number) => peakHz(spectrum(play(x, still({ pedal })), SR));
    expect(at(0)).toBeGreaterThan(350 * 0.85);
    expect(at(0)).toBeLessThan(350 * 1.15);
    expect(at(1)).toBeGreaterThan(2200 * 0.85);
    expect(at(1)).toBeLessThan(2200 * 1.15);
    const middle = Math.sqrt(350 * 2200); // the sweep is even in pitch, not in Hz
    expect(Math.abs(at(0.5) / middle - 1)).toBeLessThan(0.15);
  });

  it("gets narrower with more resonance", () => {
    const width = (resonance: number) =>
      widthHz(spectrum(play(x, still({ pedal: 0.5, resonance })), SR));
    expect(width(10)).toBeLessThan(0.5 * width(2));
  });

  it("sweeps by itself in auto mode, and stays put without it", () => {
    const wander = (auto: number) => {
      const y = play(x, still({ pedal: 0.5, auto }));
      const c = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => centroid(y, SR + i * 6000));
      return Math.max(...c) - Math.min(...c);
    };
    expect(wander(2)).toBeGreaterThan(600);
    expect(wander(0)).toBeLessThan(150);
  });

  it("keeps a guitar at about the level it came in, and stays finite when the treadle is thrown about", () => {
    const riff = STARTER_RIFFS[0];
    if (!riff) throw new Error("no riff");
    const guitar = renderRiff(riff, SR, 1);
    const y = play(guitar, still({ pedal: 0.5 }));
    expect(Math.abs(20 * Math.log10(rms(y) / rms(guitar)))).toBeLessThan(4);

    const thrown = play(noise(SR), (at) => ({
      pedal: Math.floor(at / BLOCK) % 2,
      resonance: 12,
      auto: 6,
    }));
    expect(thrown.every(Number.isFinite)).toBe(true);
    expect(Math.max(...thrown.map(Math.abs))).toBeLessThan(8);
  });
});
