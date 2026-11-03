import type { ModuleDef } from "@rig/dsp-host";

/** What the selected pedal is doing. The widgets for it hang off this panel. */
export function Inspector({ def }: { def: ModuleDef }) {
  return (
    <section className="inspector" aria-label="Pedal inspector">
      <h2>
        Inspecting <span>{def.name}</span>
      </h2>
    </section>
  );
}
