/**
 * Loudness to ITU-R BS.1770-4 / EBU R128: K-weighting, 400 ms blocks every 100 ms, and gated
 * integration. The rig's output is one signal played on both speakers, so it is measured as two
 * identical channels (3 dB above a single channel). No DOM or timers: this runs in the audio worklet
 * and in Node alike.
 */
const HOP_SECONDS = 0.1;
const FLOOR = -120; // what silence reads, in LUFS or dB
const BIN = 0.1; // LU per histogram bin, so a long session costs no more memory than a short one
const LOW = -70;
const BINS = 800;

interface Stage {
  b: [number, number, number];
  a: [number, number];
  z1: number;
  z2: number;
}

function kWeighting(sr: number): [Stage, Stage] {
  const shelfK = Math.tan((Math.PI * 1681.974450955533) / sr);
  const q1 = 0.7071752369554196;
  const vh = 10 ** (3.999843853973347 / 20);
  const vb = vh ** 0.4996667741545416;
  const a0 = 1 + shelfK / q1 + shelfK ** 2;
  const shelf: Stage = {
    b: [
      (vh + (vb * shelfK) / q1 + shelfK ** 2) / a0,
      (2 * (shelfK ** 2 - vh)) / a0,
      (vh - (vb * shelfK) / q1 + shelfK ** 2) / a0,
    ],
    a: [(2 * (shelfK ** 2 - 1)) / a0, (1 - shelfK / q1 + shelfK ** 2) / a0],
    z1: 0,
    z2: 0,
  };
  const hpK = Math.tan((Math.PI * 38.13547087602444) / sr);
  const q2 = 0.5003270373238773;
  const h0 = 1 + hpK / q2 + hpK ** 2;
  const high: Stage = {
    b: [1, -2, 1],
    a: [(2 * (hpK ** 2 - 1)) / h0, (1 - hpK / q2 + hpK ** 2) / h0],
    z1: 0,
    z2: 0,
  };
  return [shelf, high];
}

const step = (s: Stage, x: number) => {
  const y = s.b[0] * x + s.z1;
  s.z1 = s.b[1] * x - s.a[0] * y + s.z2;
  s.z2 = s.b[2] * x - s.a[1] * y;
  return y;
};

const toLufs = (meanSquare: number) =>
  meanSquare > 0 ? Math.max(FLOOR, -0.691 + 10 * Math.log10(2 * meanSquare)) : FLOOR;

export interface Loudness {
  /** Last 400 ms, LUFS. */
  momentary: number;
  /** Last 3 s, LUFS. */
  shortTerm: number;
  /** Everything since reset, gated as R128 describes, LUFS. */
  integrated: number;
  /** Highest sample since reset, dBFS. */
  peak: number;
}

export class LoudnessMeter {
  private readonly stages: [Stage, Stage];
  private readonly hop: number;
  private readonly hops: number[] = []; // mean square of the last 30 hops, newest last
  private sum = 0;
  private count = 0;
  private peakLin = 0;
  private readonly bins = new Float64Array(BINS); // blocks per loudness bin
  private readonly energy = new Float64Array(BINS); // their summed mean squares

  constructor(sampleRate: number) {
    this.stages = kWeighting(sampleRate);
    this.hop = Math.round(sampleRate * HOP_SECONDS);
  }

  reset() {
    this.hops.length = 0;
    this.sum = 0;
    this.count = 0;
    this.peakLin = 0;
    this.bins.fill(0);
    this.energy.fill(0);
  }

  push(x: Float32Array) {
    for (const v of x) {
      this.peakLin = Math.max(this.peakLin, Math.abs(v));
      const k = step(this.stages[1], step(this.stages[0], v));
      this.sum += k * k;
      if (++this.count === this.hop) {
        this.endHop(this.sum / this.hop);
        this.sum = 0;
        this.count = 0;
      }
    }
  }

  private endHop(meanSquare: number) {
    this.hops.push(meanSquare);
    if (this.hops.length > 30) this.hops.shift();
    if (this.hops.length < 4) return;
    const block = this.mean(4);
    const bin = Math.floor((toLufs(block) - LOW) / BIN);
    if (bin >= 0) {
      const i = Math.min(BINS - 1, bin);
      this.bins[i] = (this.bins[i] as number) + 1;
      this.energy[i] = (this.energy[i] as number) + block;
    }
  }

  private mean(n: number): number {
    const last = this.hops.slice(-n);
    return last.reduce((a, b) => a + b, 0) / Math.max(1, last.length);
  }

  /** Mean of the blocks at or above `from` LUFS, as a mean square, and how many there were. */
  private gated(from: number): { ms: number; n: number } {
    let [e, n] = [0, 0];
    for (let i = Math.max(0, Math.ceil((from - LOW) / BIN)); i < BINS; i++) {
      e += this.energy[i] as number;
      n += this.bins[i] as number;
    }
    return { ms: n > 0 ? e / n : 0, n };
  }

  read(): Loudness {
    const abs = this.gated(-70);
    const relative = this.gated(toLufs(abs.ms) - 10);
    return {
      momentary: this.hops.length >= 4 ? toLufs(this.mean(4)) : FLOOR,
      shortTerm: this.hops.length >= 30 ? toLufs(this.mean(30)) : FLOOR,
      integrated: relative.n > 0 ? toLufs(relative.ms) : FLOOR,
      peak: this.peakLin > 0 ? Math.max(FLOOR, 20 * Math.log10(this.peakLin)) : FLOOR,
    };
  }
}

/** Loudness of a whole recording: its integrated LUFS, loudest short-term LUFS and peak. */
export function measureLoudness(
  samples: Float32Array,
  sampleRate: number,
): { integrated: number; shortTermMax: number; peak: number } {
  const meter = new LoudnessMeter(sampleRate);
  let shortTermMax = FLOOR;
  const chunk = Math.round(sampleRate * HOP_SECONDS);
  for (let at = 0; at < samples.length; at += chunk) {
    meter.push(samples.subarray(at, at + chunk));
    shortTermMax = Math.max(shortTermMax, meter.read().shortTerm);
  }
  const { integrated, peak } = meter.read();
  return { integrated, shortTermMax, peak };
}
