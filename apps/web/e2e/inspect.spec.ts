import { expect, test } from "@playwright/test";

// The inspector gets the signal going into and out of the selected pedal, and follows it when it moves.
test("inspector receives the selected pedal's input and output, wherever it sits", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Add Fuzz to the board" }).click();
  await page.getByRole("button", { name: "Start audio" }).click();
  await page.waitForFunction(() => window.__rig?.ready === true, undefined, { timeout: 30_000 });

  const pair = () => page.evaluate(() => window.__rig?.pair());
  await page.getByTestId("pedal-fuzz@1").getByRole("heading").click();
  await expect.poll(async () => (await pair())?.slot).toBe(1);
  const second = await pair();
  expect(second?.after).not.toBeCloseTo(second?.before ?? 0, 2); // fuzz changed the level

  // move it to the front: its input is now the raw tone (full-scale sine at level 0.9, rms 0.636)
  await page.getByRole("button", { name: "Move Fuzz left" }).click();
  await expect.poll(async () => (await pair())?.slot).toBe(0);
  await expect.poll(async () => (await pair())?.before).toBeCloseTo(0.9 / Math.SQRT2, 1);

  // bypassing it makes the two signals the same
  await page.getByRole("button", { name: /^Fuzz on/ }).click();
  await expect
    .poll(async () => {
      const p = await pair();
      return Math.abs((p?.after ?? 0) - (p?.before ?? 1));
    })
    .toBeLessThan(0.01);
});

test("before/after spectrum shows what the clipper adds, and follows the Level knob", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start audio" }).click();
  await page.waitForFunction(() => window.__rig?.ready === true, undefined, { timeout: 30_000 });
  await page.getByTestId("pedal-diode-clipper@1").getByRole("heading").click();

  const third = () => page.evaluate(() => window.__rig?.pair(330));
  await expect.poll(async () => (await third())?.afterDb).toBeGreaterThan(-30);
  const both = await third(); // the tone has no 3rd harmonic going in; the clipper makes one
  expect((both?.afterDb ?? 0) - (both?.beforeDb ?? 0)).toBeGreaterThan(30);

  await page
    .getByRole("region", { name: "Pedal inspector" })
    .screenshot({ path: "test-results/inspector.png" });

  // turning Level to zero silences the output trace while the input trace stays
  await page.getByTestId("pedal-diode-clipper@1").getByRole("slider", { name: "Level" }).focus();
  await page.keyboard.press("Home");
  await expect.poll(async () => (await third())?.afterDb).toBeLessThan(-80);
  expect((await third())?.before).toBeGreaterThan(0.5);

  await expect(page.getByLabel("Spectrum before and after")).toBeVisible();
});
