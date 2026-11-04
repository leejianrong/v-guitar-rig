import { expect, test } from "@playwright/test";

test("the virtual guitar plays a riff through the board, and pausing silences it", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Source").selectOption("riff");
  await page.getByRole("combobox", { name: "Riff" }).selectOption("clean-arpeggio");
  await page.getByRole("button", { name: "Start audio" }).click();
  await page.waitForFunction(() => window.__rig?.ready === true, undefined, { timeout: 30_000 });
  await page.getByRole("button", { name: "Listen here: Output" }).click();

  // the arpeggio's open A string is 110 Hz; it only exists while the guitar is playing
  const a110 = () => page.evaluate(() => window.__rig?.level(110) ?? -200);
  await expect.poll(a110, { timeout: 15_000 }).toBeGreaterThan(-70);
  await page.screenshot({ path: "test-results/riff.png" });

  await page.getByRole("button", { name: "Pause riff" }).click();
  await expect.poll(a110, { timeout: 15_000 }).toBeLessThan(-90);
  await page.getByRole("button", { name: "Play riff" }).click();
  await expect.poll(a110, { timeout: 15_000 }).toBeGreaterThan(-70);
});
