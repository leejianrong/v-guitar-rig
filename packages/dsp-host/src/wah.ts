import type { ModuleDef } from "./modules";

const HEEL_HZ = 350;
const TOE_HZ = 2200;

/** The filter's centre for a treadle position from 0 (heel) to 1 (toe), in Hz. */
export const wahHz = (pos: number) => HEEL_HZ * (TOE_HZ / HEEL_HZ) ** pos;
const MAKEUP = 2.2; // a narrow band-pass is quiet; this keeps a guitar near its own level

/**
 * A wah: a resonant band-pass whose centre follows the treadle, 350 Hz at the heel to 2.2 kHz at the toe,
 * evenly in pitch. With Auto above zero an LFO rocks the treadle by itself. Sits in front of the amp.
 */
export const wah: ModuleDef = {
  id: "wah@1",
  name: "Wah",
  category: "drive",
  description:
    "A resonant band-pass swept by a treadle (350 Hz at the heel to 2.2 kHz at the toe), or by itself in auto mode.",
  params: [
    { id: "pedal", label: "Treadle", min: 0, max: 1, default: 0.5, unit: "", taper: "linear" },
    { id: "resonance", label: "Resonance", min: 1, max: 12, default: 5, unit: "", taper: "log" },
    { id: "auto", label: "Auto", min: 0, max: 6, default: 0, unit: "Hz", taper: "linear" },
  ],
  create(sr) {
    // a state-variable filter that stays stable while its centre moves every sample
    let [ic1, ic2] = [0, 0];
    let phase = 0;
    return {
      process(input, output, p) {
        const k = 1 / (p.resonance ?? 5);
        const [treadle, auto] = [p.pedal ?? 0.5, p.auto ?? 0];
        for (let i = 0; i < input.length; i++) {
          let pos = treadle;
          if (auto > 0) {
            phase = (phase + auto / sr) % 1;
            pos = Math.min(1, Math.max(0, treadle + 0.5 * Math.sin(2 * Math.PI * phase)));
          }
          const g = Math.tan((Math.PI * wahHz(pos)) / sr);
          const a1 = 1 / (1 + g * (g + k));
          const a2 = g * a1;
          const x = input[i] ?? 0;
          const v3 = x - ic2;
          const v1 = a1 * ic1 + a2 * v3;
          const v2 = ic2 + a2 * ic1 + g * a2 * v3;
          ic1 = 2 * v1 - ic1;
          ic2 = 2 * v2 - ic2;
          output[i] = k * v1 * MAKEUP; // k * band-pass has unit gain at the centre
        }
      },
    };
  },
};
