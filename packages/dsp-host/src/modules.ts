import type { ParamSpec } from "@rig/shared";
import { DIODE_CLIPPER, RigCircuit } from "./core";
import { STARTER } from "./starter";

/** Per-instance audio processor. Input and output are exactly one 128-frame block. */
export interface Processor {
  process(input: Float32Array, output: Float32Array, p: Readonly<Record<string, number>>): void;
}

/**
 * What a time-based module declares so the host can draw it (ADR-0005: modules never draw). Plain data,
 * computed from the knob values, so generated modules can declare one too.
 */
export type Visual =
  /** Echoes after the dry sound: when each arrives and how loud, relative to the dry level of 1. */
  | { kind: "echoes"; taps: { ms: number; level: number }[] }
  /** A delay time swept sinusoidally between `minMs` and `maxMs`, `rateHz` times a second. */
  | { kind: "sweep"; rateHz: number; minMs: number; maxMs: number };

export interface ModuleDef {
  id: string;
  name: string;
  category: "drive" | "time" | "mod" | "dynamics";
  description: string;
  params: ParamSpec[];
  visual?(params: Readonly<Record<string, number>>): Visual;
  create(sampleRate: number, wasm: WebAssembly.Module): Processor;
}

const BLOCK = 128;
const dbToGain = (db: number) => 10 ** (db / 20);

/** The circuit module: the diode clipper netlist solved in WASM, with drive/level around it. */
const diodeClipper: ModuleDef = {
  id: "diode-clipper@1",
  name: "Diode Clipper",
  category: "drive",
  description: "Two silicon diodes across an RC low-pass, solved from the real circuit.",
  params: [
    { id: "drive", label: "Drive", min: -12, max: 24, default: 0, unit: "dB", taper: "linear" },
    { id: "level", label: "Level", min: 0, max: 2, default: 1, unit: "x", taper: "linear" },
  ],
  create(sampleRate, wasm) {
    const circuit = new RigCircuit(
      new WebAssembly.Instance(wasm, {}),
      DIODE_CLIPPER,
      sampleRate,
      4,
      BLOCK,
    );
    const tmp = new Float32Array(BLOCK);
    return {
      process(input, output, p) {
        const g = dbToGain(p.drive ?? 0);
        for (let i = 0; i < BLOCK; i++) tmp[i] = (input[i] ?? 0) * g;
        circuit.process(tmp, output);
        const level = p.level ?? 1;
        for (let i = 0; i < BLOCK; i++) output[i] = (output[i] ?? 0) * level;
      },
    };
  },
};

export const MODULES: Record<string, ModuleDef> = Object.fromEntries(
  [diodeClipper, ...STARTER].map((m) => [m.id, m]),
);

export const KNOWN_MODULES: ReadonlySet<string> = new Set(Object.keys(MODULES));
