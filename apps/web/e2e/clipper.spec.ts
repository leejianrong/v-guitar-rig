import { expect, test } from "@playwright/test";

// Acceptance criteria for V1 (docs/SLICES.md). Needs the WASM core: `make wasm` first.
test("diode clipper adds 3rd harmonic and leaves CPU headroom", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/");
  await page.click("#start");
  await page.waitForFunction(() => window.__rig?.ready === true, undefined, { timeout: 30_000 });
  await page.waitForTimeout(1500);

  const harmonic = () =>
    page.evaluate(() => {
      const r = window.__rig;
      if (!r) throw new Error("rig not ready");
      return r.level("out", 330) - r.level("out", 110);
    });

  const withClipper = await harmonic();
  await page.click("#pedal"); // bypass
  await page.waitForTimeout(1500);
  const bypassed = await harmonic();

  console.log(`3rd/1st: clipper ${withClipper.toFixed(1)} dB, bypassed ${bypassed.toFixed(1)} dB`);
  expect(withClipper - bypassed).toBeGreaterThanOrEqual(20);

  const headroom = await page.evaluate(() => window.__rig?.headroom);
  expect(headroom).toBeGreaterThanOrEqual(4);
  expect(errors).toEqual([]);
});
