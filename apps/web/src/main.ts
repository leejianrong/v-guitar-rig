import { DIODE_CLIPPER, MODULES, RigCircuit } from "@rig/dsp-host";
import type { Board } from "@rig/shared";
import wasmUrl from "../../../target/wasm32-unknown-unknown/release/rig_core.wasm?url";
import { renderOffline } from "./offline";
import { draw, levelAt, makeTap, type Tap } from "./viz";
import workletUrl from "./worklet.ts?worker&url";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = (s: string) => {
  $("status").textContent = s;
};

let ctx: AudioContext | null = null;
let node: AudioWorkletNode | null = null;
let tapIn: Tap | null = null;
let tapOut: Tap | null = null;
let bypass = false;
let wasmModule: WebAssembly.Module | null = null;
let level: GainNode | null = null;
let source: AudioNode | null = null;
let activeNetlist = DIODE_CLIPPER;
let activeOversample = 4;

/** When served by the rig daemon the page carries a session token; use it to load the board. */
async function connectDaemon(): Promise<void> {
  const token = document.querySelector<HTMLMetaElement>('meta[name="rig-token"]')?.content;
  if (!token) {
    $("daemon").textContent = "standalone (no daemon): using the built-in diode clipper";
    return;
  }
  try {
    const res = await fetch("/api/boards/default", {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const board = (await res.json()) as Board;
    const slot = board.slots.find((s) => !s.bypass && MODULES[s.module]);
    const def = slot ? MODULES[slot.module] : undefined;
    if (def) {
      activeNetlist = def.netlist;
      activeOversample = def.oversample;
    }
    $("daemon").textContent =
      `connected: board "${board.name}" rev ${board.rev}, ${board.slots.length} slot(s)`;
  } catch (err) {
    $("daemon").textContent =
      `daemon unreachable: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function loadWasm(): Promise<WebAssembly.Module> {
  if (!wasmModule) wasmModule = await WebAssembly.compileStreaming(fetch(wasmUrl));
  return wasmModule;
}

/** Same WASM on the main thread: time render per block to report CPU headroom. */
async function benchmark(): Promise<number> {
  const inst = new WebAssembly.Instance(await loadWasm(), {});
  const c = new RigCircuit(inst, DIODE_CLIPPER, 48000, 4);
  const inp = new Float32Array(128);
  const out = new Float32Array(128);
  const blocks = 1500;
  const t0 = performance.now();
  for (let b = 0; b < blocks; b++) {
    for (let i = 0; i < 128; i++)
      inp[i] = 0.9 * Math.sin((2 * Math.PI * 110 * (b * 128 + i)) / 48000);
    c.process(inp, out);
  }
  const perBlock = (performance.now() - t0) / blocks;
  c.destroy();
  return ((128 / 48000) * 1000) / perBlock;
}

async function start() {
  $<HTMLButtonElement>("start").disabled = true;
  status("Starting audio...");
  try {
    ctx = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" });
    await ctx.audioWorklet.addModule(workletUrl);
    node = new AudioWorkletNode(ctx, "rig-processor", {
      numberOfInputs: 1,
      outputChannelCount: [2],
    });
    const worklet = node;
    const ready = new Promise<void>((resolve, reject) => {
      worklet.port.onmessage = (e) => {
        if (e.data.type === "ready") resolve();
        else if (e.data.type === "error") {
          status(`Module fault: ${e.data.message}`);
          reject(new Error(e.data.message));
        } else if (e.data.type === "probe-result") showProbe(e.data.data, e.data.sampleRate);
      };
    });
    node.port.postMessage({
      type: "init",
      module: await loadWasm(),
      netlist: activeNetlist,
      oversample: activeOversample,
    });
    await ready;

    level = ctx.createGain();
    level.gain.value = Number($<HTMLInputElement>("level").value);
    const kind = $<HTMLSelectElement>("source").value;
    if (kind === "guitar") {
      // raw instrument signal: no echo cancellation, noise suppression or auto gain
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
      });
      source = ctx.createMediaStreamSource(stream);
    } else {
      const osc = ctx.createOscillator();
      osc.frequency.value = 110;
      osc.start();
      source = osc;
    }
    tapIn = makeTap(ctx, $("wave-in"), $("spec-in"));
    tapOut = makeTap(ctx, $("wave-out"), $("spec-out"));
    source.connect(level);
    level.connect(tapIn.analyser);
    level.connect(node);
    node.connect(tapOut.analyser);
    // master limiter (ADR-0004): a hard ceiling before the speakers
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    node.connect(limiter);
    limiter.connect(ctx.destination);
    await ctx.resume();

    $("sr").textContent = `${ctx.sampleRate} Hz, ${128}-frame blocks`;
    const lat = (ctx.baseLatency + (ctx.outputLatency || 0)) * 1000;
    $("lat").textContent = `${lat.toFixed(1)} ms (base + output, estimate)`;
    $<HTMLButtonElement>("pedal").disabled = false;
    $<HTMLButtonElement>("probe").disabled = false;
    status("Running");
    requestAnimationFrame(frame);
    const h = await benchmark();
    $("head").textContent = `${h.toFixed(1)}x (render time per block / block duration)`;
    const inTap = tapIn;
    const outTap = tapOut;
    const sr = ctx.sampleRate;
    window.__rig = {
      ready: true,
      sampleRate: ctx.sampleRate,
      level: (which, freq) => levelAt(which === "in" ? inTap : outTap, freq, sr),
      headroom: h,
    };
  } catch (err) {
    status(`Could not start: ${err instanceof Error ? err.message : String(err)}`);
    $<HTMLButtonElement>("start").disabled = false;
  }
}

function frame() {
  if (ctx && tapIn && tapOut) {
    draw(tapIn, ctx.sampleRate);
    draw(tapOut, ctx.sampleRate);
  }
  requestAnimationFrame(frame);
}

function showProbe(data: Float32Array, sr: number) {
  let peak = 0;
  for (let i = 64; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i] ?? 0));
  if (peak < 0.02) {
    $("loop").textContent =
      "no click heard: connect interface output to input and raise the loopback level";
    return;
  }
  let lag = 0;
  for (let i = 0; i < data.length; i++) {
    if (Math.abs(data[i] ?? 0) > peak * 0.3) {
      lag = i;
      break;
    }
  }
  $("loop").textContent = `${((lag / sr) * 1000).toFixed(1)} ms (${lag} frames at ${sr} Hz)`;
}

void connectDaemon();
window.__rigOffline = async (clip: number[]) =>
  Array.from(
    await renderOffline(await loadWasm(), activeNetlist, activeOversample, Float32Array.from(clip)),
  );

$("start").addEventListener("click", start);
$("pedal").addEventListener("click", () => {
  bypass = !bypass;
  node?.port.postMessage({ type: "bypass", value: bypass });
  $("pedal").textContent = `Diode clipper: ${bypass ? "off" : "on"}`;
  $("pedal").classList.toggle("on", !bypass);
});
$("probe").addEventListener("click", () => {
  $("loop").textContent = "measuring...";
  node?.port.postMessage({ type: "probe" });
});
$("level").addEventListener("input", (e) => {
  if (level) level.gain.value = Number((e.target as HTMLInputElement).value);
});

declare global {
  interface Window {
    __rigOffline?: (clip: number[]) => Promise<number[]>;
    __rig?: {
      ready: boolean;
      sampleRate: number;
      level: (which: "in" | "out", freq: number) => number;
      headroom: number;
    };
  }
}
