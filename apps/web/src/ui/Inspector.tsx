import type { ModuleDef } from "@rig/dsp-host";
import { useEffect } from "react";
import type { Pair, Rig } from "../audio";

const rms = (x: Float32Array) =>
  Math.sqrt(x.reduce((a, v) => a + v * v, 0) / Math.max(1, x.length));

/** Latest pair of frames, for tests and the debug hook. */
let latest: Pair | null = null;
export const pairLevels = () =>
  latest && { slot: latest.slot, before: rms(latest.before), after: rms(latest.after) };

/** What the selected pedal is doing. The widgets for it hang off this panel. */
export function Inspector({ def, rig }: { def: ModuleDef; rig: Rig | null }) {
  useEffect(() => {
    latest = null;
    return rig?.onPair((p) => {
      latest = p;
    });
  }, [rig]);
  return (
    <section className="inspector" aria-label="Pedal inspector">
      <h2>
        Inspecting <span>{def.name}</span>
      </h2>
    </section>
  );
}
