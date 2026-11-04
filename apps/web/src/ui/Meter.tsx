import type { Loudness } from "@rig/dsp-host";
import { useEffect, useState } from "react";
import type { Rig } from "../audio";

const SILENT: Loudness = { momentary: -120, shortTerm: -120, integrated: -120, peak: -120 };
const LUFS_RANGE = [-50, 0] as const;
const PEAK_RANGE = [-60, 0] as const;

const show = (v: number) => (v <= -100 ? "-" : v.toFixed(1));
const pct = (v: number, [lo, hi]: readonly [number, number]) =>
  `${Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100))}%`;

function Row({
  label,
  unit,
  value,
  range,
  hot,
}: {
  label: string;
  unit: string;
  value: number;
  range: readonly [number, number];
  hot?: boolean;
}) {
  return (
    <div className="meterrow">
      <span className="metername">{label}</span>
      <output className="meterval" data-testid={`meter-${label.toLowerCase()}`}>
        {show(value)}
      </output>
      <span className="meterunit">{unit}</span>
      <div className="meterbar" aria-hidden="true">
        <div className={`meterfill${hot ? " hot" : ""}`} style={{ width: pct(value, range) }} />
      </div>
    </div>
  );
}

/** Loudness of the chain output, so a tone's level can be read instead of guessed. */
export function Meter({ rig }: { rig: Rig | null }) {
  const [m, setM] = useState<Loudness>(SILENT);
  useEffect(() => {
    setM(SILENT);
    return rig?.onMeter(setM);
  }, [rig]);
  return (
    <section className="meter" aria-label="Output meter">
      <h2>Level</h2>
      <Row label="Momentary" unit="LUFS" value={m.momentary} range={LUFS_RANGE} />
      <Row label="Short-term" unit="LUFS" value={m.shortTerm} range={LUFS_RANGE} />
      <Row label="Integrated" unit="LUFS" value={m.integrated} range={LUFS_RANGE} />
      <Row label="Peak" unit="dBFS" value={m.peak} range={PEAK_RANGE} hot={m.peak > -1} />
      <button type="button" disabled={!rig} onClick={() => rig?.resetMeter()}>
        Reset
      </button>
    </section>
  );
}
