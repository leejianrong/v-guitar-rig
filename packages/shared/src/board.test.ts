import { describe, expect, it } from "vitest";
import { type Board, validateBoard } from "./board";

const known = new Set(["diode-clipper@1"]);
const good: Board = {
  schema: 1,
  id: "default",
  name: "Default",
  rev: 0,
  slots: [{ id: "a1", module: "diode-clipper@1", bypass: false, params: {} }],
};

describe("validateBoard", () => {
  it("accepts a good board", () => {
    expect(validateBoard(good, known).ok).toBe(true);
  });

  it("rejects a board with no schema field", () => {
    const { schema: _drop, ...rest } = good;
    const r = validateBoard(rest, known);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/schema/);
  });

  it("rejects unknown module ids", () => {
    const r = validateBoard({ ...good, slots: [{ ...good.slots[0], module: "nope@1" }] }, known);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/not a known module/);
  });

  it("rejects duplicate slot ids and non-finite params", () => {
    const s = good.slots[0];
    const r = validateBoard({ ...good, slots: [s, { ...s, params: { gain: Number.NaN } }] }, known);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/duplicates|finite/);
  });

  it("rejects non-objects", () => {
    expect(validateBoard(null, known).ok).toBe(false);
    expect(validateBoard([], known).ok).toBe(false);
  });
});
