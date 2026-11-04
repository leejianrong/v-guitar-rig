import { expect, test } from "@playwright/test";

// V4 acceptance: six pedals, the inspector drawing on each in turn, 60 s of audio.
// Dropouts are reported but not asserted: headless Chromium on WSL2 underruns even with one pedal and
// nothing selected (6 in 30 s measured), so the count says nothing about this code. See docs/hardware-checks.md.
test("holds 55 fps with six pedals and the inspector open", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  for (const name of ["Overdrive", "Fuzz", "Delay", "Chorus", "Reverb"])
    await page.getByRole("button", { name: `Add ${name} to the board` }).click();
  await expect(page.locator("[data-testid^=pedal-]")).toHaveCount(6);
  await page.getByRole("button", { name: "Start audio" }).click();
  await page.waitForFunction(() => window.__rig?.ready === true, undefined, { timeout: 30_000 });

  const pedals = await page.locator("[data-testid^=pedal-]").all();
  for (let t = 0; t < 12; t++) {
    await pedals[t % 6]?.getByRole("heading").click(); // a new pedal's views every 5 s
    await page.waitForTimeout(5000);
  }

  const stats = await page.evaluate(() => window.__rigStats?.());
  console.log(`soak: ${stats?.fps.toFixed(1)} fps average, ${stats?.underruns} dropouts, 60 s`);
  expect(stats?.fps).toBeGreaterThanOrEqual(55);
  expect(stats?.underruns).not.toBeNull(); // the browser reports them, so the footer number is real
});
