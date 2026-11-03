import { expect, test } from "@playwright/test";

// Runs only against a live daemon (see scripts/compose-smoke.sh): RIG_URL=http://127.0.0.1:7878
const url = process.env.RIG_URL;
test.skip(!url, "set RIG_URL to run against a daemon");

test("UI served by the daemon connects with its session token and loads the board", async ({
  page,
}) => {
  await page.goto(url ?? "/");
  await expect(page.locator("#daemon")).toContainText("connected: board", { timeout: 15_000 });
  await page.click("#start");
  await page.waitForFunction(() => window.__rig?.ready === true, undefined, { timeout: 30_000 });
});
