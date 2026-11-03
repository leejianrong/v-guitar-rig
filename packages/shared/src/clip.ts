/** Deterministic test signal: two sines plus decaying noise bursts. Same bytes in every host. */
export function testClip(frames: number, sampleRate = 48000): Float32Array {
  const out = new Float32Array(frames);
  let seed = 12345;
  for (let i = 0; i < frames; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 0xffffffff - 0.5;
    const t = i / sampleRate;
    const burst = Math.exp(-((t % 0.5) * 12));
    out[i] =
      0.5 * Math.sin(2 * Math.PI * 110 * t) +
      0.2 * Math.sin(2 * Math.PI * 220 * t) +
      0.3 * noise * burst;
  }
  return out;
}
