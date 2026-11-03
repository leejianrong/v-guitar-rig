import { expect, it } from "vitest";
import { powerDb } from "./fft";

it("puts a full-scale sine at 0 dB in the right bin", () => {
  const n = 4096;
  const bin = 100;
  const x = Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * bin * i) / n));
  const db = powerDb(x);
  const peak = db.indexOf(Math.max(...db));
  expect(peak).toBe(bin);
  expect(db[bin]).toBeGreaterThan(-0.5);
  expect(db[bin]).toBeLessThan(0.5);
  expect(db[bin + 40]).toBeLessThan(-80);
});
