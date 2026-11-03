/// <reference path="./worklet-env.d.ts" />
import { BLOCK, Chain, type Fault } from "@rig/dsp-host";
import type { Slot } from "@rig/shared";

const PROBE_FRAMES = 48000; // record one second after the click
export const TAP_FRAME = 2048;

type InMsg =
  | { type: "init"; module: WebAssembly.Module; slots: Slot[] }
  | { type: "slots"; slots: Slot[] }
  | { type: "tap"; index: number }
  | { type: "probe" };

class RigProcessor extends AudioWorkletProcessor {
  private chain: Chain | null = null;
  private readonly tmpIn = new Float32Array(BLOCK);
  private readonly tmpOut = new Float32Array(BLOCK);
  private tapIndex = -1; // -1 means the chain output
  private tapBuf = new Float32Array(TAP_FRAME);
  private tapPos = 0;
  private faultsSent = 0;
  private probeLeft = 0;
  private probeRec = new Float32Array(PROBE_FRAMES);
  private probePos = 0;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<InMsg>) => {
      const m = e.data;
      if (m.type === "init") {
        this.chain = new Chain(m.module, sampleRate);
        this.chain.setSlots(m.slots);
        this.port.postMessage({ type: "ready" });
      } else if (m.type === "slots") this.chain?.setSlots(m.slots);
      else if (m.type === "tap") {
        this.tapIndex = m.index;
        this.tapPos = 0;
      } else if (m.type === "probe") {
        this.probeLeft = PROBE_FRAMES;
        this.probePos = 0;
      }
    };
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
    this.tmpIn.set(input ?? this.tmpOut.fill(0));
    chain.process(this.tmpIn, this.tmpOut);
    for (const ch of out) ch.set(this.tmpOut);

    const tap =
      chain.taps[
        this.tapIndex < 0 ? chain.taps.length - 1 : Math.min(this.tapIndex, chain.taps.length - 1)
      ];
    if (tap) {
      this.tapBuf.set(tap, this.tapPos);
      this.tapPos += BLOCK;
      if (this.tapPos >= TAP_FRAME) {
        const frame = this.tapBuf;
        this.tapBuf = new Float32Array(TAP_FRAME);
        this.tapPos = 0;
        this.port.postMessage({ type: "tap", frame }, [frame.buffer]);
      }
    }
    if (chain.faults.length !== this.faultsSent) {
      this.faultsSent = chain.faults.length;
      this.port.postMessage({ type: "faults", faults: chain.faults as Fault[] });
    }
    return true;
  }
}

registerProcessor("rig-processor", RigProcessor);
