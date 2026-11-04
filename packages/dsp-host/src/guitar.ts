import type { Riff } from "@rig/shared";
import { type Biquad, design, newBiquad, run } from "./biquad";

/** MIDI note of each open string, string 1 (high e) first: standard tuning. */
export const OPEN_STRINGS = [64, 59, 55, 50, 45, 40] as const;

const SIZE = 2048; // ring length: covers the lowest bent note at 96 kHz
const MASK = SIZE - 1;
const LN1000 = Math.log(1000); // a 60 dB fall
/** Steel strings on an electric: a hard pick, and a loop that keeps its highs and rings for seconds. */
const STEEL = { a: 0.07, t60: 10, pick: 0.8 };
const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

interface Event {
  at: number; // sample
  string: number; // 0..5
  kind: "release" | "pitch" | "pluck";
  semis: number;
  glide: number; // samples
  palm?: boolean;
}

/** The notes of `riff` as timed string events, releases first when they share a sample. */
function schedule(riff: Riff, sr: number): Event[] {
  const sample = (beats: number) => Math.round(((beats * 60) / riff.bpm) * sr);
  const events: Event[] = [];
  for (const n of riff.notes) {
    const s = n.string - 1;
    const semis = (OPEN_STRINGS[s] as number) + n.fret;
    const at = sample(n.at);
    const end = sample(n.at + n.length);
    if (n.tech === "hammer" || n.tech === "pull")
      events.push({ at, string: s, kind: "pitch", semis, glide: Math.round(0.001 * sr) });
    else if (n.tech === "slide")
      events.push({ at, string: s, kind: "pitch", semis, glide: Math.round(0.12 * sr) });
    else {
      events.push({ at, string: s, kind: "pluck", semis, glide: 0, palm: n.tech === "palm" });
      if (n.tech === "bend")
        events.push({
          at: at + Math.round(0.05 * sr),
          string: s,
          kind: "pitch",
          semis: semis + (n.bend ?? 1),
          glide: Math.max(Math.round(0.08 * sr), Math.round(0.4 * (end - at))),
        });
    }
    // a later hammer, pull or slide on this string at the moment this note ends continues it
    const legato = riff.notes.some(
      (m) =>
        m.string === n.string &&
        (m.tech === "hammer" || m.tech === "pull" || m.tech === "slide") &&
        sample(m.at) === end,
    );
    if (!legato) events.push({ at: end, string: s, kind: "release", semis, glide: 0 });
  }
  return events.sort(
    (a, b) => a.at - b.at || (a.kind === "release" ? -1 : 0) - (b.kind === "release" ? -1 : 0),
  );
}

/**
 * One string: a Karplus-Strong loop (a delay line with a one-pole low-pass and a loss) plucked with
 * filtered noise. The pickup is a comb on the line, which is what gives a bridge pickup its bite.
 */
class GuitarString {
  private readonly buf = new Float32Array(SIZE);
  private pos = 0;
  private semis = 0;
  private glideTo = 0;
  private glideStep = 0;
  private delay = 100;
  private gain = 0.99;
  private lp = 0;
  private a = STEEL.a; // low-pass coefficient: higher is darker
  private t60 = STEEL.t60;
  private releasing = false;
  private quiet = 0;
  private seed = 1;
  active = false;

  constructor(
    private readonly sr: number,
    private readonly pickup: number,
  ) {}

  private retune() {
    const f = midiHz(this.semis);
    const w = (2 * Math.PI * f) / this.sr;
    // the low-pass delays the loop by its phase delay at this pitch; take that out of the line
    const phase = Math.atan2(this.a * Math.sin(w), 1 - this.a * Math.cos(w)) / w;
    this.delay = this.sr / f - phase;
    const t60 = this.releasing ? 0.05 : this.t60;
    this.gain = Math.exp((-LN1000 * this.delay) / (this.sr * t60));
  }

  pitch(semis: number, glide: number) {
    this.releasing = false;
    this.glideTo = semis;
    this.glideStep = glide > 0 ? (semis - this.semis) / glide : semis - this.semis;
    if (glide <= 0) this.semis = semis;
    if (glide <= 0) this.retune();
  }

  release() {
    this.releasing = true;
    this.retune();
  }

  pluck(semis: number, palm: boolean) {
    this.a = palm ? 0.55 : STEEL.a;
    this.t60 = palm ? 0.25 : STEEL.t60;
    this.releasing = false;
    this.semis = semis;
    this.glideTo = semis;
    this.glideStep = 0;
    this.retune();
    const n = Math.round(this.delay);
    const burst = new Float32Array(n);
    let soft = 0;
    for (let k = 0; k < n; k++) {
      this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
      soft += STEEL.pick * (this.seed / 2 ** 31 - 1 - soft); // a soft pick
      burst[k] = soft;
    }
    const comb = Math.max(1, Math.round(0.12 * n)); // picked 12% along the string
    let mean = 0;
    for (let k = n - 1; k >= comb; k--)
      burst[k] = (burst[k] as number) - (burst[k - comb] as number);
    for (const v of burst) mean += v / n;
    for (let k = 0; k < n; k++) {
      const at = (this.pos - n + k) & MASK;
      this.buf[at] = (this.buf[at] as number) + ((burst[k] as number) - mean) * 1.6;
    }
    this.active = true;
    this.quiet = 0;
  }

