import type { ModuleDef } from "@rig/dsp-host";
import { useEffect, useRef } from "react";
import type { Pair, Rig } from "../audio";
import { levelNear, powerDb } from "../fft";

const F_MIN = 40;
const F_MAX = 16000;
const DB_MIN = -100;
const W = 900;
const H = 200;

const rms = (x: Float32Array) =>
  Math.sqrt(x.reduce((a, v) => a + v * v, 0) / Math.max(1, x.length));

/** Latest pair of frames, for tests and the debug hook. */
let latest: { pair: Pair; before: Float32Array; after: Float32Array; rate: number } | null = null;
export const pairLevels = (freq = 110) =>
  latest && {
    slot: latest.pair.slot,
    before: rms(latest.pair.before),
    after: rms(latest.pair.after),
    beforeDb: levelNear(latest.before, latest.rate, freq),
    afterDb: levelNear(latest.after, latest.rate, freq),
  };

const xOf = (f: number) => (Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN)) * W;
const yOf = (db: number) => (Math.max(DB_MIN, Math.min(0, db)) / DB_MIN) * H; // 0 dB at the top

function trace(g: CanvasRenderingContext2D, db: Float32Array, rate: number, colour: string) {
  const hz = rate / (db.length * 2);
  g.strokeStyle = colour;
  g.lineWidth = 1.5;
  g.beginPath();
  for (let x = 0; x < W; x++) {
    const f = F_MIN * (F_MAX / F_MIN) ** (x / W);
    const at = f / hz; // between bins: interpolate, or the low end draws as stairs
    const [lo, t] = [Math.floor(at), at - Math.floor(at)];
    const v = (db[lo] ?? DB_MIN) * (1 - t) + (db[lo + 1] ?? DB_MIN) * t;
    if (x === 0) g.moveTo(x, yOf(v));
    else g.lineTo(x, yOf(v));
  }
  g.stroke();
}

function drawSpectra(
  c: HTMLCanvasElement,
  before: Float32Array,
  after: Float32Array,
  rate: number,
) {
  const g = c.getContext("2d");
  if (!g) return;
  g.fillStyle = "#0b0d0f";
  g.fillRect(0, 0, W, H);
  g.font = "11px 'IBM Plex Mono', monospace";
  g.fillStyle = "#8d949b";
  g.strokeStyle = "#1f2429";
  g.lineWidth = 1;
  for (const db of [-20, -40, -60, -80]) {
    g.beginPath();
    g.moveTo(0, yOf(db));
    g.lineTo(W, yOf(db));
    g.stroke();
    g.fillText(`${db} dB`, 6, yOf(db) - 3);
  }
  for (const f of [100, 1000, 10000]) {
    g.beginPath();
    g.moveTo(xOf(f), 0);
    g.lineTo(xOf(f), H);
    g.stroke();
    g.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, xOf(f) + 4, H - 6);
  }
  trace(g, before, rate, "#6b7680");
  trace(g, after, rate, "#ffb347");
}

/** What the selected pedal is doing to the signal. */
export function Inspector({ def, rig }: { def: ModuleDef; rig: Rig | null }) {
  const spec = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    latest = null;
    return rig?.onPair((pair) => {
      const [before, after] = [powerDb(pair.before), powerDb(pair.after)];
      latest = { pair, before, after, rate: rig.sampleRate };
      if (spec.current) drawSpectra(spec.current, before, after, rig.sampleRate);
    });
  }, [rig]);
  return (
    <section className="inspector" aria-label="Pedal inspector">
      <h2>
        Inspecting <span>{def.name}</span>
      </h2>
      <figure>
        <canvas ref={spec} width={W} height={H} aria-label="Spectrum before and after" />
        <figcaption>
          <i className="key before" /> in <i className="key after" /> out
        </figcaption>
      </figure>
    </section>
  );
}
