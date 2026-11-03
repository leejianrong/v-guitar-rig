import { expect, test } from "@playwright/test";

// V3 board editing, standalone (no daemon): add, reorder, tune with the keyboard, bypass, remove.
test("edit a pedalboard and pick a signal tap", async ({ page }) => {
  await page.goto("/");
  const order = () =>
    page
      .locator("[data-testid^=pedal-]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));

  await page.getByRole("button", { name: "Add Overdrive to the board" }).click();
  expect(await order()).toEqual(["pedal-diode-clipper@1", "pedal-overdrive@1"]);

  await page.getByRole("button", { name: "Move Overdrive left" }).click();
  expect(await order()).toEqual(["pedal-overdrive@1", "pedal-diode-clipper@1"]);

  const drive = page
    .locator('[data-testid="pedal-overdrive@1"]')
    .getByRole("slider", { name: "Drive" });
  const before = Number(await drive.getAttribute("aria-valuenow"));
  await drive.focus();
  await page.keyboard.press("ArrowUp");
  expect(Number(await drive.getAttribute("aria-valuenow"))).toBeGreaterThan(before);
  await drive.dblclick(); // double-click resets to the default
  expect(Number(await drive.getAttribute("aria-valuenow"))).toBeCloseTo(6, 3);

  const foot = page.getByRole("button", { name: /^Overdrive on/ });
  await foot.click();
  await expect(page.getByRole("button", { name: /^Overdrive bypassed/ })).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  await page.getByRole("button", { name: "Listen here: Input" }).click();
  await expect(page.getByRole("heading", { name: /Signal\s*Input/ })).toBeVisible();

  await page.getByRole("button", { name: "Remove Overdrive" }).click();
  expect(await order()).toEqual(["pedal-diode-clipper@1"]);
});
