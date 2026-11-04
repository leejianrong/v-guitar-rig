import { amp, powerampModule, preampModule } from "./amp";
import { cab } from "./cab";
import type { ModuleDef, Processor } from "./modules";

const TWO_PI = 2 * Math.PI;
const lp = (hz: number, sr: number) => 1 - Math.exp((-TWO_PI * hz) / sr);

const overdrive: ModuleDef = {
  id: "overdrive@1",
  name: "Overdrive",
  category: "drive",
  description: "Soft tanh clipping with a tone control. Warm, touch-sensitive crunch.",
  params: [
    { id: "drive", label: "Drive", min: 1, max: 40, default: 6, unit: "x", taper: "log" },
    { id: "tone", label: "Tone", min: 800, max: 8000, default: 3000, unit: "Hz", taper: "log" },
    { id: "level", label: "Level", min: 0, max: 1.5, default: 0.7, unit: "x", taper: "linear" },
  ],
  create(sr) {
    let y = 0;
    return {
      process(input, output, p) {
        const a = lp(p.tone ?? 3000, sr);
        for (let i = 0; i < input.length; i++) {
          y += a * (Math.tanh((input[i] ?? 0) * (p.drive ?? 1)) - y);
          output[i] = y * (p.level ?? 1);
        }
      },
    };
  },
};

const fuzz: ModuleDef = {
  id: "fuzz@1",
  name: "Fuzz",
  category: "drive",
  description: "Asymmetric hard clipping: gated, spitty and thick.",
  params: [
    { id: "fuzz", label: "Fuzz", min: 1, max: 100, default: 30, unit: "x", taper: "log" },
    { id: "level", label: "Level", min: 0, max: 1, default: 0.4, unit: "x", taper: "linear" },
  ],
  create() {
    return {
      process(input, output, p) {
        for (let i = 0; i < input.length; i++) {
          const x = (input[i] ?? 0) * (p.fuzz ?? 1);
          output[i] =
            (x > 0 ? Math.tanh(x) : Math.max(-0.55, Math.tanh(x * 1.6) * 0.8)) * (p.level ?? 1);
        }
      },
    };
  },
};

const delay: ModuleDef = {
  id: "delay@1",
  name: "Delay",
  category: "time",
  description: "Clean digital echoes with feedback.",
  params: [
    { id: "time", label: "Time", min: 20, max: 1000, default: 380, unit: "ms", taper: "log" },
    {
      id: "feedback",
      label: "Feedback",
      min: 0,
      max: 0.95,
      default: 0.4,
      unit: "",
      taper: "linear",
    },
    { id: "mix", label: "Mix", min: 0, max: 1, default: 0.3, unit: "", taper: "linear" },
  ],
  visual: (p) => {
    const [ms, fb, mix] = [p.time ?? 380, p.feedback ?? 0, p.mix ?? 0];
    const taps = [];
    for (let n = 1; n <= 16 && n * ms <= 3000; n++) {
      const level = mix * fb ** (n - 1);
      if (level < 0.01) break;
      taps.push({ ms: n * ms, level });
    }
    return { kind: "echoes", taps };
  },
  create(sr) {
    const buf = new Float32Array(Math.ceil(sr * 1.05));
    let w = 0;
    return {
      process(input, output, p) {
        const d = ((p.time ?? 300) / 1000) * sr;
        for (let i = 0; i < input.length; i++) {
          const pos = (w - d + buf.length) % buf.length;
          const i0 = Math.floor(pos);
          const f = pos - i0;
          const wet = (buf[i0] ?? 0) * (1 - f) + (buf[(i0 + 1) % buf.length] ?? 0) * f;
          const x = input[i] ?? 0;
          buf[w] = x + wet * (p.feedback ?? 0);
          w = (w + 1) % buf.length;
          output[i] = x + wet * (p.mix ?? 0);
        }
      },
    };
  },
};

