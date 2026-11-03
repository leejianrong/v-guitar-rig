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

test("click a pedal to inspect it; knobs and the footswitch do not change the selection", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Add Fuzz to the board" }).click();
  const clipper = page.getByTestId("pedal-diode-clipper@1");
  const fuzz = page.getByTestId("pedal-fuzz@1");
  const panel = page.getByRole("region", { name: "Pedal inspector" });
  await expect(panel).toHaveCount(0);

  await clipper.getByRole("heading").click();
  await expect(panel).toContainText("Diode Clipper");
  await expect(clipper).toHaveClass(/selected/);

  await fuzz.getByRole("slider").first().click();
  await fuzz.getByRole("button", { name: /^Fuzz on/ }).click();
  await expect(panel).toContainText("Diode Clipper"); // unchanged

  await fuzz.getByRole("button", { name: "Inspect Fuzz" }).click(); // keyboard route
  await expect(panel).toContainText("Fuzz");
  await expect(clipper).not.toHaveClass(/selected/);

  await page.getByRole("region", { name: "Pedalboard" }).click({ position: { x: 4, y: 4 } });
  await expect(panel).toHaveCount(0);

  await fuzz.getByRole("heading").click();
  await page.getByRole("button", { name: "Remove Fuzz" }).click();
  await expect(panel).toHaveCount(0);
});
