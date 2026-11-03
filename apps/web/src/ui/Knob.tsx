import { knobToValue, type ParamSpec, valueToKnob } from "@rig/shared";
import { useEffect, useRef } from "react";
import { formatValue } from "./finish";

const SWEEP = 270; // degrees of travel, centred on straight up
const PX_FULL = 180; // pixels of drag for the whole range
const WHEEL_FULL = 1500; // wheel delta for the whole range: a mouse notch (100) is about 7%
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
  const dial = useRef<HTMLDivElement>(null);
  const latest = useRef({ pos, set });
  latest.current = { pos, set };

  // A clicked knob holds focus ("selected"); only then does the wheel turn it, so the page still scrolls.
  // React's onWheel is passive and cannot stop the page scrolling, hence the native listener.
  useEffect(() => {
    const el = dial.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (document.activeElement !== el) return;
      e.preventDefault();
      latest.current.set(latest.current.pos - e.deltaY / WHEEL_FULL);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div className="knob">
      <div
        ref={dial}
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
