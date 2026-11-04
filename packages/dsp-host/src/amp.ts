import type { ParamSpec } from "@rig/shared";
import { design, newBiquad, run } from "./biquad";
import type { ModuleDef, Processor } from "./modules";

/** A triode-like stage: asymmetric, so it adds even harmonics as well as odd. */
const triode = (x: number) => (x >= 0 ? Math.tanh(x) : (Math.tanh(x * 0.7) / 0.7) * 0.85);

const knobDb = (v: number, range: number) => (v - 0.5) * 2 * range;

type Params = Record<string, number>;
/** One half of the amp: `set` reads the knobs once per block, `tick` runs one sample. */
interface Stage {
  set(p: Params): void;
  tick(x: number): number;
}

const PREAMP_PARAMS: ParamSpec[] = [
  { id: "gain", label: "Gain", min: 1, max: 80, default: 8, unit: "x", taper: "log" },
  { id: "bass", label: "Bass", min: 0, max: 1, default: 0.5, unit: "", taper: "linear" },
  { id: "mid", label: "Mid", min: 0, max: 1, default: 0.5, unit: "", taper: "linear" },
  { id: "treble", label: "Treble", min: 0, max: 1, default: 0.5, unit: "", taper: "linear" },
];
const POWER_PARAMS: ParamSpec[] = [
  { id: "sag", label: "Sag", min: 0, max: 1, default: 0.3, unit: "", taper: "linear" },
  { id: "master", label: "Master", min: 0, max: 1.5, default: 0.7, unit: "x", taper: "linear" },
];

/** Tight low end, two valve stages at 2x, DC block, then the bass/mid/treble stack. */
function preamp(sr: number): Stage {
  const [tight, bass, mid, treble] = [newBiquad(), newBiquad(), newBiquad(), newBiquad()];
  const [aa1, aa2] = [newBiquad(), newBiquad()]; // anti-alias low-pass at 2x rate
  design(tight, "low", 80, sr, -12, 0.7); // a low shelf cut tightens the bottom end
  design(aa1, "lp", 0.45 * sr, 2 * sr, 0, 0.54);
  design(aa2, "lp", 0.45 * sr, 2 * sr, 0, 1.31);
  let [lastB, lastM, lastT] = [Number.NaN, Number.NaN, Number.NaN];
  let prev = 0; // previous input sample, for the linear-interpolated 2x upsample
  let [dcIn, dcOut] = [0, 0]; // the asymmetric stages add a DC offset; block it
  let g = 1;
  return {
    set(p) {
      const [b, m, t] = [p.bass ?? 0.5, p.mid ?? 0.5, p.treble ?? 0.5];
      if (b !== lastB) design(bass, "low", 120, sr, knobDb(b, 12), 0.7);
      if (m !== lastM) design(mid, "peak", 650, sr, knobDb(m, 10), 0.7);
      if (t !== lastT) design(treble, "high", 3000, sr, knobDb(t, 12), 0.7);
      [lastB, lastM, lastT] = [b, m, t];
      g = Math.sqrt(p.gain ?? 8); // gain is shared between the two stages
    },
    tick(input) {
      const x = run(tight, input);
      // preamp at 2x rate: two valve stages, then low-pass and keep every second sample
      const mid2 = (prev + x) / 2;
      prev = x;
      run(aa1, run(aa2, triode(g * triode(g * mid2) * 0.8)));
      const wet = run(aa1, run(aa2, triode(g * triode(g * x) * 0.8)));
      const y = wet - dcIn + 0.995 * dcOut;
      [dcIn, dcOut] = [wet, y];
      return run(treble, run(mid, run(bass, y)));
    },
  };
}

/** Loud passages pull the supply down, so gain eases and recovers slowly; then the output tubes clip. */
function power(sr: number): Stage {
  let env = 0;
  let [sag, master] = [0, 0.7];
  const attack = 1 - Math.exp(-1 / (0.005 * sr));
  const release = 1 - Math.exp(-1 / (0.15 * sr));
  return {
    set(p) {
      sag = p.sag ?? 0;
      master = p.master ?? 0.7;
    },
    tick(x) {
      const a = Math.abs(x);
      env += (a > env ? attack : release) * (a - env);
      return Math.tanh(1.2 * x * (1 - 0.5 * sag * Math.min(1, env))) * master;
    },
  };
}

const module = (
  id: string,
  name: string,
  description: string,
  params: ParamSpec[],
  stages: (sr: number) => Stage[],
): ModuleDef => ({
  id,
  name,
  category: "amp",
  description,
  params,
  create(sr): Processor {
    const chain = stages(sr);
    return {
      process(input, output, p) {
        for (const s of chain) s.set(p);
        for (let i = 0; i < input.length; i++) {
          let v = input[i] ?? 0;
          for (const s of chain) v = s.tick(v);
          output[i] = v;
        }
      },
    };
  },
});

export const preampModule = module(
  "preamp@1",
  "Valve Preamp",
  "Two-stage valve-style preamp and a bass/mid/treble stack. Pedals placed after it, before the power amp, are the effects loop.",
  PREAMP_PARAMS,
  (sr) => [preamp(sr)],
);

export const powerampModule = module(
  "poweramp@1",
  "Power Amp",
  "A power stage that sags under loud playing and clips gently. Whatever sits before it, in the effects loop, is pushed through it.",
  POWER_PARAMS,
  (sr) => [power(sr)],
);

/** The whole amp in one module: the preamp and the power amp with nothing in the loop between them. */
export const amp = module(
  "amp@1",
  "Valve Amp",
  "Two-stage valve-style preamp, bass/mid/treble stack and a power stage that sags under loud playing.",
  [...PREAMP_PARAMS, ...POWER_PARAMS],
  (sr) => [preamp(sr), power(sr)],
);
