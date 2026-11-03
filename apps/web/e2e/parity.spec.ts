import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { KNOWN_MODULES, renderBoard } from "@rig/dsp-host";
import { type Board, testClip, validateBoard } from "@rig/shared";

// V2 acceptance: the live AudioWorklet code path (run offline in Chromium) and the Node renderer
// produce the same samples within 1e-5 for the same board and clip (docs/PLAN.md, Q23).
const board: Board = {
  schema: 1,
  id: "parity",
  name: "Parity",
  rev: 0,
  slots: [{ id: "s1", module: "diode-clipper@1", bypass: false, params: {} }],
};

test("browser worklet output matches Node render within 1e-5 on a 5 s clip", async ({ page }) => {
  expect(validateBoard(board, KNOWN_MODULES).ok).toBe(true);
  const clip = testClip(5 * 48000);
  const wasm = new WebAssembly.Module(
    readFileSync(
      new URL("../../../target/wasm32-unknown-unknown/release/rig_core.wasm", import.meta.url),
    ),
  );
  const node = renderBoard(wasm, board, clip);

  await page.goto("/");
  const browser = await page.evaluate((c) => window.__rigOffline?.(c), Array.from(clip));
  expect(browser?.length).toBe(node.length);

  let maxDiff = 0;
  for (let i = 0; i < node.length; i++)
    maxDiff = Math.max(maxDiff, Math.abs((browser?.[i] ?? 0) - (node[i] ?? 0)));
  console.log(`max |browser - node| = ${maxDiff}`);
  expect(maxDiff).toBeLessThanOrEqual(1e-5);
});
