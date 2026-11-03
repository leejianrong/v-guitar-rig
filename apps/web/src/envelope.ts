/** Peak envelope follower. `attackMs` and `releaseMs` are the times to cover 90% of a step. */
export class Envelope {
  private env = 0;
  private readonly up: number;
  private readonly down: number;
  constructor(sampleRate: number, attackMs = 5, releaseMs = 150) {
    const coef = (ms: number) => 1 - Math.exp(-Math.LN10 / ((ms / 1000) * sampleRate));
    this.up = coef(attackMs);
    this.down = coef(releaseMs);
  }
  /** Runs a frame through the follower and returns the highest envelope value reached in it. */
  run(frame: Float32Array): number {
    let top = 0;
    for (const x of frame) {
      const a = Math.abs(x);
      this.env += (a - this.env) * (a > this.env ? this.up : this.down);
      if (this.env > top) top = this.env;
    }
    return top;
  }
}

export const toDb = (linear: number) => 20 * Math.log10(linear + 1e-6);
