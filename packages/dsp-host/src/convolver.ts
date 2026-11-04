import { Fft } from "./fft";

/** An impulse response split into block-sized partitions and transformed once. */
export interface IrSpectra {
  re: Float64Array[];
  im: Float64Array[];
}

/** `ir` is cut into partitions of `block` samples, each zero-padded to 2x and transformed. */
export function irSpectra(ir: Float32Array, block: number): IrSpectra {
  const fft = new Fft(2 * block);
  const parts = Math.ceil(ir.length / block);
  const out: IrSpectra = { re: [], im: [] };
  for (let p = 0; p < parts; p++) {
    const re = new Float64Array(2 * block);
    const im = new Float64Array(2 * block);
    for (let i = 0; i < block; i++) re[i] = ir[p * block + i] ?? 0;
    fft.forward(re, im);
    out.re.push(re);
    out.im.push(im);
  }
  return out;
}

/**
 * Uniform partitioned convolution (overlap-save): per block, one forward and one inverse FFT and a
 * multiply-accumulate against each partition of the impulse response. Allocates nothing once built.
 */
export class Convolver {
  private readonly fft: Fft;
  private readonly fdlRe: Float64Array[];
  private readonly fdlIm: Float64Array[];
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private readonly accRe: Float64Array;
  private readonly accIm: Float64Array;
  private readonly prev: Float64Array;
  private head = 0;

  constructor(
    private readonly h: IrSpectra,
    private readonly block: number,
  ) {
    const n = 2 * block;
    this.fft = new Fft(n);
    this.fdlRe = h.re.map(() => new Float64Array(n));
    this.fdlIm = h.re.map(() => new Float64Array(n));
    [this.re, this.im, this.accRe, this.accIm] = [0, 1, 2, 3].map(() => new Float64Array(n)) as [
      Float64Array,
      Float64Array,
      Float64Array,
      Float64Array,
    ];
    this.prev = new Float64Array(block);
  }

  /** Forget everything heard so far. */
  reset(): void {
    for (const f of [...this.fdlRe, ...this.fdlIm, this.prev]) f.fill(0);
  }

  /** Convolve one block (`block` samples) of `input` into `output`. */
  process(input: Float32Array, output: Float32Array): void {
    const [block, h] = [this.block, this.h];
    const { re, im, accRe, accIm } = this;
    const n = 2 * block;
    for (let i = 0; i < block; i++) {
      re[i] = this.prev[i] as number;
      re[block + i] = input[i] ?? 0;
      this.prev[i] = input[i] ?? 0;
    }
    im.fill(0);
    this.fft.forward(re, im);
    const parts = h.re.length;
    this.head = (this.head + 1) % parts;
    (this.fdlRe[this.head] as Float64Array).set(re);
    (this.fdlIm[this.head] as Float64Array).set(im);
    accRe.fill(0);
    accIm.fill(0);
    for (let p = 0; p < parts; p++) {
      const slot = (this.head - p + parts) % parts;
      const [xr, xi] = [this.fdlRe[slot] as Float64Array, this.fdlIm[slot] as Float64Array];
      const [hr, hi] = [h.re[p] as Float64Array, h.im[p] as Float64Array];
      for (let k = 0; k < n; k++) {
        accRe[k] =
          (accRe[k] as number) +
          (xr[k] as number) * (hr[k] as number) -
          (xi[k] as number) * (hi[k] as number);
        accIm[k] =
          (accIm[k] as number) +
          (xr[k] as number) * (hi[k] as number) +
          (xi[k] as number) * (hr[k] as number);
      }
    }
    this.fft.inverse(accRe, accIm);
    for (let i = 0; i < block; i++) output[i] = accRe[block + i] as number;
  }
}
