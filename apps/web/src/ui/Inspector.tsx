import {
  type CurvePoint,
  levelNear,
  MODULES,
  type ModuleInfo,
  measureResponse,
  measureTransfer,
  powerDb,
  type ResponsePoint,
  rolloffHz,
} from "@rig/dsp-host";
import type { Slot } from "@rig/shared";
import { useEffect, useRef, useState } from "react";
import { loadWasm, type Pair, type Rig } from "../audio";
import { Envelope, toDb } from "../envelope";
import { VisualView } from "./Visuals";

const F_MIN = 40;
const F_MAX = 16000;
const DB_MIN = -100;
const W = 900;
const H = 200;
const ENV_H = 110;
const ENV_DB_MIN = -54;
const ENV_DB_MAX = 6; // headroom above full scale, so a full-scale signal does not hug the edge
const RESP_W = 600; // drawn at about the size it is shown, so the labels stay legible
const RESP_H = 320;
const CURVE = 320; // square plot, in canvas pixels
const CURVE_DB = [-60, 6] as const;
const HISTORY = 160; // frames of envelope shown, about 7 s

const rms = (x: Float32Array) =>
  Math.sqrt(x.reduce((a, v) => a + v * v, 0) / Math.max(1, x.length));

/** Latest pair of frames, for tests and the debug hook. */
let latest: {
  pair: Pair;
  before: Float32Array;
  after: Float32Array;
  rate: number;
  envDb: [number, number];
} | null = null;
export const pairLevels = (freq = 110) =>
  latest && {
    slot: latest.pair.slot,
    before: rms(latest.pair.before),
    after: rms(latest.pair.after),
    beforeDb: levelNear(latest.before, latest.rate, freq),
    afterDb: levelNear(latest.after, latest.rate, freq),
    envBeforeDb: latest.envDb[0],
    envAfterDb: latest.envDb[1],
  };

const xOf = (f: number, w = W) => (Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN)) * w;
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

function drawEnvelopes(c: HTMLCanvasElement, before: number[], after: number[]) {
  const g = c.getContext("2d");
  if (!g) return;
  const y = (db: number) =>
    ((ENV_DB_MAX - Math.max(ENV_DB_MIN, Math.min(ENV_DB_MAX, db))) / (ENV_DB_MAX - ENV_DB_MIN)) *
    ENV_H;
  g.fillStyle = "#0b0d0f";
  g.fillRect(0, 0, W, ENV_H);
  g.font = "11px 'IBM Plex Mono', monospace";
  g.fillStyle = "#8d949b";
  g.strokeStyle = "#1f2429";
  g.lineWidth = 1;
  for (const db of [0, -20, -40]) {
    g.beginPath();
    g.moveTo(0, y(db));
    g.lineTo(W, y(db));
    g.stroke();
    g.fillText(`${db} dB`, 6, y(db) - 3);
  }
  for (const [series, colour] of [
    [before, "#6b7680"],
    [after, "#ffb347"],
  ] as const) {
    g.strokeStyle = colour;
    g.lineWidth = 1.5;
    g.beginPath();
    series.forEach((db, i) => {
      const x = W - ((series.length - 1 - i) / (HISTORY - 1)) * W; // newest at the right edge
      if (i === 0) g.moveTo(x, y(db));
      else g.lineTo(x, y(db));
    });
    g.stroke();
  }
}

function drawCurve(c: HTMLCanvasElement, curve: CurvePoint[]) {
  const g = c.getContext("2d");
  if (!g) return;
  const [lo, hi] = CURVE_DB;
  const at = (db: number) => ((Math.max(lo, Math.min(hi, db)) - lo) / (hi - lo)) * CURVE;
  const [px, py] = [(db: number) => at(db), (db: number) => CURVE - at(db)];
  g.fillStyle = "#0b0d0f";
  g.fillRect(0, 0, CURVE, CURVE);
  g.strokeStyle = "#1f2429";
  g.fillStyle = "#8d949b";
  g.font = "11px 'IBM Plex Mono', monospace";
  g.lineWidth = 1;
  for (const db of [-40, -20, 0]) {
    g.beginPath();
    g.moveTo(px(db), 0);
    g.lineTo(px(db), CURVE);
    g.moveTo(0, py(db));
    g.lineTo(CURVE, py(db));
    g.stroke();
    g.fillText(`${db}`, px(db) + 3, CURVE - 4);
    g.fillText(`${db}`, 4, py(db) - 3);
  }
  g.setLineDash([4, 4]); // unity: what a wire would do
  g.strokeStyle = "#6b7680";
  g.beginPath();
  g.moveTo(px(lo), py(lo));
  g.lineTo(px(hi), py(hi));
  g.stroke();
  g.setLineDash([]);
  g.strokeStyle = "#ffb347";
  g.lineWidth = 2;
  g.beginPath();
  curve.forEach((pt, i) => {
    if (i === 0) g.moveTo(px(pt.inDb), py(pt.outDb));
    else g.lineTo(px(pt.inDb), py(pt.outDb));
  });
  g.stroke();
}

