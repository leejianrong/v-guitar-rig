import type { Visual } from "@rig/dsp-host";

const W = 900;
const H = 120;
const PAD = 12;
const SPAN_MS = 2500; // echoes beyond this are off the right edge
const SWEEP_S = 2; // seconds of the sweep shown
const SWEEP_MAX_MS = 20;

const label = { fill: "#8d949b", fontSize: 11, fontFamily: "IBM Plex Mono, monospace" };

function Echoes({ taps }: { taps: { ms: number; level: number }[] }) {
  const x = (ms: number) => PAD + (ms / SPAN_MS) * (W - 2 * PAD);
  const stem = (level: number) => H - 20 - level * (H - 40);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Echo timeline">
      <line x1={PAD} x2={W - PAD} y1={H - 20} y2={H - 20} stroke="#2b3137" />
      <line x1={x(0)} x2={x(0)} y1={H - 20} y2={stem(1)} stroke="#6b7680" strokeWidth={3} />
      {taps.map((t) => (
        <line
          key={t.ms}
          data-testid="echo-tap"
          data-ms={Math.round(t.ms)}
          x1={x(t.ms)}
          x2={x(t.ms)}
          y1={H - 20}
          y2={stem(t.level)}
          stroke="#ffb347"
          strokeWidth={3}
        />
      ))}
      {[0, 1000, 2000].map((ms) => (
        <text key={ms} x={x(ms) + 4} y={H - 5} {...label}>
          {ms === 0 ? "dry" : `${ms / 1000} s`}
        </text>
      ))}
    </svg>
  );
}

function Sweep({ rateHz, minMs, maxMs }: { rateHz: number; minMs: number; maxMs: number }) {
  const y = (ms: number) => H - 20 - (ms / SWEEP_MAX_MS) * (H - 40);
  const mid = (minMs + maxMs) / 2;
  const amp = (maxMs - minMs) / 2;
  const pts = Array.from({ length: 300 }, (_, i) => {
    const t = (i / 299) * SWEEP_S;
    return `${PAD + (i / 299) * (W - 2 * PAD)},${y(mid + amp * Math.sin(2 * Math.PI * rateHz * t))}`;
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Delay sweep over two seconds">
      <line x1={PAD} x2={W - PAD} y1={y(0)} y2={y(0)} stroke="#2b3137" />
      <polyline
        data-testid="sweep"
        data-rate={rateHz}
        points={pts.join(" ")}
        fill="none"
        stroke="#ffb347"
        strokeWidth={2}
      />
      {[0, 10, 20].map((ms) => (
        <text key={ms} x={6} y={y(ms) - 3} {...label}>
          {ms} ms
        </text>
      ))}
    </svg>
  );
}

/** Draws what a module declared. The module never draws; the host does (ADR-0005). */
export function VisualView({ visual }: { visual: Visual }) {
  if (visual.kind === "echoes")
    visual = { ...visual, taps: visual.taps.filter((t) => t.ms <= SPAN_MS) }; // only those on screen
  return (
    <figure>
      {visual.kind === "echoes" ? <Echoes taps={visual.taps} /> : <Sweep {...visual} />}
      <figcaption data-testid="visual-caption">
        {visual.kind === "echoes"
          ? `${visual.taps.length} audible echo${visual.taps.length === 1 ? "" : "es"}, each quieter than the last`
          : `delay swept ${visual.minMs.toFixed(0)} to ${visual.maxMs.toFixed(0)} ms, ${visual.rateHz.toFixed(1)} times a second`}
      </figcaption>
    </figure>
  );
}
