import { useEffect, useRef } from "react";
import type { Rig } from "../audio";
import { levelNear, powerDb } from "../fft";

const F_MIN = 40;
const F_MAX = 16000;
const FRAME = 2048;

/** Latest spectrum of the tapped signal, for tests and the debug hook. */
export const latest: { db: Float32Array | null; sampleRate: number } = {
  db: null,
  sampleRate: 48000,
};

export const levelAt = (freq: number) =>
  latest.db ? levelNear(latest.db, latest.sampleRate, freq) : -200;

/** Warm sequential ramp: dark → ember → amber → paper. */
function heat(db: number): string {
  const t = Math.min(1, Math.max(0, (db + 100) / 90));
  const stops = [
    [14, 16, 20],
    [90, 24, 40],
    [226, 92, 36],
    [255, 188, 84],
    [250, 242, 222],
  ] as const;
  const x = t * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const a = stops[i] ?? stops[0];
  const b = stops[i + 1] ?? stops[0];
  return `rgb(${[0, 1, 2].map((k) => Math.round((a[k] ?? 0) * (1 - f) + (b[k] ?? 0) * f)).join(",")})`;
}

export function Scope({ rig, label }: { rig: Rig | null; label: string }) {
  const wave = useRef<HTMLCanvasElement>(null);
  const spec = useRef<HTMLCanvasElement>(null);
  const prev = useRef<Float32Array>(new Float32Array(FRAME));

  useEffect(() => {
    if (!rig) return;
    return rig.onTap((frame) => {
      const w = wave.current?.getContext("2d");
      const s = spec.current?.getContext("2d");
      if (w && wave.current) {
        const c = wave.current;
        w.fillStyle = "#0b0d0f";
        w.fillRect(0, 0, c.width, c.height);
        let start = 1;
        while (start < FRAME / 2 && !((frame[start - 1] ?? 0) < 0 && (frame[start] ?? 0) >= 0))
          start++;
        w.strokeStyle = "#ffb347";
        w.lineWidth = 1.5;
        w.beginPath();
        for (let x = 0; x < c.width; x++) {
          const v = frame[start + Math.floor((x / c.width) * (FRAME / 2))] ?? 0;
          const y = c.height / 2 - Math.max(-1, Math.min(1, v)) * (c.height / 2 - 4);
          if (x === 0) w.moveTo(x, y);
          else w.lineTo(x, y);
        }
        w.stroke();
      }
      const both = new Float32Array(FRAME * 2);
      both.set(prev.current);
      both.set(frame, FRAME);
      prev.current = frame;
      const db = powerDb(both);
      latest.db = db;
      latest.sampleRate = rig.sampleRate;
      if (s && spec.current) {
        const c = spec.current;
        s.drawImage(c, -2, 0);
        const hz = rig.sampleRate / both.length;
        for (let y = 0; y < c.height; y++) {
          const f = F_MIN * (F_MAX / F_MIN) ** (1 - y / c.height);
          s.fillStyle = heat(db[Math.round(f / hz)] ?? -120);
          s.fillRect(c.width - 2, y, 2, 1);
        }
      }
    });
  }, [rig]);

  return (
    <section className="scope" aria-label="Signal view">
      <h2>
        Signal <span>{label}</span>
      </h2>
      <canvas ref={wave} width={900} height={120} aria-label="Waveform" />
      <div className="spec-wrap">
        <canvas ref={spec} width={900} height={220} aria-label="Spectrogram" />
        <ol className="spec-axis" aria-hidden="true">
          {[10000, 1000, 100].map((f) => (
            <li
              key={f}
              style={{ top: `${(1 - Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN)) * 100}%` }}
            >
              {f >= 1000 ? `${f / 1000}k` : f}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
