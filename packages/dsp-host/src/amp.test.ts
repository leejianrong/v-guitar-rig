import { describe, expect, it } from "vitest";
import { amp, powerampModule, preampModule } from "./amp";
import { BLOCK } from "./chain";
import { spectralDescriptors, thdPercent } from "./describe";

const SR = 48000;
const defaults = Object.fromEntries(amp.params.map((p) => [p.id, p.default]));

function play(x: Float32Array, params: Record<string, number> = {}): Float32Array {
  const proc = amp.create(SR, {} as WebAssembly.Module);
  const out = new Float32Array(x.length);
  const o = new Float32Array(BLOCK);
  const p = { ...defaults, ...params };
  for (let at = 0; at + BLOCK <= x.length; at += BLOCK) {
    proc.process(x.subarray(at, at + BLOCK), o, p);
    out.set(o, at);
  }
  return out;
}
const tone = (amp_: number, n = SR, hz = 110) =>
  Float32Array.from({ length: n }, (_, i) => amp_ * Math.sin((2 * Math.PI * hz * i) / SR));
/** Seeded white noise (an LCG), so every band has energy. */
const noise = (n: number) => {
  let s = 12345;
  return Float32Array.from({ length: n }, () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s / 2 ** 32 - 0.5) * 1.4;
  });
};
const rms = (x: Float32Array) => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);

describe("valve amp", () => {
  it("stays finite and at or under master at every knob extreme, for hostile input", () => {
    const stimuli = [
      Float32Array.from({ length: BLOCK * 200 }, (_, i) => (i === 0 ? 1 : 0)),
      noise(BLOCK * 200),
      Float32Array.from({ length: BLOCK * 200 }, (_, i) => (Math.floor(i / 60) % 2 ? 1 : -1)),
      new Float32Array(BLOCK * 200).fill(1),
    ];
    for (const edge of ["min", "max"] as const)
      for (const p of amp.params) {
        const params = Object.fromEntries(
          amp.params.map((q) => [q.id, edge === "min" ? q.min : q.max]),
        );
        params[p.id] = edge === "min" ? p.max : p.min; // and each knob against the rest
        for (const x of stimuli) {
          const y = play(x, params);
          expect(y.every(Number.isFinite)).toBe(true);
          expect(Math.max(...y.map(Math.abs))).toBeLessThanOrEqual((params.master ?? 1.5) + 1e-9);
        }
      }
  });

  it("more Gain means more distortion (THD of a 110 Hz tone)", () => {
    const thd = (gain: number) => thdPercent(play(tone(0.25), { gain }), SR, 110);
    expect(thd(40)).toBeGreaterThan(thd(2) + 10);
  });

  it("Treble tilts the balance toward the highs, Bass toward the lows", () => {
    // bands are shares of the total, so compare two bands against each other
    const b = (p: Record<string, number>) =>
      spectralDescriptors(play(noise(SR), { gain: 1.5, ...p }), SR).bandsDb;
    const tilt = (p: Record<string, number>) => b(p).high - b(p).mid;
    expect(tilt({ treble: 1 }) - tilt({ treble: 0 })).toBeGreaterThan(6);
    const low = (p: Record<string, number>) => b(p).low - b(p).mid;
    expect(low({ bass: 1 }) - low({ bass: 0 })).toBeGreaterThan(6);
  });

  it("Sag eases the level of a loud sustained note", () => {
    const loud = tone(0.9, SR * 2);
    const tail = (sag: number) => rms(play(loud, { sag, gain: 4 }).subarray(SR));
    expect(20 * Math.log10(tail(0) / tail(1))).toBeGreaterThan(1);
  });
});

describe("preamp and power amp", () => {
  const through = (m: typeof amp, x: Float32Array, params: Record<string, number> = {}) => {
    const proc = m.create(SR, {} as WebAssembly.Module);
    const all = { ...Object.fromEntries(m.params.map((q) => [q.id, q.default])), ...params };
    const out = new Float32Array(x.length);
    const o = new Float32Array(BLOCK);
    for (let at = 0; at + BLOCK <= x.length; at += BLOCK) {
      proc.process(x.subarray(at, at + BLOCK), o, all);
      out.set(o, at);
    }
    return out;
  };
  const knobs = { gain: 30, bass: 0.7, mid: 0.4, treble: 0.6, sag: 0.6, master: 1 };
  const boost = (x: Float32Array, k: number) => x.map((v) => v * k);
  const peak = (x: Float32Array) => x.reduce((a, v) => Math.max(a, Math.abs(v)), 0);

  it("in series are the whole amp, to within 32-bit rounding at the join", () => {
    const x = tone(0.5, SR / 2);
    const split = through(powerampModule, through(preampModule, x, knobs), knobs);
    const whole = through(amp, x, knobs);
    const worst = whole.reduce((a, v, i) => Math.max(a, Math.abs(v - (split[i] as number))), 0);
    expect(worst).toBeLessThan(1e-5);
  });

  it("push a loop pedal through the power stage, which a pedal after the amp skips", () => {
    // a 3x boost standing in for any loop pedal that raises the level
    const x = tone(0.4, SR / 2);
    const pre = through(preampModule, x, knobs);
    const inLoop = through(powerampModule, boost(pre, 3), knobs);
    const afterAmp = boost(through(powerampModule, pre, knobs), 3);
    expect(peak(inLoop)).toBeLessThanOrEqual(knobs.master); // the output tubes clip it
    expect(peak(afterAmp)).toBeGreaterThan(1.5 * knobs.master); // nothing stops it
  });
});
