import { describe, expect, it } from "vitest";
import { decodeWav, encodeWav } from "./wav";

describe("wav", () => {
  it("round-trips float32 exactly", () => {
    const x = Float32Array.from([0, 0.5, -0.25, 1, -1]);
    const r = decodeWav(encodeWav(x, 48000));
    expect(r.sampleRate).toBe(48000);
    expect(r.samples).toEqual(x);
  });

  it("rejects non-WAV input", () => {
    expect(() => decodeWav(Buffer.from("hello world, not a wav"))).toThrow(/not a WAV/);
  });
});
