import workletUrl from "./worklet.ts?worker&url";

/**
 * Render a clip through the same AudioWorklet code the live path uses, but in an
 * OfflineAudioContext. This is what the parity test compares against the Node renderer.
 */
export async function renderOffline(
  wasm: WebAssembly.Module,
  netlist: string,
  oversample: number,
  clip: Float32Array<ArrayBuffer>,
): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(2, clip.length, 48000);
  await ctx.audioWorklet.addModule(workletUrl);
  const node = new AudioWorkletNode(ctx, "rig-processor", {
    numberOfInputs: 1,
    outputChannelCount: [2],
  });
  const ready = new Promise<void>((resolve, reject) => {
    node.port.onmessage = (e) => {
      if (e.data.type === "ready") resolve();
      else if (e.data.type === "error") reject(new Error(e.data.message));
    };
  });
  node.port.postMessage({ type: "init", module: wasm, netlist, oversample });
  await ready;
  const buf = ctx.createBuffer(1, clip.length, 48000);
  buf.copyToChannel(clip, 0);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(node);
  node.connect(ctx.destination);
  src.start();
  const rendered = await ctx.startRendering();
  return rendered.getChannelData(0);
}
