import { expect, test } from "@playwright/test";

/** A 16-bit PCM WAV of a 110 Hz sine, in the left channel, the right channel or both. */
function wav(channel: "left" | "right" | "both", seconds = 2, rate = 48000): Buffer {
  const frames = rate * seconds;
  const out = Buffer.alloc(44 + frames * 4);
  out.write("RIFF", 0);
  out.writeUInt32LE(36 + frames * 4, 4);
  out.write("WAVEfmt ", 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20); // PCM
  out.writeUInt16LE(2, 22); // stereo
  out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * 4, 28);
  out.writeUInt16LE(4, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36);
  out.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) {
    const v = Math.round(0.5 * 32767 * Math.sin((2 * Math.PI * 110 * i) / rate));
    out.writeInt16LE(channel === "right" ? 0 : v, 44 + i * 4);
    out.writeInt16LE(channel === "left" ? 0 : v, 46 + i * 4);
  }
  return out;
}

const play = async (page: import("@playwright/test").Page, channel: "left" | "right" | "both") => {
  await page.goto("/");
  await page.getByLabel("Source").selectOption("file");
  await page
    .locator("input[type=file]")
    .setInputFiles({ name: "a110.wav", mimeType: "audio/wav", buffer: wav(channel) });
  await page.getByRole("button", { name: "Start audio" }).click();
  await page.waitForFunction(() => window.__rig?.ready === true, undefined, { timeout: 30_000 });
  await page.getByRole("button", { name: "Listen here: Output" }).click();
};

test("an audio file plays through the board, whichever channel holds the sound", async ({
  page,
}) => {
  await play(page, "both");
  await expect
    .poll(() => page.evaluate(() => window.__rig?.level(110) ?? -200), { timeout: 15_000 })
    .toBeGreaterThan(-60);
  await page.screenshot({ path: "test-results/file.png" });
});

test("a file with the sound only in its right channel is still heard", async ({ page }) => {
  await play(page, "right");
  await expect
    .poll(() => page.evaluate(() => window.__rig?.level(110) ?? -200), { timeout: 15_000 })
    .toBeGreaterThan(-60);
});

test("starting without choosing a file says so", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Source").selectOption("file");
  await page.getByRole("button", { name: "Start audio" }).click();
  await expect(page.getByText("Choose an audio file first")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start audio" })).toBeVisible();
});
