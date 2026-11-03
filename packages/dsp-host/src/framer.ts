/** Gathers 128-frame blocks into fixed-size frames for the UI. Returns a frame when one is full. */
export class Framer {
  private buf: Float32Array;
  private pos = 0;
  constructor(private readonly size: number) {
    this.buf = new Float32Array(size);
  }
  /** Copies `block` in. The returned frame is handed over: it is never written again. */
  push(block: Float32Array): Float32Array | null {
    this.buf.set(block, this.pos);
    this.pos += block.length;
    if (this.pos < this.size) return null;
    const frame = this.buf;
    this.buf = new Float32Array(this.size);
    this.pos = 0;
    return frame;
  }
  reset() {
    this.pos = 0;
  }
}
