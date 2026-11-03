import { expect, test } from "@playwright/test";

// Acceptance criteria for V1 (docs/SLICES.md), driven through the V3 UI. Needs the WASM core: `make wasm`.
test("diode clipper adds 3rd harmonic and leaves CPU headroom", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/");
  await page.getByRole("button", { name: "Start audio" }).click();
  await page.waitForFunction(() => window.__rig?.ready === true, undefined, { timeout: 30_000 });
  await page.waitForTimeout(1500);

  const harmonic = () =>
    page.evaluate(() => (window.__rig?.level(330) ?? 0) - (window.__rig?.level(110) ?? 0));

  const withClipper = await harmonic();
  await page.getByRole("button", { name: /^Diode Clipper on/ }).click(); // footswitch: bypass
  await page.waitForTimeout(1500);
  const bypassed = await harmonic();

  console.log(`3rd/1st: clipper ${withClipper.toFixed(1)} dB, bypassed ${bypassed.toFixed(1)} dB`);
  expect(withClipper - bypassed).toBeGreaterThanOrEqual(20);

  expect(await page.evaluate(() => window.__rig?.headroom)).toBeGreaterThanOrEqual(4);
  expect(errors).toEqual([]);
});
