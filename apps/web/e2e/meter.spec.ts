import { expect, test } from "@playwright/test";

test("the output meter reads the chain's loudness, follows a riff, and resets", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Source").selectOption("riff");
  await page.getByRole("button", { name: "Start audio" }).click();
  await page.waitForFunction(() => window.__rig?.ready === true, undefined, { timeout: 30_000 });
  const read = async (name: string) => {
    const text = (await page.getByTestId(`meter-${name}`).textContent()) ?? "-";
    return text === "-" ? -120 : Number(text);
  };

  // a riff is playing: loudness and a peak below full scale
  await expect.poll(() => read("momentary"), { timeout: 15_000 }).toBeGreaterThan(-40);
  expect(await read("momentary")).toBeLessThan(0);
  const peak = await read("peak");
  expect(peak).toBeGreaterThan(-30);
  expect(peak).toBeLessThanOrEqual(0.5);
  await expect.poll(() => read("integrated"), { timeout: 15_000 }).toBeGreaterThan(-50);
  await page.screenshot({ path: "test-results/meter.png" });

  // paused: the momentary reading falls away within a second or so
  await page.getByRole("button", { name: "Pause riff" }).click();
  await expect.poll(() => read("momentary"), { timeout: 10_000 }).toBeLessThan(-60);

  // reset forgets the programme and the peak
  await page
    .getByRole("region", { name: "Output meter" })
    .getByRole("button", { name: "Reset" })
    .click();
  await expect.poll(() => read("integrated"), { timeout: 5_000 }).toBeLessThan(-100);
  await expect.poll(() => read("peak"), { timeout: 5_000 }).toBeLessThan(-100);
});
