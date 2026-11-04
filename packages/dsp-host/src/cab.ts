import { design, newBiquad, run } from "./biquad";
import { Convolver, irSpectra } from "./convolver";
import type { ModuleDef } from "./modules";

const BLOCK = 128;
const IR_LENGTH = 1024; // 21 ms at 48 kHz: the speaker's body, without a room

type Stage = ["hp" | "lp" | "peak", number, number, number]; // kind, Hz, dB (peaks), Q

/** Four speaker voicings, built from filters so they are original and need no licence. */
const CABS: { name: string; stages: Stage[] }[] = [
  {
    name: "Open 1x12",
    stages: [
      ["hp", 90, 0, 0.7],
      ["peak", 120, 4, 1.2],
      ["peak", 2500, 3, 1],
      ["lp", 5500, 0, 0.7],
      ["lp", 5500, 0, 0.7],
    ],
  },
  {
    name: "Combo 2x12",
    stages: [
      ["hp", 80, 0, 0.7],
      ["peak", 100, 5, 1.1],
      ["peak", 3000, 2, 1],
      ["lp", 5000, 0, 0.7],
      ["lp", 5000, 0, 0.7],
    ],
  },
  {
    name: "Closed 4x12",
    stages: [
      ["hp", 70, 0, 0.7],
      ["peak", 90, 6, 1.1],
      ["peak", 700, -3, 0.8],
      ["peak", 2000, 4, 1.2],
      ["lp", 4500, 0, 0.7],
      ["lp", 4500, 0, 0.7],
    ],
  },
  {
    name: "Bright 1x10",
    stages: [
      ["hp", 110, 0, 0.7],
      ["peak", 3500, 5, 1],
      ["lp", 7000, 0, 0.7],
      ["lp", 7000, 0, 0.7],
    ],
  },
];

/** The impulse response of cab `index`, scaled to unit gain at 1 kHz and faded out at the tail. */
export function cabIr(index: number, sampleRate: number): Float32Array {
  const filters =
    (CABS[index] ?? CABS[0])?.stages.map(([kind, hz, db, q]) => {
      const f = newBiquad();
      design(f, kind, Math.min(hz, 0.45 * sampleRate), sampleRate, db, q);
      return f;
    }) ?? [];
  const ir = new Float64Array(IR_LENGTH);
  for (let i = 0; i < IR_LENGTH; i++) {
    let x = i === 0 ? 1 : 0;
    for (const f of filters) x = run(f, x);
    const fade =
      i < IR_LENGTH * 0.75
        ? 1
        : 0.5 + 0.5 * Math.cos((Math.PI * (i - IR_LENGTH * 0.75)) / (IR_LENGTH * 0.25));
    ir[i] = x * fade;
  }
  let [re, im] = [0, 0]; // gain at 1 kHz, by direct DFT
  for (let i = 0; i < IR_LENGTH; i++) {
    re += (ir[i] as number) * Math.cos((2 * Math.PI * 1000 * i) / sampleRate);
    im -= (ir[i] as number) * Math.sin((2 * Math.PI * 1000 * i) / sampleRate);
  }
  const norm = 1 / Math.hypot(re, im);
  return Float32Array.from(ir, (v) => v * norm);
}

const FADE_BLOCKS = 4;

export const cab: ModuleDef = {
  id: "cab@1",
  name: "Speaker Cab",
  category: "cab",
  description:
    "A guitar speaker cabinet as an impulse response, run by partitioned convolution. Takes the fizz off an amp.",
  params: [
    {
      id: "cab",
      label: "Cab",
      min: 0,
      max: CABS.length - 1,
      default: 1,
      unit: "voicing",
      taper: "linear",
    },
    { id: "level", label: "Level", min: 0, max: 2, default: 1, unit: "x", taper: "linear" },
  ],
  create(sr) {
    // all four are built now, so switching allocates nothing in the audio callback
    const convs = CABS.map((_, i) => new Convolver(irSpectra(cabIr(i, sr), BLOCK), BLOCK));
    const pick = (v: number) => Math.min(CABS.length - 1, Math.max(0, Math.round(v)));
    let active = pick(1);
    let leaving = -1;
    let left = 0; // samples of crossfade still to run
    const [a, b] = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
    return {
      process(input, output, p) {
        const want = pick(p.cab ?? 1);
        if (want !== active) {
          leaving = active; // keeps running while it fades out, so the swap does not click
          active = want;
          (convs[active] as Convolver).reset();
          left = FADE_BLOCKS * BLOCK;
        }
        (convs[active] as Convolver).process(input, a);
        if (leaving >= 0) {
          (convs[leaving] as Convolver).process(input, b);
          for (let i = 0; i < BLOCK; i++) {
            const old = Math.max(0, left - i) / (FADE_BLOCKS * BLOCK); // weight of the old cab
            a[i] = (a[i] as number) * (1 - old) + (b[i] as number) * old;
          }
          left -= BLOCK;
          if (left <= 0) leaving = -1;
        }
        const level = p.level ?? 1;
        for (let i = 0; i < BLOCK; i++) output[i] = (a[i] as number) * level;
      },
    };
  },
};
