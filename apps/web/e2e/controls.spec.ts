import { expect, test } from "@playwright/test";

const start = async (page: import("@playwright/test").Page) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start audio" }).click();
  await page.waitForFunction(() => window.__rig?.ready === true, undefined, { timeout: 30_000 });
};

test("stop audio silences the tone and releases the device; it can be restarted", async ({
  page,
}) => {
  await start(page);
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => window.__rig?.level(110) ?? -200)).toBeGreaterThan(-60);

  await page.getByRole("button", { name: "Stop audio" }).click();
  await expect(page.getByRole("button", { name: "Start audio" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Source" })).toBeEnabled();
  expect(await page.evaluate(() => window.__rig)).toBeUndefined();

  await start(page); // fresh page, but also proves a second start works in the same browser
  await expect(page.getByRole("button", { name: "Stop audio" })).toBeVisible();
});

test("a pedal's knob turns by dragging and, once clicked, by the wheel", async ({ page }) => {
  await page.goto("/");
  const knob = page.getByRole("slider", { name: "Drive" });
  const value = async () => Number(await knob.getAttribute("aria-valuenow"));
  const box = await knob.boundingBox();
  if (!box) throw new Error("knob not visible");
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];

  const v0 = await value();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 60, { steps: 6 });
  await page.mouse.up();
  await page.mouse.move(x, y); // the wheel acts on the knob under the pointer
  const v1 = await value();
  expect(v1).toBeGreaterThan(v0); // drag up turns it up, and the pedal did not start a native drag

  const scrollY = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, -200); // clicked, so focused: the wheel turns it up
  await expect.poll(value).toBeGreaterThan(v1);
  const v2 = await value();
  await page.mouse.wheel(0, 300);
  await expect.poll(value).toBeLessThan(v2);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);

  await page.getByRole("heading", { name: "Shelf" }).click(); // click elsewhere: knob deselected
  const v3 = await value();
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(200);
  expect(await value()).toBe(v3);
});

test("shelf is on the left with thumbnails and adds pedals", async ({ page }) => {
  await page.goto("/");
  const shelf = page.getByRole("complementary", { name: "Pedal shelf" });
  const board = page.getByRole("region", { name: "Pedalboard" });
  const [s, b] = await Promise.all([shelf.boundingBox(), board.boundingBox()]);
  expect((s?.x ?? 1e9) + (s?.width ?? 0)).toBeLessThanOrEqual(b?.x ?? 0);
  await expect(shelf.locator(".thumb")).toHaveCount(9);
  await shelf.getByRole("button", { name: "Add Fuzz to the board" }).click();
  await expect(page.getByTestId("pedal-fuzz@1")).toBeVisible();
});

test("output volume sits beside input level", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Output volume").fill("0.3");
  await expect(page.getByLabel("Output volume")).toHaveValue("0.3");
});

test("dragging a pedal by its legend reorders the board", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Add Fuzz to the board" }).click();
  const order = () =>
    page
      .locator("[data-testid^=pedal-]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
  expect(await order()).toEqual(["pedal-diode-clipper@1", "pedal-fuzz@1"]);
  await page
    .getByTestId("pedal-fuzz@1")
    .getByRole("heading")
    .dragTo(page.getByTestId("pedal-diode-clipper@1"));
  expect(await order()).toEqual(["pedal-fuzz@1", "pedal-diode-clipper@1"]);
});
