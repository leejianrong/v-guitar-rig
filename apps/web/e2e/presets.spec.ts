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
  // an amp head (preamp, power amp) whose loop holds the delay and reverb, then the cab
  const head = page.getByTestId("amp-head");
  await expect(head.getByTestId("pedal-preamp@1")).toBeVisible();
  await expect(head.getByTestId("pedal-delay@1")).toBeVisible();
  await expect(head.getByTestId("pedal-reverb@1")).toBeVisible();
  expect(await order()).toEqual([
    "pedal-overdrive@1",
    "pedal-preamp@1",
    "pedal-poweramp@1",
    "pedal-delay@1",
    "pedal-reverb@1",
    "pedal-cab@1",
  ]);
  await page.screenshot({ path: "test-results/preset-loop.png" });
  const feedback = page.getByTestId("pedal-delay@1").getByRole("slider", { name: "Feedback" });
  await expect(feedback).toHaveAttribute("aria-valuenow", "0.5"); // the preset's value, not the default 0.4
  await expect(page.getByTestId("preset-notice")).toHaveCount(0); // loading is silent

  await page.getByRole("button", { name: "Start audio" }).click();
  await page.waitForFunction(() => window.__rig?.ready === true, undefined, { timeout: 30_000 });
  await page.getByRole("button", { name: "Listen here: Output" }).click();
  await expect.poll(() => page.evaluate(() => window.__rig?.level(110))).toBeGreaterThan(-60);
  await page.screenshot({ path: "test-results/preset.png" });
});

test("the loaded preset is highlighted until the board is edited", async ({ page }) => {
  await page.goto("/");
  const preset = (name: string) => page.getByRole("button", { name: `Load preset ${name}` });
  await expect(page.locator("[aria-current=true]")).toHaveCount(0);

  await preset("Blue Crunch").click();
  await expect(preset("Blue Crunch")).toHaveAttribute("aria-current", "true");
  await expect(page.locator("[aria-current=true]")).toHaveCount(1);
  await page.screenshot({ path: "test-results/preset-highlight.png" });

  // turning a knob makes the board something else: the highlight goes
  const drive = page.getByTestId("pedal-overdrive@1").getByRole("slider", { name: "Drive" });
  await drive.focus();
  await page.keyboard.press("ArrowUp");
  await expect(page.locator("[aria-current=true]")).toHaveCount(0);

  // choosing another preset highlights that one instead
  await preset("Iron Wall").click();
  await expect(preset("Iron Wall")).toHaveAttribute("aria-current", "true");
  await expect(page.locator("[aria-current=true]")).toHaveCount(1);
});

test("the presets and shelf panels collapse and open", async ({ page }) => {
  await page.goto("/");
  const preset = page.getByRole("button", { name: "Load preset Glass Clean" });
  const pedal = page.getByRole("button", { name: "Add Overdrive to the board" });
  await expect(preset).toBeVisible();
  await expect(pedal).toBeVisible();

  await page.getByRole("heading", { name: "Presets" }).click();
  await expect(preset).toBeHidden();
  await expect(pedal).toBeVisible(); // the shelf is its own panel
  await page.getByRole("heading", { name: "Shelf" }).click();
  await expect(pedal).toBeHidden();
  await page.getByRole("heading", { name: "Presets" }).click();
  await expect(preset).toBeVisible();
});

test("the tab has a favicon and the header shows the logo", async ({ page, request }) => {
  await page.goto("/");
  const href = await page.locator('link[rel="icon"]').getAttribute("href");
  expect(href).toBe("/favicon.svg");
  const res = await request.get("/favicon.svg");
  expect(res.ok()).toBe(true);
  expect(res.headers()["content-type"]).toContain("svg");
  await expect(page.locator("img.logo")).toBeVisible();
  await page.locator("header.bar").screenshot({ path: "test-results/header-logo.png" });
});
