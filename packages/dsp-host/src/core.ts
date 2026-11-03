/** Thin TypeScript wrapper over the rig-core C ABI. Used by the AudioWorklet and by Node (ADR-0001). */

interface RigExports {
  memory: WebAssembly.Memory;
  rig_alloc(len: number): number;
  rig_free(ptr: number, len: number): void;
  rig_load(ptr: number, len: number, sampleRate: number, oversample: number): number;
  rig_error_len(): number;
  rig_error_copy(out: number): void;
  rig_process(circuit: number, input: number, output: number, n: number): void;
  rig_destroy(circuit: number): void;
}

// AudioWorkletGlobalScope has no TextEncoder/TextDecoder, so encode UTF-8 by hand.
function utf8Encode(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

function utf8Decode(b: Uint8Array): string {
  let bin = "";
  for (const v of b) bin += String.fromCharCode(v);
  try {
    return decodeURIComponent(escape(bin));
  } catch {
    return bin;
  }
}

export class RigCircuit {
  private readonly x: RigExports;
  private handle: number;
  private readonly inPtr: number;
  private readonly outPtr: number;
  private readonly bytes: number;

  /** @throws Error with the core's message when the netlist is invalid. */
  constructor(
    instance: WebAssembly.Instance,
    netlist: string,
    sampleRate: number,
    oversample: number,
    readonly blockFrames = 128,
  ) {
    this.x = instance.exports as unknown as RigExports;
    const enc = utf8Encode(netlist);
    const p = this.x.rig_alloc(enc.length);
    new Uint8Array(this.x.memory.buffer, p, enc.length).set(enc);
    const h = this.x.rig_load(p, enc.length, sampleRate, oversample);
    this.x.rig_free(p, enc.length);
    if (h === 0) throw new Error(this.lastError());
    this.handle = h;
    this.bytes = blockFrames * 4;
    this.inPtr = this.x.rig_alloc(this.bytes);
    this.outPtr = this.x.rig_alloc(this.bytes);
  }

  private lastError(): string {
    const n = this.x.rig_error_len();
    const p = this.x.rig_alloc(n);
    this.x.rig_error_copy(p);
    const s = utf8Decode(new Uint8Array(this.x.memory.buffer, p, n));
    this.x.rig_free(p, n);
    return s;
  }

  /** Process exactly `blockFrames` samples. No allocation. */
  process(input: Float32Array, output: Float32Array): void {
    const n = this.blockFrames;
    // memory.buffer can be replaced if wasm memory grows, so view it fresh each call
    new Float32Array(this.x.memory.buffer, this.inPtr, n).set(input.subarray(0, n));
    this.x.rig_process(this.handle, this.inPtr, this.outPtr, n);
    output.set(new Float32Array(this.x.memory.buffer, this.outPtr, n));
  }

  destroy(): void {
    if (this.handle === 0) return;
    this.x.rig_destroy(this.handle);
    this.x.rig_free(this.inPtr, this.bytes);
    this.x.rig_free(this.outPtr, this.bytes);
    this.handle = 0;
  }
}

export const DIODE_CLIPPER = `* diode clipper (2.2k + 10n lowpass into antiparallel 1N4148)
V vin in 0 IN 10
R r1 in out 2.2k
C c1 out 0 10n
D d1 out 0 1N4148
D d2 0 out 1N4148
OUT out 1.4
`;
