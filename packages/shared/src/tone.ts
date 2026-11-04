import { loopInsertAt, type Slot } from "./board";

/** One knob move: add `by` to a param, kept within `[min, max]` (the module's own range clamps the rest). */
interface Step {
  module: string;
  param: string;
  by: number;
  max: number;
  /** The param's default, used when the slot did not set it. */
  fallback: number;
}

/**
 * How tone words become knob moves, so an agent can nudge a loaded preset and check it with `render`.
 * The MCP prompt prints these; tests apply them, so the documented numbers are the tested ones.
 */
export const TONE_RULES = {
  spacier: {
    words: ["spacier", "spacey", "dreamier", "dreamy", "more ambient"],
    steps: [
      { module: "delay@1", param: "feedback", by: 0.15, max: 0.85, fallback: 0.4 },
      { module: "delay@1", param: "mix", by: 0.1, max: 0.6, fallback: 0.3 },
      { module: "reverb@1", param: "mix", by: 0.15, max: 0.8, fallback: 0.3 },
      { module: "reverb@1", param: "size", by: 0.1, max: 1, fallback: 0.6 },
    ] as Step[],
    expect: "tailMs rises",
  },
};

/**
 * Apply a rule to a board's slots and return new slots. A delay or reverb the board lacks is added at its
 * defaults first, so "more spacey" works on a board with neither.
 */
export function applyTone(slots: Slot[], rule: keyof typeof TONE_RULES): Slot[] {
  const next = slots.map((s) => ({ ...s, params: { ...s.params } }));
  for (const step of TONE_RULES[rule].steps) {
    let slot = next.find((s) => s.module === step.module && !s.bypass);
    if (!slot) {
      slot = {
        id: step.module.split("@")[0] as string,
        module: step.module,
        bypass: false,
        params: {},
      };
      const loop = loopInsertAt(next); // time effects belong in the amp's loop when it has one
      if (loop >= 0) next.splice(loop, 0, slot);
      else next.push(slot);
    }
    slot.params[step.param] = Math.min(
      step.max,
      (slot.params[step.param] ?? step.fallback) + step.by,
    );
  }
  return next;
}
