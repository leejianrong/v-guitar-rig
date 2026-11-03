import { expect, test } from "@playwright/test";

// Runs only against a live daemon (see scripts/compose-smoke.sh): RIG_URL and RIG_TOKEN are set.
const url = process.env.RIG_URL;
const token = process.env.RIG_TOKEN;
test.skip(!url || !token, "set RIG_URL and RIG_TOKEN to run against a daemon");

test("UI follows the daemon: loads the board and shows a value set by another client", async ({
  page,
  request,
}) => {
  await page.goto(url ?? "/");
  await expect(page.getByTestId("daemon")).toContainText("connected: board");
  await page.getByRole("button", { name: "Start audio" }).click();
  await page.waitForFunction(() => window.__rig?.ready === true, undefined, { timeout: 30_000 });

  // another client (the agent, in future) adds a pedal with a non-default value
  const headers = { authorization: `Bearer ${token}` };
  const board = await (await request.get(`${url}/api/boards/default`, { headers })).json();
  const put = await request.put(`${url}/api/boards/default`, {
    headers,
    data: {
      expectedRev: board.rev,
      board: {
        ...board,
        slots: [
          ...board.slots,
          { id: "agent-od", module: "overdrive@1", bypass: false, params: { drive: 12.5 } },
        ],
      },
    },
  });
  expect(put.ok()).toBe(true);

  const drive = page
    .locator('[data-testid="pedal-overdrive@1"]')
    .getByRole("slider", { name: "Drive" });
  await expect(drive).toHaveAttribute("aria-valuenow", "12.5", { timeout: 5000 });
});
