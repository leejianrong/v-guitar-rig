import { knobToValue, type ParamSpec, valueToKnob } from "@rig/shared";
import { useRef } from "react";
import { formatValue } from "./finish";

const SWEEP = 270; // degrees of travel, centred on straight up
const PX_FULL = 180; // pixels of drag for the whole range
const KEY_STEP: Record<string, number | "min" | "max"> = {
  ArrowUp: 0.02,
  ArrowRight: 0.02,
  ArrowDown: -0.02,
  ArrowLeft: -0.02,
  PageUp: 0.1,
  PageDown: -0.1,
  Home: "min",
  End: "max",
};

export function Knob({
  spec,
  value,
  onChange,
}: {
  spec: ParamSpec;
  value: number;
  onChange: (v: number) => void;
}) {
  const pos = valueToKnob(spec, value);
  const drag = useRef<{ y: number; p: number } | null>(null);
  const set = (p: number) => onChange(knobToValue(spec, Math.min(1, Math.max(0, p))));
  const angle = -SWEEP / 2 + pos * SWEEP;

  return (
    <div className="knob">
      <div
        className="knob-dial"
        role="slider"
        tabIndex={0}
        aria-label={spec.label}
        aria-valuemin={spec.min}
        aria-valuemax={spec.max}
        aria-valuenow={Number(value.toFixed(4))}
        aria-valuetext={formatValue(value, spec.unit)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { y: e.clientY, p: pos };
        }}
        onPointerMove={(e) =>
          drag.current && set(drag.current.p + (drag.current.y - e.clientY) / PX_FULL)
        }
        onPointerUp={() => {
          drag.current = null;
        }}
        onDoubleClick={() => onChange(spec.default)}
        onKeyDown={(e) => {
          const step = KEY_STEP[e.key];
          if (step === undefined) return;
          e.preventDefault();
          set(step === "min" ? 0 : step === "max" ? 1 : pos + step * (e.shiftKey ? 5 : 1));
        }}
      >
        <svg viewBox="-32 -32 64 64" aria-hidden="true">
          <circle r="28" className="knob-skirt" />
          <circle r="22" className="knob-cap" />
          <line y1="-6" y2="-20" className="knob-pointer" transform={`rotate(${angle})`} />
        </svg>
      </div>
      <span className="knob-label">{spec.label}</span>
      <span className="knob-value">{formatValue(value, spec.unit)}</span>
    </div>
  );
}
