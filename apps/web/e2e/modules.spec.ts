import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

// A module added through the CLI reaches the page and runs in the audio engine (VGR-14). Needs the built
// daemon and UI: `pnpm test:e2e` builds both.
const root = new URL("../../../", import.meta.url).pathname;
const rig = join(root, "packages/daemon/dist/rig.mjs");
const web = join(root, "apps/web/dist");

const module = (id: string, name: string, process: string, create = "") => `
return { id: "${id}", name: "${name}", category: "drive", description: "test", params: [],
  create() { ${create} return { process(input, output) { ${process} } }; } };`;

const HALVER = module(
  "halver@1",
  "Halver",
  "for (let i = 0; i < input.length; i++) output[i] = input[i] * 0.5;",
);
// passes the gate (400 blocks) and goes bad after ~4 s of playing, as a real fault would
const LATE_NAN = module(
  "late-nan@1",
  "Late Nan",
  "n++; for (let i = 0; i < input.length; i++) output[i] = n > 1500 ? NaN : input[i];",
  "let n = 0;",
);

let daemon: ReturnType<typeof spawn>;
let url: string;
let dir: string;
let env: NodeJS.ProcessEnv;
const cli = (...args: string[]) => execFileSync("node", [rig, ...args], { env, encoding: "utf8" });

test.beforeAll(async () => {
  const port = await new Promise<number>((ok) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => ok(p));
    });
  });
  dir = mkdtempSync(join(tmpdir(), "rig-e2e-"));
  url = `http://127.0.0.1:${port}`;
  daemon = spawn("node", [
    rig,
    "serve",
    "--rig-dir",
    dir,
    "--port",
    String(port),
    "--web-dir",
    web,
  ]);
  const tokenFile = join(dir, ".rig/token");
  await expect
    .poll(
      () => {
        try {
          return readFileSync(tokenFile, "utf8").length;
        } catch {
          return 0;
        }
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);
  env = { ...process.env, RIG_URL: url, RIG_TOKEN: readFileSync(tokenFile, "utf8").trim() };
  writeFileSync(join(dir, "halver.js"), HALVER);
  writeFileSync(join(dir, "late-nan.js"), LATE_NAN);
});

test.afterAll(() => {
  daemon.kill();
});

test("a module added through the CLI appears on the shelf and runs on the board", async ({
  page,
}) => {
  await page.goto(url);
  await expect(page.getByTestId("daemon")).toContainText("connected");
  await page.getByRole("button", { name: "Start audio" }).click();
  await page.waitForFunction(() => window.__rig?.ready === true, undefined, { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Add Halver to the board" })).toHaveCount(0);

  cli("module", "new", join(dir, "halver.js")); // no reload: the page hears about it
  await page.getByRole("button", { name: "Add Halver to the board" }).click({ timeout: 10_000 });

  const halver = page.getByTestId("pedal-halver@1");
  await expect(halver).toBeVisible();
  await halver.getByRole("heading").click();
  const pair = () => page.evaluate(() => window.__rig?.pair());
  await expect
    .poll(async () => {
      const p = await pair();
      return p && p.slot === 1 ? p.after / p.before : 0;
    })
    .toBeCloseTo(0.5, 1);
  await expect(page.getByTestId("no-probe")).toBeVisible();
  await page.screenshot({ path: "test-results/stored-module.png" });
});

test("a module that goes bad while playing is bypassed and the board keeps playing", async ({
  page,
}) => {
  cli("module", "new", join(dir, "late-nan.js"));
  await page.goto(url);
  await page.getByRole("button", { name: "Add Late Nan to the board" }).click();
  await page.getByRole("button", { name: "Start audio" }).click();
  await page.waitForFunction(() => window.__rig?.ready === true, undefined, { timeout: 30_000 });
  const pedal = page.getByTestId("pedal-late-nan@1");
  await expect(pedal).toBeVisible();
  await expect(pedal.getByRole("alert")).toHaveCount(0); // it runs first, so it was compiled
  await expect(pedal.getByRole("alert")).toContainText("produced NaN", { timeout: 15_000 });

  // the diode clipper before it still sounds: the chain output is finite and loud
  await page.getByRole("button", { name: "Listen here: Output" }).click();
  await expect.poll(() => page.evaluate(() => window.__rig?.level(110))).toBeGreaterThan(-30);
});

test("a preset that needs a module this rig does not have says which and changes nothing", async ({
  page,
}) => {
  await page.route("**/api/presets", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.presets.push({
      schema: 1,
      id: "needs-ghost",
      name: "Needs Ghost",
      description: "uses a module that is not here",
      tags: ["ghostly"],
      rev: 0,
      slots: [{ id: "g", module: "ghost@1", bypass: false, params: {} }],
    });
    await route.fulfill({ response: res, json: body });
  });
  await page.goto(url);
  await expect(page.getByTestId("daemon")).toContainText("connected");
  const pedals = page.locator("[data-testid^=pedal-]");
  const before = await pedals.count();
  await page.getByRole("button", { name: "Load preset Needs Ghost" }).click();
  await expect(page.getByTestId("preset-notice")).toContainText("missing ghost@1");
  await expect(pedals).toHaveCount(before); // the board is as it was
});