const chorus: ModuleDef = {
  id: "chorus@1",
  name: "Chorus",
  category: "mod",
  description: "A slowly swept short delay mixed back in for shimmer.",
  params: [
    { id: "rate", label: "Rate", min: 0.1, max: 8, default: 0.8, unit: "Hz", taper: "log" },
    { id: "depth", label: "Depth", min: 0, max: 1, default: 0.5, unit: "", taper: "linear" },
    { id: "mix", label: "Mix", min: 0, max: 1, default: 0.5, unit: "", taper: "linear" },
  ],
  visual: (p) => ({
    kind: "sweep",
    rateHz: p.rate ?? 1,
    minMs: 12 - 6 * (p.depth ?? 0),
    maxMs: 12 + 6 * (p.depth ?? 0),
  }),
  create(sr) {
    const buf = new Float32Array(Math.ceil(sr * 0.05));
    let w = 0;
    let phase = 0;
    return {
      process(input, output, p) {
        for (let i = 0; i < input.length; i++) {
          phase = (phase + (p.rate ?? 1) / sr) % 1;
          const d = ((12 + Math.sin(TWO_PI * phase) * 6 * (p.depth ?? 0)) / 1000) * sr;
          const pos = (w - d + buf.length) % buf.length;
          const i0 = Math.floor(pos);
          const f = pos - i0;
          const wet = (buf[i0] ?? 0) * (1 - f) + (buf[(i0 + 1) % buf.length] ?? 0) * f;
          const x = input[i] ?? 0;
          buf[w] = x;
          w = (w + 1) % buf.length;
          output[i] = x * (1 - (p.mix ?? 0) * 0.5) + wet * (p.mix ?? 0);
        }
      },
    };
  },
};

const COMB_MS = [25.3, 26.9, 28.9, 30.7];
const ALLPASS_MS = [12.6, 10.0];

const reverb: ModuleDef = {
  id: "reverb@1",
  name: "Reverb",
  category: "time",
  description: "Four damped combs into two allpasses: a small room that grows to a hall.",
  params: [
    { id: "size", label: "Size", min: 0, max: 1, default: 0.6, unit: "", taper: "linear" },
    { id: "mix", label: "Mix", min: 0, max: 1, default: 0.3, unit: "", taper: "linear" },
  ],
  create(sr): Processor {
    const mk = (ms: number) => new Float32Array(Math.round((ms / 1000) * sr));
    const combs = COMB_MS.map((ms) => ({ b: mk(ms), i: 0, s: 0 }));
    const aps = ALLPASS_MS.map((ms) => ({ b: mk(ms), i: 0 }));
    return {
      process(input, output, p) {
        const fb = 0.7 + 0.28 * (p.size ?? 0.5);
        for (let n = 0; n < input.length; n++) {
          const x = input[n] ?? 0;
          let acc = 0;
          for (const c of combs) {
            const o = c.b[c.i] ?? 0;
            c.s += 0.3 * (o - c.s); // damping
            c.b[c.i] = x * 0.25 + c.s * fb;
            c.i = (c.i + 1) % c.b.length;
            acc += o;
          }
          for (const a of aps) {
            const o = a.b[a.i] ?? 0;
            a.b[a.i] = acc + o * 0.5;
            acc = o - acc * 0.5;
            a.i = (a.i + 1) % a.b.length;
          }
          output[n] = x + acc * (p.mix ?? 0);
        }
      },
    };
  },
};

const gate: ModuleDef = {
  id: "noise-gate@1",
  name: "Noise Gate",
  category: "dynamics",
  description: "Closes when you stop playing so amp hiss and hum drop out.",
  params: [
    {
      id: "threshold",
      label: "Threshold",
      min: -80,
      max: -20,
      default: -55,
      unit: "dB",
      taper: "linear",
    },
    { id: "release", label: "Release", min: 10, max: 500, default: 80, unit: "ms", taper: "log" },
  ],
  create(sr) {
    let env = 0;
    let g = 1;
    return {
      process(input, output, p) {
        const thr = 10 ** ((p.threshold ?? -55) / 20);
        const rel = Math.exp(-1 / (((p.release ?? 80) / 1000) * sr));
        for (let i = 0; i < input.length; i++) {
          const x = input[i] ?? 0;
          env = Math.max(Math.abs(x), env * rel);
          const open = env > thr ? 1 : 0;
          g += (open - g) * (open ? 0.05 : 0.002);
          output[i] = x * g;
        }
      },
    };
  },
};

export const STARTER: ModuleDef[] = [
  overdrive,
  fuzz,
  delay,
  chorus,
  reverb,
  gate,
  preampModule,
  powerampModule,
  amp,
  cab,
];
