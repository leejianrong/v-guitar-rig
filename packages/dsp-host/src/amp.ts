import { design, newBiquad, run } from "./biquad";
import type { ModuleDef } from "./modules";

/** A triode-like stage: asymmetric, so it adds even harmonics as well as odd. */
const triode = (x: number) => (x >= 0 ? Math.tanh(x) : (Math.tanh(x * 0.7) / 0.7) * 0.85);

const knobDb = (v: number, range: number) => (v - 0.5) * 2 * range;

export const amp: ModuleDef = {
  id: "amp@1",
  name: "Valve Amp",
  category: "amp",
  description:
    "Two-stage valve-style preamp, bass/mid/treble stack and a power stage that sags under loud playing.",
  params: [
    { id: "gain", label: "Gain", min: 1, max: 80, default: 8, unit: "x", taper: "log" },
    { id: "bass", label: "Bass", min: 0, max: 1, default: 0.5, unit: "", taper: "linear" },
    { id: "mid", label: "Mid", min: 0, max: 1, default: 0.5, unit: "", taper: "linear" },
    { id: "treble", label: "Treble", min: 0, max: 1, default: 0.5, unit: "", taper: "linear" },
    { id: "sag", label: "Sag", min: 0, max: 1, default: 0.3, unit: "", taper: "linear" },
    { id: "master", label: "Master", min: 0, max: 1.5, default: 0.7, unit: "x", taper: "linear" },
  ],
  create(sr) {
    const [tight, bass, mid, treble] = [newBiquad(), newBiquad(), newBiquad(), newBiquad()];
    const [aa1, aa2] = [newBiquad(), newBiquad()]; // anti-alias low-pass at 2x rate
    design(tight, "low", 80, sr, -12, 0.7); // a low shelf cut tightens the bottom end
    design(aa1, "lp", 0.45 * sr, 2 * sr, 0, 0.54);
    design(aa2, "lp", 0.45 * sr, 2 * sr, 0, 1.31);
    let [lastB, lastM, lastT] = [Number.NaN, Number.NaN, Number.NaN];
    let prev = 0; // previous input sample, for the linear-interpolated 2x upsample
    let env = 0;
    let [dcIn, dcOut] = [0, 0]; // the asymmetric stages add a DC offset; block it

    const attack = 1 - Math.exp(-1 / (0.005 * sr));
    const release = 1 - Math.exp(-1 / (0.15 * sr));
    return {
      process(input, output, p) {
        const [b, m, t] = [p.bass ?? 0.5, p.mid ?? 0.5, p.treble ?? 0.5];
        if (b !== lastB) design(bass, "low", 120, sr, knobDb(b, 12), 0.7);
        if (m !== lastM) design(mid, "peak", 650, sr, knobDb(m, 10), 0.7);
        if (t !== lastT) design(treble, "high", 3000, sr, knobDb(t, 12), 0.7);
        [lastB, lastM, lastT] = [b, m, t];
        const g = Math.sqrt(p.gain ?? 8); // gain is shared between the two stages
        const sag = p.sag ?? 0;
        const master = p.master ?? 0.7;
        for (let i = 0; i < input.length; i++) {
          const x = run(tight, input[i] ?? 0);
          // preamp at 2x rate: two valve stages, then low-pass and keep every second sample
          const mid2 = (prev + x) / 2;
          prev = x;
          run(aa1, run(aa2, triode(g * triode(g * mid2) * 0.8)));
          const wet = run(aa1, run(aa2, triode(g * triode(g * x) * 0.8)));
          const y = wet - dcIn + 0.995 * dcOut;
          [dcIn, dcOut] = [wet, y];
          const shaped = run(treble, run(mid, run(bass, y)));
          // power stage: loud passages pull the supply down, so gain eases and recovers slowly
          const a = Math.abs(shaped);
          env += (a > env ? attack : release) * (a - env);
          const sagGain = 1 - 0.5 * sag * Math.min(1, env);
          output[i] = Math.tanh(1.2 * shaped * sagGain) * master;
        }
      },
    };
  },
};
