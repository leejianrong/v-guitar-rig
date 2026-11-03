/** Waveform and log-frequency spectrogram drawn from an AnalyserNode (V4 replaces this with ring-buffer taps). */

export interface Tap {
  analyser: AnalyserNode;
  wave: HTMLCanvasElement;
  spec: HTMLCanvasElement;
  timeBuf: Float32Array<ArrayBuffer>;
  freqBuf: Float32Array<ArrayBuffer>;
}

export function makeTap(ctx: AudioContext, wave: HTMLCanvasElement, spec: HTMLCanvasElement): Tap {
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 16384;
  analyser.smoothingTimeConstant = 0;
  analyser.minDecibels = -120;
  analyser.maxDecibels = 0;
  return {
    analyser,
    wave,
    spec,
    timeBuf: new Float32Array(2048),
    freqBuf: new Float32Array(analyser.frequencyBinCount),
  };
}

const F_MIN = 40;
const F_MAX = 16000;

function color(db: number): string {
  const t = Math.min(1, Math.max(0, (db + 100) / 80));
  const r = Math.round(255 * Math.min(1, t * 2));
  const g = Math.round(255 * Math.max(0, t * 2 - 1) * 0.9);
  const b = Math.round(90 * (1 - t) + 30);
  return `rgb(${r},${g},${b})`;
}

export function draw(tap: Tap, sampleRate: number): void {
  const { analyser, wave, spec } = tap;
  // waveform: latest 2048 samples
  const wctx = wave.getContext("2d");
  if (wctx) {
    analyser.getFloatTimeDomainData(tap.timeBuf);
    wctx.fillStyle = "#0c1012";
    wctx.fillRect(0, 0, wave.width, wave.height);
    wctx.strokeStyle = "#f0a030";
    wctx.beginPath();
    const mid = wave.height / 2;
    for (let x = 0; x < wave.width; x++) {
      const v = tap.timeBuf[Math.floor((x / wave.width) * 1024)] ?? 0;
      const y = mid - v * mid * 0.9;
      if (x === 0) wctx.moveTo(x, y);
      else wctx.lineTo(x, y);
    }
    wctx.stroke();
  }
  // spectrogram: scroll left one pixel column, paint newest column on the right
  const sctx = spec.getContext("2d");
  if (sctx) {
    analyser.getFloatFrequencyData(tap.freqBuf);
    sctx.drawImage(spec, -1, 0);
    const binHz = sampleRate / analyser.fftSize;
    for (let y = 0; y < spec.height; y++) {
      const f = F_MIN * (F_MAX / F_MIN) ** (1 - y / spec.height);
      const db = tap.freqBuf[Math.round(f / binHz)] ?? -120;
      sctx.fillStyle = color(db);
      sctx.fillRect(spec.width - 1, y, 1, 1);
    }
  }
}

/** Level in dB of the spectrum around `freq` (max within +-2%), from the tap's last frame. */
export function levelAt(tap: Tap, freq: number, sampleRate: number): number {
  tap.analyser.getFloatFrequencyData(tap.freqBuf);
  const binHz = sampleRate / tap.analyser.fftSize;
  let best = -200;
  for (let f = freq * 0.98; f <= freq * 1.02; f += binHz) {
    best = Math.max(best, tap.freqBuf[Math.round(f / binHz)] ?? -200);
  }
  return best;
}
