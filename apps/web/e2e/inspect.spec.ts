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

test("level view: turning a pedal up shows as gain, and bypassing it makes in and out coincide", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start audio" }).click();
  await page.waitForFunction(() => window.__rig?.ready === true, undefined, { timeout: 30_000 });
  await page.getByTestId("pedal-diode-clipper@1").getByRole("heading").click();
  const gap = async () => {
    const p = await page.evaluate(() => window.__rig?.pair());
    return (p?.envAfterDb ?? 0) - (p?.envBeforeDb ?? 0);
  };
  await page.getByTestId("pedal-diode-clipper@1").getByRole("slider", { name: "Level" }).focus();
  await page.keyboard.press("End"); // level x2 is about +6 dB
  await expect.poll(gap).toBeGreaterThan(3);

  await page.getByRole("button", { name: /^Diode Clipper on/ }).click();
  await expect.poll(async () => Math.abs(await gap())).toBeLessThan(0.3);
  await expect(page.getByRole("region", { name: "Pedal inspector" }).locator("output")).toHaveText(
    /^[+-]0\.\d dB$/,
  );
});

test("transfer curve is measured without audio running and follows the fuzz knob", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Add Fuzz to the board" }).click();
  const fuzz = page.getByTestId("pedal-fuzz@1");
  await fuzz.getByRole("heading").click();

  const summary = page.getByTestId("curve-summary");
  const quiet = async () => {
    const m = /quiet notes ([+-][\d.]+) dB/.exec((await summary.textContent()) ?? "");
    return Number(m?.[1] ?? Number.NaN);
  };
  await expect(summary).toContainText("quiet notes");
  const before = await quiet();
  // default fuzz 30x, level 0.4; the negative half swings 1.6 x 0.8 = 1.28x harder, and the peak is the larger
  const small = (fuzz: number) => 20 * Math.log10(fuzz * 0.4 * 1.28);
  expect(before).toBeCloseTo(small(30), 0);

  await fuzz.getByRole("slider", { name: "Fuzz" }).focus();
  await page.keyboard.press("End"); // 100x
  await expect.poll(quiet).toBeGreaterThan(before + 6);
  await expect.poll(quiet).toBeCloseTo(small(100), 0);

  await page.getByLabel("Transfer curve: level out against level in").screenshot({
    path: "test-results/curve.png",
  });
});

test("frequency response is measured and turning Tone moves the cutoff", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Add Overdrive to the board" }).click();
  const od = page.getByTestId("pedal-overdrive@1");
  await od.getByRole("heading").click();

  const summary = page.getByTestId("response-summary");
  const cutoff = async () => {
    const m = /falls 3 dB at ([\d.]+) (kHz|Hz)/.exec((await summary.textContent()) ?? "");
    return m ? Number(m[1]) * (m[2] === "kHz" ? 1000 : 1) : Number.NaN;
  };
  await expect.poll(cutoff).toBeGreaterThan(2500); // default tone 3 kHz
  expect(await cutoff()).toBeLessThan(3500);

  await od.getByRole("slider", { name: "Tone" }).focus();
  await page.keyboard.press("End"); // 8 kHz
  await expect.poll(cutoff).toBeGreaterThan(6500);
  await page.keyboard.press("Home"); // 800 Hz
  await expect.poll(cutoff).toBeLessThan(1000);

  await page.getByLabel("Frequency response at a small signal level").screenshot({
    path: "test-results/response.png",
  });
});
