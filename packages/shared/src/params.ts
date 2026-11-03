/** Parameter schema shared by all module kinds (ADR-0003, Q16). */
export type Taper = "linear" | "log" | "audio";

export interface ParamSpec {
  id: string;
  label: string;
  min: number;
  max: number;
  default: number;
  unit: string;
  taper: Taper;
}

/** Map a normalised knob position (0..1) to the parameter's real range. */
export function knobToValue(spec: ParamSpec, position: number): number {
  const p = Math.min(1, Math.max(0, position));
  switch (spec.taper) {
    case "linear":
      return spec.min + p * (spec.max - spec.min);
    case "log":
      return spec.min * (spec.max / spec.min) ** p;
    case "audio":
      return spec.min + p * p * (spec.max - spec.min);
  }
}

/** Inverse of `knobToValue`: where a real value sits on the knob (0..1). */
export function valueToKnob(spec: ParamSpec, value: number): number {
  const v = Math.min(spec.max, Math.max(spec.min, value));
  switch (spec.taper) {
    case "linear":
      return (v - spec.min) / (spec.max - spec.min);
    case "log":
      return Math.log(v / spec.min) / Math.log(spec.max / spec.min);
    case "audio":
      return Math.sqrt((v - spec.min) / (spec.max - spec.min));
  }
}
