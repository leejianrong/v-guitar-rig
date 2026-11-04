import { wahHz } from "@rig/dsp-host";
import type { ParamSpec } from "@rig/shared";
import { useEffect, useRef } from "react";
import { formatValue } from "./finish";

const PX_FULL = 120; // pixels of drag for heel to toe
const WHEEL_FULL = 1000;
const KEY_STEP: Record<string, number | "min" | "max"> = {
  ArrowUp: 0.04,
  ArrowRight: 0.04,
  ArrowDown: -0.04,
  ArrowLeft: -0.04,
  PageUp: 0.2,
  PageDown: -0.2,
  Home: "min",
  End: "max",
};

/** A wah's rocker: drag it, scroll it or use the arrow keys; up is toe down, a higher sweep. */
export function Treadle({
  spec,
  value,
  onChange,
}: {
  spec: ParamSpec;
  value: number;
  onChange: (v: number) => void;
}) {
  const drag = useRef<{ y: number; p: number } | null>(null);
  const plate = useRef<HTMLDivElement>(null);
  const set = (p: number) => onChange(Math.min(1, Math.max(0, p)));
  const latest = useRef({ value, set });
  latest.current = { value, set };

  // like the knobs, the wheel only moves a focused treadle so the page still scrolls
  useEffect(() => {
    const el = plate.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (document.activeElement !== el) return;
      e.preventDefault();
      latest.current.set(latest.current.value - e.deltaY / WHEEL_FULL);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div className="treadle">
      <div
        ref={plate}
        className="treadle-plate"
        role="slider"
        tabIndex={0}
        aria-label={spec.label}
        aria-valuemin={spec.min}
        aria-valuemax={spec.max}
        aria-valuenow={Number(value.toFixed(4))}
        aria-valuetext={`${formatValue(wahHz(value), "Hz")} centre`}
        style={{ transform: `perspective(260px) rotateX(${(value - 0.5) * 38}deg)` }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { y: e.clientY, p: value };
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
          set(step === "min" ? 0 : step === "max" ? 1 : value + step * (e.shiftKey ? 3 : 1));
        }}
      />
      <span className="knob-label">{spec.label}</span>
      <span className="knob-value">{formatValue(wahHz(value), "Hz")}</span>
    </div>
  );
}