  tick(): number {
    if (this.semis !== this.glideTo) {
      const next = this.semis + this.glideStep;
      this.semis = (this.glideStep > 0 ? next > this.glideTo : next < this.glideTo)
        ? this.glideTo
        : next;
      this.retune();
    }
    const t = this.pos - this.delay;
    const i = Math.floor(t);
    const f = t - i;
    const x = (this.buf[i & MASK] as number) * (1 - f) + (this.buf[(i + 1) & MASK] as number) * f;
    const j = i + Math.round(this.pickup * this.delay);
    const y = (this.buf[j & MASK] as number) * (1 - f) + (this.buf[(j + 1) & MASK] as number) * f;
    this.lp = (1 - this.a) * x + this.a * this.lp;
    this.buf[this.pos & MASK] = this.lp * this.gain;
    this.pos++;
    const out = x - y;
    if (Math.abs(out) < 1e-6) {
      if (++this.quiet > 2 * SIZE) this.active = false;
    } else this.quiet = 0;
    return out;
  }
}

/** Six strings playing a riff, one block at a time. The same code runs in the worklet and in Node. */
export class GuitarSynth {
  private readonly strings: GuitarString[];
  private events: Event[] = [];
  private next = 0;
  private pos = 0;
  private length = 0;
  private bpm = 120;
  private loop = false;
  /** A magnetic pickup's resonant peak: the "quack" an electric has and an acoustic lacks. */
  private readonly pickupPeak: Biquad = newBiquad();
  playing = false;
  /** True from the moment a riff that is not looping reaches its end, until the next `play`. */
  finished = false;

  constructor(
    readonly sampleRate: number,
    pickup = 0.1,
  ) {
    design(this.pickupPeak, "peak", 2800, sampleRate, 5, 1.2);
    this.strings = Array.from({ length: 6 }, () => new GuitarString(sampleRate, pickup));
  }

  /**
   * Start `riff` from the top, or with `keep` swap it in where the playhead is, so edits are heard
   * without restarting: notes already struck keep ringing and are not struck again.
   */
  play(riff: Riff, loop: boolean, keep = false) {
    this.events = schedule(riff, this.sampleRate);
    this.length = Math.round(((riff.beats * 60) / riff.bpm) * this.sampleRate);
    this.bpm = riff.bpm;
    this.loop = loop;
    this.playing = true;
    this.finished = false;
    if (keep && this.pos < this.length) {
      const ahead = this.events.findIndex((e) => e.at >= this.pos);
      this.next = ahead < 0 ? this.events.length : ahead;
    } else {
      this.next = 0;
      this.pos = 0;
    }
  }

  stop() {
    this.playing = false;
    for (const s of this.strings) s.release();
  }

  /** Where the playhead is in the riff, in beats. */
  get beat(): number {
    return (this.pos / this.sampleRate) * (this.bpm / 60);
  }

  process(out: Float32Array) {
    for (let i = 0; i < out.length; i++) {
      if (this.playing) {
        if (this.pos >= this.length) {
          if (this.loop) {
            this.pos = 0;
            this.next = 0;
          } else {
            this.stop();
            this.finished = true;
          }
        }
        for (let e = this.events[this.next]; e && e.at <= this.pos; e = this.events[++this.next]) {
          const s = this.strings[e.string] as GuitarString;
          if (e.kind === "pluck") s.pluck(e.semis, e.palm === true);
          else if (e.kind === "pitch") s.pitch(e.semis, e.glide);
          else s.release();
        }
        this.pos++;
      }
      let sum = 0;
      for (const s of this.strings) if (s.active) sum += s.tick();
      out[i] = run(this.pickupPeak, sum) * 0.07; // a chord peaks near 0.95, a single note near 0.25, like a guitar into an interface
    }
  }
}

/** One pass of `riff` rendered offline, plus `tail` seconds for the last notes to ring out. */
export function renderRiff(riff: Riff, sampleRate: number, tail = 1): Float32Array {
  const synth = new GuitarSynth(sampleRate);
  synth.play(riff, false);
  const out = new Float32Array(Math.round(((riff.beats * 60) / riff.bpm + tail) * sampleRate));
  const block = new Float32Array(128);
  for (let at = 0; at < out.length; at += 128) {
    synth.process(block);
    out.set(block.subarray(0, Math.min(128, out.length - at)), at);
  }
  return out;
}
