/** Enamel colour and screen-print ink for each pedal's enclosure. Chrome only: the DSP never sees this. */
export const FINISH: Record<string, { finish: string; ink: string }> = {
  "diode-clipper@1": { finish: "#2f5d50", ink: "#e9efe7" },
  "overdrive@1": { finish: "#d27a1f", ink: "#1b1206" },
  "fuzz@1": { finish: "#6d3a86", ink: "#f2e9f7" },
  "delay@1": { finish: "#2d6a9a", ink: "#eaf3fa" },
  "chorus@1": { finish: "#2a9d9a", ink: "#06201f" },
  "reverb@1": { finish: "#a9adb3", ink: "#14171a" },
  "amp@1": { finish: "#1d1d20", ink: "#e8c987" },
  "cab@1": { finish: "#5b4636", ink: "#f0e2cf" },
  "noise-gate@1": { finish: "#b83d3a", ink: "#fbeceb" },
};

export const finishFor = (id: string) => FINISH[id] ?? { finish: "#555", ink: "#eee" };

export function formatValue(v: number, unit: string): string {
  if (unit === "Hz") return v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`;
  if (unit === "ms") return `${Math.round(v)} ms`;
  if (unit === "dB") return `${v.toFixed(0)} dB`;
  if (unit === "voicing") return `${Math.round(v) + 1} of 4`; // a selector: whole steps only
  if (unit === "x") return `${v.toFixed(1)}×`;
  return v.toFixed(2);
}
