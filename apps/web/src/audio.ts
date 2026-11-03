import { BLOCK, Chain, type Fault, MODULES } from "@rig/dsp-host";
import type { Slot } from "@rig/shared";
import wasmUrl from "../../../target/wasm32-unknown-unknown/release/rig_core.wasm?url";
import workletUrl from "./worklet.ts?worker&url";

export type Source = "tone" | "guitar";

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
  const blocks = 1500;
  const t0 = performance.now();
  for (let b = 0; b < blocks; b++) {
    for (let i = 0; i < BLOCK; i++)
      inp[i] = 0.9 * Math.sin((2 * Math.PI * 110 * (b * BLOCK + i)) / 48000);
    chain.process(inp, out);
  }
  return ((BLOCK / 48000) * 1000) / ((performance.now() - t0) / blocks);
}

export interface ProbeResult {
  /** Round trip in ms, or null if no click came back. */
  ms: number | null;
}

/** The live audio graph: source -> level -> worklet (the board) -> limiter -> speakers. */
export class Rig {
  readonly sampleRate: number;
  readonly latencyMs: number;
  private tapListeners = new Set<(frame: Float32Array) => void>();
  private faultListeners = new Set<(f: Fault[]) => void>();
  private probeListeners = new Set<(r: ProbeResult) => void>();

  private constructor(
    ctx: AudioContext,
    private readonly node: AudioWorkletNode,
    private readonly level: GainNode,
  ) {
    this.sampleRate = ctx.sampleRate;
    this.latencyMs = (ctx.baseLatency + (ctx.outputLatency || 0)) * 1000;
    node.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === "tap") for (const l of this.tapListeners) l(m.frame);
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

  static async start(source: Source, slots: Slot[], level: number): Promise<Rig> {
    const ctx = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" });
    await ctx.audioWorklet.addModule(workletUrl);
    const node = new AudioWorkletNode(ctx, "rig-processor", {
      numberOfInputs: 1,
      outputChannelCount: [2],
    });
    const ready = new Promise<void>((resolve) => {
      node.port.onmessage = (e) => e.data.type === "ready" && resolve();
    });
    node.port.postMessage({ type: "init", module: await loadWasm(), slots });
    await ready;

    const gain = ctx.createGain();
    gain.gain.value = level;
    let src: AudioNode;
    if (source === "guitar") {
      // raw instrument signal: no echo cancellation, noise suppression or auto gain
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
      });
      src = ctx.createMediaStreamSource(stream);
    } else {
      const osc = ctx.createOscillator();
      osc.frequency.value = 110;
      osc.start();
      src = osc;
    }
    src.connect(gain);
    gain.connect(node);
    // master limiter (ADR-0004): a hard ceiling before the speakers
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    node.connect(limiter);
    limiter.connect(ctx.destination);
    await ctx.resume();
    return new Rig(ctx, node, gain);
  }

  setSlots(slots: Slot[]) {
    this.node.port.postMessage({ type: "slots", slots });
  }
  selectTap(index: number) {
    this.node.port.postMessage({ type: "tap", index });
  }
  setLevel(v: number) {
    this.level.gain.value = v;
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

export const moduleName = (id: string) => MODULES[id]?.name ?? id;
