import { expect, test } from "@playwright/test";

test("the treadle moves with the mouse and keys, and the sound follows it", async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "Add Wah to the board" }).click();
  const wah = page.getByTestId("pedal-wah@1");
  const treadle = wah.getByRole("slider", { name: "Treadle" });
  await expect(treadle).toHaveAttribute("aria-valuenow", "0.5");
  await expect(treadle).toHaveAttribute("aria-valuetext", /centre/);

  // dragging the plate up pushes the toe down: a higher sweep
  const box = await treadle.boundingBox();
  if (!box) throw new Error("no treadle");
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 40, { steps: 5 });
  await page.mouse.up();
  const dragged = Number(await treadle.getAttribute("aria-valuenow"));
  expect(dragged).toBeGreaterThan(0.7);
  expect(dragged).toBeLessThan(0.9);

  await page.getByRole("button", { name: "Start audio" }).click();
  await page.waitForFunction(() => window.__rig?.ready === true, undefined, { timeout: 30_000 });
  await page.getByRole("button", { name: "Listen here: Output" }).click();
  const a110 = () => page.evaluate(() => window.__rig?.level(110) ?? -200);
  // the engine glides to a new treadle position, so read once the level has stopped moving
  const settled = async () => {
    let [last, now] = [-300, await a110()];
    for (let i = 0; i < 40 && Math.abs(now - last) > 0.3; i++) {
      last = now;
      await page.waitForTimeout(250);
      now = await a110();
    }
    return now;
  };

  // the 110 Hz test tone passes a band-pass at the heel (350 Hz) and is cut hard at the toe (2.2 kHz)
  await treadle.focus();
  await page.keyboard.press("Home");
  await expect(treadle).toHaveAttribute("aria-valuenow", "0");
  const heel = await settled();
  await page.keyboard.press("End");
  await expect(treadle).toHaveAttribute("aria-valuenow", "1");
  const toe = await settled();
  expect(heel).toBeGreaterThan(-60);
  expect(toe).toBeLessThan(heel - 8);
  await page.screenshot({ path: "test-results/wah.png" });
});
