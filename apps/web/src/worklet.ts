/// <reference path="./worklet-env.d.ts" />
import {
  BLOCK,
  Chain,
  compileModule,
  type Fault,
  Framer,
  GuitarSynth,
  LoudnessMeter,
  MODULES,
  type ModuleDef,
} from "@rig/dsp-host";
import type { Riff, Slot } from "@rig/shared";

const PROBE_FRAMES = 48000; // record one second after the click
export const TAP_FRAME = 2048;

type InMsg =
  | { type: "init"; module: WebAssembly.Module; slots: Slot[] }
  | { type: "slots"; slots: Slot[] }
  | { type: "modules"; sources: string[] }
  | { type: "tap"; index: number }
  | { type: "inspect"; slot: number }
  | { type: "probe" }
  | { type: "meter-reset" }
  | { type: "input"; synth: boolean; level: number }
  | { type: "riff"; riff: Riff | null; loop: boolean; keep: boolean };

class RigProcessor extends AudioWorkletProcessor {
  private chain: Chain | null = null;
  private slots: Slot[] = [];
  /** Built-ins plus stored modules, compiled here: the worklet has no DOM, token or network to reach. */
  private readonly registry: Record<string, ModuleDef> = { ...MODULES };
  private readonly compiled = new Map<string, string>(); // module id -> source it was compiled from
  private readonly tmpIn = new Float32Array(BLOCK);
  private readonly tmpOut = new Float32Array(BLOCK);
  private tapIndex = -1; // -1 means the chain output
  private tapFrames = new Framer(TAP_FRAME);
  private inspectSlot = -1; // slot whose input and output go to the inspector, or -1
  private inFrames = new Framer(TAP_FRAME);
  private outFrames = new Framer(TAP_FRAME);
  private faultsSent = 0;
  /** The virtual guitar, used in place of the input when the source is a riff. */
  private readonly synth = new GuitarSynth(sampleRate);
  private useSynth = false;
  private synthLevel = 1;
  private beatTick = 0;
  private readonly meter = new LoudnessMeter(sampleRate);
  private meterTick = 0;
  private endedSent = false;
  private probeLeft = 0;
  private probeRec = new Float32Array(PROBE_FRAMES);
  private probePos = 0;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<InMsg>) => {
      const m = e.data;
      if (m.type === "init") {
        this.wasm = m.module;
        this.slots = m.slots;
        this.chain = this.newChain();
        this.port.postMessage({ type: "ready" });
      } else if (m.type === "slots") {
        this.slots = m.slots;
        this.chain?.setSlots(m.slots);
      } else if (m.type === "modules") this.load(m.sources);
      else if (m.type === "tap") {
        this.tapIndex = m.index;
        this.tapFrames.reset();
      } else if (m.type === "inspect") {
        this.inspectSlot = m.slot;
        this.inFrames.reset();
        this.outFrames.reset();
      } else if (m.type === "meter-reset") this.meter.reset();
      else if (m.type === "input") {
        this.useSynth = m.synth;
        this.synthLevel = m.level;
      } else if (m.type === "riff") {
        this.endedSent = false;
        if (m.riff) this.synth.play(m.riff, m.loop, m.keep);
        else this.synth.stop();
      } else if (m.type === "probe") {
        this.probeLeft = PROBE_FRAMES;
        this.probePos = 0;
      }
    };
  }

  private wasm: WebAssembly.Module | null = null;

  private newChain(): Chain {
    const chain = new Chain(this.wasm as WebAssembly.Module, sampleRate, this.registry);
    chain.setSlots(this.slots);
    return chain;
  }

  /** Compile new or changed sources. A running chain keeps stale instances and faults, so it is rebuilt. */
  private load(sources: string[]) {
    let changed = false;
    for (const source of sources) {
      try {
        const def = compileModule(source);
        if (this.compiled.get(def.id) === source) continue;
        this.registry[def.id] = def;
        this.compiled.set(def.id, source);
        changed = true;
      } catch {
        // the daemon gated this source when it was stored; a slot using it shows "not in the registry"
      }
    }
    if (changed && this.chain) {
      this.chain = this.newChain();
      this.faultsSent = 0;
      this.port.postMessage({ type: "faults", faults: [] });
    }
  }

  /** True once, when a riff that is not looping has finished. */
  private endedOnce(): boolean {
    if (!this.synth.finished || this.endedSent) return false;
    this.endedSent = true;
    return true;
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    const input = inputs[0]?.[0];
    if (!out?.[0]) return true;
    const n = out[0].length;

    if (this.probeLeft > 0) {
      // loopback probe: emit a click, record what comes back on the input
      for (let i = 0; i < n; i++) {
        const click = this.probePos === 0 && i < 8 ? 0.8 : 0;
        for (const ch of out) ch[i] = click;
        if (this.probePos + i < PROBE_FRAMES) this.probeRec[this.probePos + i] = input?.[i] ?? 0;
      }
      this.probePos += n;
      this.probeLeft -= n;
      if (this.probeLeft <= 0)
        this.port.postMessage({ type: "probe-result", data: this.probeRec.slice(), sampleRate });
      return true;
    }

    const chain = this.chain;
    if (!chain || n !== BLOCK) {
      for (const ch of out) ch.fill(0);
      return true;
    }
    if (this.useSynth) {
      this.synth.process(this.tmpIn);
      if (++this.beatTick % 16 === 0)
        // about 23 times a second: the editor's playhead
        this.port.postMessage({ type: "beat", beat: this.synth.beat, ended: this.endedOnce() });
      for (let i = 0; i < BLOCK; i++) this.tmpIn[i] = (this.tmpIn[i] as number) * this.synthLevel;
    } else this.tmpIn.set(input ?? this.tmpOut.fill(0));
    chain.process(this.tmpIn, this.tmpOut);
    for (const ch of out) ch.set(this.tmpOut);
    this.meter.push(this.tmpOut);
    if (++this.meterTick % 12 === 0) this.port.postMessage({ type: "meter", ...this.meter.read() });

    const tap =
      chain.taps[
        this.tapIndex < 0 ? chain.taps.length - 1 : Math.min(this.tapIndex, chain.taps.length - 1)
      ];
    const frame = tap && this.tapFrames.push(tap);
    if (frame) this.port.postMessage({ type: "tap", frame }, [frame.buffer]);

    const k = this.inspectSlot;
    const [before, after] = [chain.taps[k], chain.taps[k + 1]];
    if (k >= 0 && before && after) {
      const [a, b] = [this.inFrames.push(before), this.outFrames.push(after)];
      if (a && b)
        this.port.postMessage({ type: "pair", slot: k, before: a, after: b }, [a.buffer, b.buffer]);
    }
    if (chain.faults.length !== this.faultsSent) {
      this.faultsSent = chain.faults.length;
      this.port.postMessage({ type: "faults", faults: chain.faults as Fault[] });
    }
    return true;
  }
}

registerProcessor("rig-processor", RigProcessor);