function drawResponse(c: HTMLCanvasElement, curve: ResponsePoint[]) {
  const g = c.getContext("2d");
  if (!g) return;
  const top = Math.ceil(Math.max(...curve.map((p) => p.db)) / 6) * 6 + 6; // a 48 dB window under the peak
  const y = (db: number) => ((top - Math.max(top - 48, Math.min(top, db))) / 48) * RESP_H;
  g.fillStyle = "#0b0d0f";
  g.fillRect(0, 0, RESP_W, RESP_H);
  g.font = "11px 'IBM Plex Mono', monospace";
  g.fillStyle = "#8d949b";
  g.strokeStyle = "#1f2429";
  g.lineWidth = 1;
  for (let db = top - 12; db > top - 48; db -= 12) {
    g.beginPath();
    g.moveTo(0, y(db));
    g.lineTo(RESP_W, y(db));
    g.stroke();
    g.fillText(`${db >= 0 ? "+" : ""}${db} dB`, 6, y(db) - 3);
  }
  for (const f of [100, 1000, 10000]) {
    g.beginPath();
    g.moveTo(xOf(f, RESP_W), 0);
    g.lineTo(xOf(f, RESP_W), RESP_H);
    g.stroke();
    g.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, xOf(f, RESP_W) + 4, RESP_H - 6);
  }
  g.strokeStyle = "#ffb347";
  g.lineWidth = 2;
  g.beginPath();
  for (let x = 0; x < RESP_W; x++) {
    const hz = F_MIN * (F_MAX / F_MIN) ** (x / RESP_W);
    const at = Math.min(curve.length - 2, Math.max(0, hz / (curve[0]?.hz ?? 1) - 1));
    const [lo, t] = [Math.floor(at), at - Math.floor(at)];
    const db = (curve[lo]?.db ?? 0) * (1 - t) + (curve[lo + 1]?.db ?? 0) * t;
    if (x === 0) g.moveTo(x, y(db));
    else g.lineTo(x, y(db));
  }
  g.stroke();
}

/** What the selected pedal is doing to the signal. */
export function Inspector({ def, slot, rig }: { def: ModuleInfo; slot: Slot; rig: Rig | null }) {
  const spec = useRef<HTMLCanvasElement>(null);
  const env = useRef<HTMLCanvasElement>(null);
  const gain = useRef<HTMLOutputElement>(null);
  const curveCanvas = useRef<HTMLCanvasElement>(null);
  const respCanvas = useRef<HTMLCanvasElement>(null);
  const [summary, setSummary] = useState("measuring...");
  const [rolloff, setRolloff] = useState("measuring...");

  // Measured on a copy of the module, a moment after the last knob move, so it never touches the live one.
  const params = JSON.stringify(slot.params);
  const visual = def.visual?.(
    Object.fromEntries(def.params.map((s) => [s.id, slot.params[s.id] ?? s.default])),
  );
  // A stored module's code runs only in the audio worklet, so there is nothing to measure on the page.
  const code = MODULES[def.id];
  useEffect(() => {
    if (!code) return;
    let live = true;
    const t = setTimeout(async () => {
      const [wasm, now] = [await loadWasm(), JSON.parse(params)];
      const curve = measureTransfer(code, wasm, now);
      const response = measureResponse(code, wasm, now);
      const [first, last] = [curve[0], curve[curve.length - 1]];
      if (!live || !first || !last || !curveCanvas.current || !respCanvas.current) return;
      drawCurve(curveCanvas.current, curve);
      drawResponse(respCanvas.current, response);
      const cut = rolloffHz(response);
      setRolloff(
        cut === null
          ? "no roll-off below 24 kHz"
          : `falls 3 dB at ${cut >= 1000 ? `${(cut / 1000).toFixed(1)} kHz` : `${Math.round(cut)} Hz`}`,
      );
      const small = first.outDb - first.inDb;
      const top = Math.max(...curve.map((c) => c.outDb));
      setSummary(
        `quiet notes ${small >= 0 ? "+" : ""}${small.toFixed(1)} dB, loudest output ${top.toFixed(1)} dB`,
      );
    }, 120);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [code, params]);
  useEffect(() => {
    latest = null;
    if (!rig) return;
    const [inEnv, outEnv] = [new Envelope(rig.sampleRate), new Envelope(rig.sampleRate)];
    const hist: [number[], number[]] = [[], []];
    return rig.onPair((pair) => {
      const [before, after] = [powerDb(pair.before), powerDb(pair.after)];
      const envDb: [number, number] = [toDb(inEnv.run(pair.before)), toDb(outEnv.run(pair.after))];
      latest = { pair, before, after, rate: rig.sampleRate, envDb };
      hist.forEach((h, i) => {
        h.push(envDb[i] as number);
        if (h.length > HISTORY) h.shift();
      });
      if (spec.current) drawSpectra(spec.current, before, after, rig.sampleRate);
      if (env.current) drawEnvelopes(env.current, hist[0], hist[1]);
      const change = envDb[1] - envDb[0];
      if (gain.current) gain.current.value = `${change >= 0 ? "+" : ""}${change.toFixed(1)} dB`;
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
      {visual && <VisualView visual={visual} />}
      {code ? (
        <>
          <figure className="half">
            <canvas
              ref={curveCanvas}
              width={CURVE}
              height={CURVE}
              className="curve"
              aria-label="Transfer curve: level out against level in"
            />
            <figcaption data-testid="curve-summary">
              measured transfer curve (dashed: a plain wire) · {summary}
            </figcaption>
          </figure>
          <figure className="half">
            <canvas
              ref={respCanvas}
              width={RESP_W}
              height={RESP_H}
              aria-label="Frequency response at a small signal level"
            />
            <figcaption data-testid="response-summary">
              measured frequency response, quiet signal · {rolloff}
            </figcaption>
          </figure>
        </>
      ) : (
        <p className="note" data-testid="no-probe">
          Transfer curve and frequency response are measured for built-in pedals only. This one runs
          in the audio engine, not on the page.
        </p>
      )}
      <figure>
        <canvas ref={env} width={W} height={ENV_H} aria-label="Level over time, in and out" />
        <figcaption>
          level over the last few seconds · gain change <output ref={gain}>-</output>
        </figcaption>
      </figure>
    </section>
  );
}
