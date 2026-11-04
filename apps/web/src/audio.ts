import { BLOCK, Chain, type Fault } from "@rig/dsp-host";
import type { Riff, Slot } from "@rig/shared";
import wasmUrl from "../../../target/wasm32-unknown-unknown/release/rig_core.wasm?url";
import workletUrl from "./worklet.ts?worker&url";

export type Source = "tone" | "guitar" | "riff";

let wasm: Promise<WebAssembly.Module> | null = null;
export const loadWasm = () => {
  wasm ??= WebAssembly.compileStreaming(fetch(wasmUrl));
  return wasm;
};

/** How many times faster than real time the diode-clipper chain renders, on this machine's main thread. */
export async function benchmarkHeadroom(): Promise<number> {
  const chain = new Chain(await loadWasm());
  chain.setSlots([{ id: "b", module: "diode-clipper@1", bypass: false, params: {} }]);
  const inp = new Float32Array(BLOCK);
  const out = new Float32Array(BLOCK);
  const blocks = 500;
  // best of three: another thread or tab stealing the CPU only ever makes a pass slower
  let fastest = Number.POSITIVE_INFINITY;
  for (let pass = 0; pass < 3; pass++) {
    const t0 = performance.now();
    for (let b = 0; b < blocks; b++) {
      for (let i = 0; i < BLOCK; i++)
        inp[i] = 0.9 * Math.sin((2 * Math.PI * 110 * (b * BLOCK + i)) / 48000);
      chain.process(inp, out);
    }
    fastest = Math.min(fastest, (performance.now() - t0) / blocks);
    await new Promise((r) => setTimeout(r)); // let the page and audio thread run between passes
  }
  return ((BLOCK / 48000) * 1000) / fastest;
}

/** The signal going into and coming out of one pedal over the same stretch of time. */
export interface Pair {
  slot: number;
  before: Float32Array;
  after: Float32Array;
}

export interface ProbeResult {
  /** Round trip in ms, or null if no click came back. */
  ms: number | null;
}

/** The live audio graph: source -> level -> worklet (the board) -> limiter -> volume -> speakers. */
export class Rig {
  readonly sampleRate: number;
  readonly latencyMs: number;
  /** Output underruns since start, from the browser's own playback stats; null where it has none. */
  get underruns(): number | null {
    return (
      (this.ctx as unknown as { playbackStats?: { underrunEvents: number } }).playbackStats
        ?.underrunEvents ?? null
    );
  }
  private readonly ctx: AudioContext;
  private tapListeners = new Set<(frame: Float32Array) => void>();
  private pairListeners = new Set<(p: Pair) => void>();
  private faultListeners = new Set<(f: Fault[]) => void>();
  private probeListeners = new Set<(r: ProbeResult) => void>();
  private beatListeners = new Set<(b: { beat: number; ended: boolean }) => void>();

