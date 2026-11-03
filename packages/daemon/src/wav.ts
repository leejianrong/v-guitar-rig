/** Minimal mono WAV I/O: reads PCM16 and float32 (first channel); writes float32. */

export function encodeWav(samples: Float32Array, sampleRate: number): Buffer {
  const dataBytes = samples.length * 4;
  const b = Buffer.alloc(44 + dataBytes);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + dataBytes, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(3, 20); // IEEE float
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sampleRate, 24);
  b.writeUInt32LE(sampleRate * 4, 28);
  b.writeUInt16LE(4, 32);
  b.writeUInt16LE(32, 34);
  b.write("data", 36);
  b.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) b.writeFloatLE(samples[i] ?? 0, 44 + i * 4);
  return b;
}

export function decodeWav(buf: Buffer): { samples: Float32Array; sampleRate: number } {
  if (
    buf.length < 12 ||
    buf.toString("ascii", 0, 4) !== "RIFF" ||
    buf.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error("not a WAV file");
  }
  let fmt: { tag: number; channels: number; rate: number; bits: number } | null = null;
  for (let at = 12; at + 8 <= buf.length; ) {
    const id = buf.toString("ascii", at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    const body = at + 8;
    if (id === "fmt ") {
      fmt = {
        tag: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        rate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14),
      };
    } else if (id === "data") {
      if (!fmt) throw new Error("WAV data before fmt chunk");
      const bytes = fmt.bits / 8;
      const frames = Math.floor(Math.min(size, buf.length - body) / (bytes * fmt.channels));
      const out = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        const o = body + i * bytes * fmt.channels;
        if (fmt.tag === 3 && fmt.bits === 32) out[i] = buf.readFloatLE(o);
        else if (fmt.tag === 1 && fmt.bits === 16) out[i] = buf.readInt16LE(o) / 32768;
        else throw new Error(`unsupported WAV format (tag ${fmt.tag}, ${fmt.bits}-bit)`);
      }
      return { samples: out, sampleRate: fmt.rate };
    }
    at = body + size + (size % 2);
  }
  throw new Error("WAV has no data chunk");
}
