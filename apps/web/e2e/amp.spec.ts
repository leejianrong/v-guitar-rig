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
