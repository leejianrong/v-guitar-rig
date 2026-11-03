import type { Slot } from "@rig/shared";
import { MODULES, type ModuleDef, type Processor } from "./modules";

export const BLOCK = 128;
/** Parameter smoothing time constant: a 99% move takes about 4.6x this (46 ms). */
export const SMOOTH_MS = 10;
/** Output fades out over this long, the chain changes, then fades back in (so a swap makes no click). */
export const FADE_MS = 10;

export interface Fault {
  slotId: string;
  message: string;
}

interface Instance {
  moduleId: string;
  def: ModuleDef;
  proc: Processor;
  cur: Record<string, number>;
  target: Record<string, number>;
  out: Float32Array;
}

/**
 * A board running in real time: ordered slots, per-slot bypass, smoothed parameters, and a click-free
 * fade whenever order, membership or bypass changes. The AudioWorklet and the Node renderer both run
 * this exact class, which is what keeps live and offline audio identical (ADR-0001).
 *
 * Tap 0 is the chain input; tap k is the output of slot k-1; the last tap is the chain output.
 */
export class Chain {
  faults: Fault[] = [];
  /** One block per tap, valid after `process`. */
  taps: Float32Array[] = [new Float32Array(BLOCK)];

  private slots: Slot[] = [];
  private pending: Slot[] | null = null;
  private inst = new Map<string, Instance>();
  private faulted = new Set<string>();
  private blocks = 0;
  private fadePos = 0;
  private state: "idle" | "out" | "in" = "idle";
  private readonly fadeFrames: number;
  private readonly alpha: number;

  constructor(
    private readonly wasm: WebAssembly.Module,
    private readonly sampleRate = 48000,
    private readonly registry: Record<string, ModuleDef> = MODULES,
  ) {
    this.fadeFrames = Math.round((FADE_MS / 1000) * sampleRate);
    this.alpha = 1 - Math.exp(-BLOCK / ((SMOOTH_MS / 1000) * sampleRate));
  }

  /** Replace the board. Parameter-only changes are smoothed in; structural changes fade. */
  setSlots(next: Slot[]): void {
    const copy = next.map((s) => ({ ...s, params: { ...s.params } }));
    const sameShape =
      copy.length === this.slots.length &&
      copy.every((s, i) => {
        const o = this.slots[i];
        return o && o.id === s.id && o.module === s.module && o.bypass === s.bypass;
      });
    if (this.blocks === 0) this.apply(copy);
    else if (sameShape && !this.pending) {
      this.slots = copy;
      this.retarget();
    } else this.pending = copy;
  }

  private spec(def: ModuleDef, slot: Slot): Record<string, number> {
    const out: Record<string, number> = {};
    for (const p of def.params) {
      const v = slot.params[p.id];
      out[p.id] = Math.min(
        p.max,
        Math.max(p.min, typeof v === "number" && Number.isFinite(v) ? v : p.default),
      );
    }
    return out;
  }

  private retarget(): void {
    for (const s of this.slots) {
      const i = this.inst.get(s.id);
      if (i) i.target = this.spec(i.def, s);
    }
  }

  private apply(next: Slot[]): void {
    const keep = new Set(next.map((s) => s.id));
    for (const id of [...this.inst.keys()]) if (!keep.has(id)) this.inst.delete(id);
    for (const s of next) {
      const old = this.inst.get(s.id);
      if (old && old.moduleId === s.module) continue;
      this.inst.delete(s.id);
      const def = this.registry[s.module];
      try {
        if (!def) throw new Error("not in the module registry");
        const params = this.spec(def, s);
        this.inst.set(s.id, {
          moduleId: s.module,
          def,
          proc: def.create(this.sampleRate, this.wasm),
          cur: { ...params },
          target: params,
          out: new Float32Array(BLOCK),
        });
      } catch (e) {
        this.fault(s.id, e);
      }
    }
    this.slots = next;
    this.retarget();
    while (this.taps.length < next.length + 1) this.taps.push(new Float32Array(BLOCK));
    this.taps.length = next.length + 1;
  }

  private fault(slotId: string, e: unknown): void {
    this.faulted.add(slotId);
    this.faults.push({ slotId, message: e instanceof Error ? e.message : String(e) });
  }

  process(input: Float32Array, output: Float32Array): void {
    this.blocks++;
    const a = this.alpha;
    let sig = input;
    this.taps[0]?.set(sig);
    this.slots.forEach((slot, k) => {
      const i = this.inst.get(slot.id);
      if (i && !slot.bypass && !this.faulted.has(slot.id)) {
        for (const id of Object.keys(i.target)) {
          const t = i.target[id] ?? 0;
          const c = i.cur[id] ?? t;
          i.cur[id] = Math.abs(t - c) < 1e-9 ? t : c + (t - c) * a;
        }
        try {
          i.proc.process(sig, i.out, i.cur);
          if (!i.out.every(Number.isFinite)) throw new Error("module produced NaN or Infinity");
          sig = i.out;
        } catch (e) {
          this.fault(slot.id, e);
        }
      }
      this.taps[k + 1]?.set(sig);
    });
    output.set(sig);

    this.fade(output);
  }

  /** Click-free structural change: ramp to silence, swap the chain, ramp back up. */
  private fade(output: Float32Array): void {
    const F = this.fadeFrames;
    if (this.pending && this.state !== "out") {
      this.fadePos = this.state === "in" ? F - this.fadePos : 0;
      this.state = "out";
    }
    if (this.state === "idle") return;
    for (let n = 0; n < output.length; n++) {
      if (this.state === "out") {
        output[n] = (output[n] ?? 0) * Math.max(0, 1 - this.fadePos / F);
        if (++this.fadePos >= F) {
          if (this.pending) this.apply(this.pending);
          this.pending = null;
          this.state = "in";
          this.fadePos = 0;
          output.fill(0, n + 1); // the rest of this block still came from the old chain
          return;
        }
      } else {
        output[n] = (output[n] ?? 0) * (this.fadePos / F);
        if (++this.fadePos >= F) this.state = "idle";
      }
    }
  }
}
