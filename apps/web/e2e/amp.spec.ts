import { expect, test } from "@playwright/test";

test("the valve amp is on the shelf, runs on the board, and Gain adds harmonics", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Add Valve Amp to the board" }).click();
  await page.getByRole("button", { name: "Remove Diode Clipper" }).click(); // hear the amp alone
  await page.getByRole("button", { name: "Start audio" }).click();
  await page.waitForFunction(() => window.__rig?.ready === true, undefined, { timeout: 30_000 });
  await page.getByTestId("pedal-amp@1").getByRole("heading").click();

  const third = () => page.evaluate(() => window.__rig?.pair(330));
  const gain = page.getByTestId("pedal-amp@1").getByRole("slider", { name: "Gain" });
  await gain.focus();
  await page.keyboard.press("Home"); // minimum gain
  await expect.poll(async () => (await third())?.afterDb).toBeLessThan(-30);
  const clean = (await third())?.afterDb ?? 0;
  await page.keyboard.press("End"); // maximum gain
  await expect.poll(async () => (await third())?.afterDb ?? -120).toBeGreaterThan(clean + 15);
  await page.screenshot({ path: "test-results/amp.png" });
});

test("the speaker cab rolls the amp's fizz off, and switching cabs keeps playing", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Remove Diode Clipper" }).click();
  await page.getByRole("button", { name: "Add Valve Amp to the board" }).click();
  await page.getByRole("button", { name: "Add Speaker Cab to the board" }).click();
  await page.getByTestId("pedal-amp@1").getByRole("slider", { name: "Gain" }).focus();
  await page.keyboard.press("End");
  await page.getByRole("button", { name: "Start audio" }).click();
  await page.waitForFunction(() => window.__rig?.ready === true, undefined, { timeout: 30_000 });
  await page.getByTestId("pedal-cab@1").getByRole("heading").click();

  const fizz = async () => {
    const p = await page.evaluate(() => window.__rig?.pair(6000));
    return (p?.beforeDb ?? 0) - (p?.afterDb ?? 0);
  };
  await expect.poll(fizz).toBeGreaterThan(6); // what the amp makes at 6 kHz, the cab removes
  const combo = await fizz();
  const cab = page.getByTestId("pedal-cab@1").getByRole("slider", { name: "Cab" });
  await cab.focus();
  await page.keyboard.press("End"); // the brightest voicing: less of that is removed
  await expect.poll(fizz).toBeLessThan(combo - 3);
  await expect
    .poll(() => page.evaluate(() => window.__rig?.pair(330)?.after))
    .toBeGreaterThan(0.01);
  await page.getByTestId("pedal-cab@1").screenshot({ path: "test-results/cab.png" });
});
