/** Average frames per second since `start()`, counted from requestAnimationFrame. */
export class FrameCounter {
  private frames = 0;
  private t0 = 0;
  private raf = 0;
  start() {
    this.frames = 0;
    this.t0 = performance.now();
    const tick = () => {
      this.frames++;
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }
  stop() {
    cancelAnimationFrame(this.raf);
  }
  fps(): number {
    const s = (performance.now() - this.t0) / 1000;
    return s > 0 ? this.frames / s : 0;
  }
}