  private constructor(
    ctx: AudioContext,
    private readonly node: AudioWorkletNode,
    private readonly level: GainNode,
    private readonly volume: GainNode,
    private readonly stream: MediaStream | null,
    private readonly synth: boolean,
  ) {
    this.ctx = ctx;
    this.sampleRate = ctx.sampleRate;
    this.latencyMs = (ctx.baseLatency + (ctx.outputLatency || 0)) * 1000;
    node.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === "tap") for (const l of this.tapListeners) l(m.frame);
      else if (m.type === "pair") for (const l of this.pairListeners) l(m);
      else if (m.type === "beat") for (const l of this.beatListeners) l(m);
      else if (m.type === "faults") for (const l of this.faultListeners) l(m.faults);
      else if (m.type === "probe-result") {
        const d = m.data as Float32Array;
        let peak = 0;
        for (let i = 64; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i] ?? 0));
        const at = peak < 0.02 ? -1 : d.findIndex((v, i) => i > 0 && Math.abs(v) > peak * 0.3);
        for (const l of this.probeListeners) l({ ms: at < 0 ? null : (at / m.sampleRate) * 1000 });
      }
    };
  }

  static async start(
    source: Source,
    slots: Slot[],
    sources: string[],
    level: number,
    volume: number,
  ): Promise<Rig> {
    const ctx = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" });
    await ctx.audioWorklet.addModule(workletUrl);
    const node = new AudioWorkletNode(ctx, "rig-processor", {
      numberOfInputs: 1,
      outputChannelCount: [2],
    });
    const ready = new Promise<void>((resolve) => {
      node.port.onmessage = (e) => e.data.type === "ready" && resolve();
    });
    node.port.postMessage({ type: "modules", sources });
    node.port.postMessage({ type: "init", module: await loadWasm(), slots });
    await ready;

    const gain = ctx.createGain();
    gain.gain.value = level;
    let src: AudioNode;
    let stream: MediaStream | null = null;
    if (source === "guitar") {
      // raw instrument signal: no echo cancellation, noise suppression or auto gain
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
      });
      src = ctx.createMediaStreamSource(stream);
    } else if (source === "riff") {
      src = ctx.createGain(); // silent: the worklet plays the virtual guitar itself
    } else {
      const osc = ctx.createOscillator();
      osc.frequency.value = 110;
      osc.start();
      src = osc;
    }
    node.port.postMessage({ type: "input", synth: source === "riff", level });
    src.connect(gain);
    gain.connect(node);
    // master limiter (ADR-0004): a hard ceiling before the speakers
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    node.connect(limiter);
    // after the limiter, so the volume knob can only turn things down from the ceiling
    const out = ctx.createGain();
    out.gain.value = volume;
    limiter.connect(out);
    out.connect(ctx.destination);
    await ctx.resume();
    return new Rig(ctx, node, gain, out, stream, source === "riff");
  }

  /** Silence everything and release the audio device and microphone. The Rig cannot be restarted. */
  async stop() {
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    await this.ctx.close();
  }

  /** Stored modules' source, compiled inside the worklet. */
  setModules(sources: string[]) {
    this.node.port.postMessage({ type: "modules", sources });
  }
  setSlots(slots: Slot[]) {
    this.node.port.postMessage({ type: "slots", slots });
  }
  selectTap(index: number) {
    this.node.port.postMessage({ type: "tap", index });
  }
  /** Send the input and output of the pedal at `slot` (index in the board), or stop with -1. */
  inspect(slot: number) {
    this.node.port.postMessage({ type: "inspect", slot });
  }
  onPair(l: (p: Pair) => void) {
    this.pairListeners.add(l);
    return () => void this.pairListeners.delete(l);
  }
  setLevel(v: number) {
    this.level.gain.value = v;
    this.node.port.postMessage({ type: "input", synth: this.synth, level: v });
  }
  /**
   * Play `riff` on the virtual guitar, or stop with null. With `keep` an edited riff replaces the one
   * playing without restarting. Only for the riff source.
   */
  playRiff(riff: Riff | null, loop = true, keep = false) {
    this.node.port.postMessage({ type: "riff", riff, loop, keep });
  }
  /** The virtual guitar's playhead, in beats, about 23 times a second while it plays. */
  onBeat(l: (b: { beat: number; ended: boolean }) => void) {
    this.beatListeners.add(l);
    return () => void this.beatListeners.delete(l);
  }
  setVolume(v: number) {
    this.volume.gain.value = v;
  }
  probe() {
    this.node.port.postMessage({ type: "probe" });
  }
  onTap(l: (frame: Float32Array) => void) {
    this.tapListeners.add(l);
    return () => void this.tapListeners.delete(l);
  }
  onFaults(l: (f: Fault[]) => void) {
    this.faultListeners.add(l);
    return () => void this.faultListeners.delete(l);
  }
  onProbe(l: (r: ProbeResult) => void) {
    this.probeListeners.add(l);
    return () => void this.probeListeners.delete(l);
  }
}
