import { expect, test } from "@playwright/test";

const add = (page: import("@playwright/test").Page, name: string) =>
  page.getByRole("button", { name: `Add ${name} to the board` }).click();

test("a preamp and power amp draw as one head with an effects loop, and a delay lands in it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto("/");
  // start from an empty board: remove the default pedal
  await page.getByRole("button", { name: /^Remove Diode Clipper/ }).click({ force: true });
  await add(page, "Overdrive");
  await add(page, "Valve Preamp");
  await add(page, "Power Amp");
  await add(page, "Speaker Cab");

  const head = page.getByTestId("amp-head");
  await expect(head).toHaveCount(1); // the two halves are one amp
  await expect(head.getByTestId("pedal-preamp@1")).toBeVisible();
  await expect(head.getByTestId("pedal-poweramp@1")).toBeVisible();
  await expect(head.getByText("Nothing in the loop")).toBeVisible();

  // a delay goes into the loop, between the halves; a drive pedal does not
  await add(page, "Delay");
  await expect(head.getByTestId("pedal-delay@1")).toBeVisible();
  await expect(head.getByText("Nothing in the loop")).toHaveCount(0);
  await add(page, "Fuzz");
  await expect(head.getByTestId("pedal-fuzz@1")).toHaveCount(0);

  // the listen jacks follow the signal: drive, preamp, delay (in the loop), power amp, cab, fuzz
  const jacks = await page
    .getByRole("button", { name: /^Listen here/ })
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  expect(jacks).toEqual([
    "Listen here: Input",
    "Listen here: After Overdrive",
    "Listen here: After Valve Preamp",
    "Listen here: After Delay",
    "Listen here: After Power Amp",
    "Listen here: After Speaker Cab",
    "Listen here: Output",
  ]);
  await page.screenshot({ path: "test-results/amp-rig.png", fullPage: true });
});

test("the inspector shows the transfer curve of an amp panel, and the cab is a speaker box", async ({
  page,
}) => {
  await page.goto("/");
  await add(page, "Valve Preamp");
  await add(page, "Power Amp");
  await add(page, "Speaker Cab");
  await page.getByRole("button", { name: "Inspect Power Amp" }).click({ force: true });
  const inspector = page.getByRole("region", { name: "Pedal inspector" });
  await expect(inspector.getByTestId("curve-summary")).toContainText("measured transfer curve");
  await expect(inspector.getByTestId("no-probe")).toHaveCount(0);
  await page.getByRole("button", { name: "Inspect Valve Preamp" }).click({ force: true });
  await expect(inspector.getByTestId("response-summary")).toContainText(
    "measured frequency response",
  );
  await expect(page.getByTestId("pedal-cab@1").locator(".cab-grille")).toBeVisible();
});
