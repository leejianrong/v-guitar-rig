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

test("a riff typed into the tab editor is heard, edits are heard while it plays, and the playhead moves", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Source").selectOption("riff");
  await page.getByRole("button", { name: "New riff" }).click();
  const cell = (string: number, slot: number) =>
    page.getByRole("button", { name: new RegExp(`^String ${string}, step ${slot + 1}(:|$)`) });
  const a110 = () => page.evaluate(() => window.__rig?.level(110) ?? -200);

  // the open A string (string 5) on every beat: typing 0 puts a note in the cell
  for (const slot of [0, 2, 4, 6]) {
    await cell(5, slot).click();
    await page.keyboard.press("0");
  }
  await expect(cell(5, 2)).toContainText("0");
  await page.getByRole("button", { name: "Start audio" }).click();
  await page.waitForFunction(() => window.__rig?.ready === true, undefined, { timeout: 30_000 });
  await page.getByRole("button", { name: "Listen here: Output" }).click();
  await expect.poll(a110, { timeout: 15_000 }).toBeGreaterThan(-70);
  await page.screenshot({ path: "test-results/riff-editor.png" });

  // the playhead goes forward and comes back round (a 4-beat riff at 100 bpm is 2.4 s)
  const beat = () =>
    page.getByTestId("playhead").evaluate((e) => Number((e as HTMLElement).dataset.beat));
  const seen = new Set<number>();
  for (let i = 0; i < 40; i++) {
    seen.add(Math.floor(await beat()));
    await page.waitForTimeout(100);
  }
  expect([...seen].sort()).toEqual([0, 1, 2, 3]);

  // while it plays, move every note to the high e string (string 1: no 110 Hz left): the A fades
  for (const slot of [0, 2, 4, 6]) {
    await cell(5, slot).click();
    await page.keyboard.press("Backspace");
    await cell(1, slot).click();
    await page.keyboard.press("5");
  }
  await expect.poll(a110, { timeout: 15_000 }).toBeLessThan(-80);
  await cell(1, 0).click();
  await page.keyboard.press("Space"); // space in the grid pauses
  await expect(page.getByRole("button", { name: "Play riff" })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__rig?.level(659) ?? 0), { timeout: 15_000 })
    .toBeLessThan(-80);
});
