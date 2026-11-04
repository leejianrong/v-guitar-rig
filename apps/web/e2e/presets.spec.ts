import { expect, test } from "@playwright/test";

test("picking a preset replaces the board with its pedals and knob settings silently", async ({
  page,
}) => {
  await page.goto("/");
  const order = () =>
    page
      .locator("[data-testid^=pedal-]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
  expect(await order()).toEqual(["pedal-diode-clipper@1"]);

  await page.getByRole("button", { name: "Load preset Cosmic Lead" }).click();
  expect(await order()).toEqual([
    "pedal-overdrive@1",
    "pedal-amp@1",
    "pedal-cab@1",
    "pedal-delay@1",
    "pedal-reverb@1",
  ]);
  const feedback = page.getByTestId("pedal-delay@1").getByRole("slider", { name: "Feedback" });
  await expect(feedback).toHaveAttribute("aria-valuenow", "0.5"); // the preset's value, not the default 0.4
  await expect(page.getByTestId("preset-notice")).toHaveCount(0); // loading is silent

  await page.getByRole("button", { name: "Start audio" }).click();
  await page.waitForFunction(() => window.__rig?.ready === true, undefined, { timeout: 30_000 });
  await page.getByRole("button", { name: "Listen here: Output" }).click();
  await expect.poll(() => page.evaluate(() => window.__rig?.level(110))).toBeGreaterThan(-60);
  await page.screenshot({ path: "test-results/preset.png" });
});
