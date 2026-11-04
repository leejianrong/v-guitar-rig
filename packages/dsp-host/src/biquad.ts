const TWO_PI = 2 * Math.PI;

export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
  z1: number;
  z2: number;
}
export const newBiquad = (): Biquad => ({ b0: 1, b1: 0, b2: 0, a1: 0, a2: 0, z1: 0, z2: 0 });
export const run = (f: Biquad, x: number) => {
  const y = f.b0 * x + f.z1;
  f.z1 = f.b1 * x - f.a1 * y + f.z2;
  f.z2 = f.b2 * x - f.a2 * y;
  return y;
};

/** RBJ cookbook coefficients. `gainDb` applies to the shelves and the peak; the pass filters ignore it. */
export function design(
  f: Biquad,
  kind: "low" | "high" | "peak" | "lp" | "hp",
  hz: number,
  sr: number,
  gainDb: number,
  q: number,
) {
  const w = (TWO_PI * hz) / sr;
  const [cos, sin] = [Math.cos(w), Math.sin(w)];
  const A = 10 ** (gainDb / 40);
  const alpha = sin / (2 * q);
  let [b0, b1, b2, a0, a1, a2] = [1, 0, 0, 1, 0, 0];
  if (kind === "hp") {
    [b0, b1, b2] = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
    [a0, a1, a2] = [1 + alpha, -2 * cos, 1 - alpha];
  } else if (kind === "lp") {
    [b0, b1, b2] = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2];
    [a0, a1, a2] = [1 + alpha, -2 * cos, 1 - alpha];
  } else if (kind === "peak") {
    [b0, b1, b2] = [1 + alpha * A, -2 * cos, 1 - alpha * A];
    [a0, a1, a2] = [1 + alpha / A, -2 * cos, 1 - alpha / A];
  } else {
    const s = 2 * Math.sqrt(A) * alpha;
    const sign = kind === "low" ? 1 : -1; // high shelf mirrors the low shelf
    b0 = A * (A + 1 - sign * (A - 1) * cos + s);
    b1 = sign * 2 * A * (A - 1 - sign * (A + 1) * cos);
    b2 = A * (A + 1 - sign * (A - 1) * cos - s);
    a0 = A + 1 + sign * (A - 1) * cos + s;
    a1 = -sign * 2 * (A - 1 + sign * (A + 1) * cos);
    a2 = A + 1 + sign * (A - 1) * cos - s;
  }
  Object.assign(f, { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 });
}
