/// <reference path="./worklet-env.d.ts" />
import { RigCircuit } from "@rig/dsp-host";

const BLOCK = 128;
const PROBE_FRAMES = 48000; // record one second after the click

type InMsg =
  | { type: "init"; module: WebAssembly.Module; netlist: string; oversample: number }
  | { type: "bypass"; value: boolean }
  | { type: "probe" };

class RigProcessor extends AudioWorkletProcessor {
  private circuit: RigCircuit | null = null;
  private bypass = false;
  private faulted = false;
  private readonly tmpIn = new Float32Array(BLOCK);
  private readonly tmpOut = new Float32Array(BLOCK);
  private probeLeft = 0;
  private probeRec = new Float32Array(PROBE_FRAMES);
  private probePos = 0;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<InMsg>) => {
      const m = e.data;
      if (m.type === "init") {
        try {
          const inst = new WebAssembly.Instance(m.module, {});
          this.circuit = new RigCircuit(inst, m.netlist, sampleRate, m.oversample, BLOCK);
          this.port.postMessage({ type: "ready" });
        } catch (err) {
          this.port.postMessage({ type: "error", message: String(err) });
        }
      } else if (m.type === "bypass") this.bypass = m.value;
      else if (m.type === "probe") {
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
      if (this.probeLeft <= 0) {
        this.port.postMessage({ type: "probe-result", data: this.probeRec.slice(), sampleRate });
      }
      return true;
    }

    if (!input || !this.circuit || this.faulted || n !== BLOCK) {
      for (const ch of out) ch.fill(0);
      return true;
    }
    if (this.bypass) {
      for (const ch of out) ch.set(input);
      return true;
    }
    this.tmpIn.set(input);
    try {
      this.circuit.process(this.tmpIn, this.tmpOut);
    } catch (err) {
      // a faulting module is silenced and reported, never allowed to take the page down (ADR-0004)
      this.faulted = true;
      this.port.postMessage({ type: "error", message: String(err) });
      for (const ch of out) ch.fill(0);
      return true;
    }
    for (const ch of out) ch.set(this.tmpOut);
    return true;
  }
}

registerProcessor("rig-processor", RigProcessor);
