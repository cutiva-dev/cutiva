import { expect, test } from "@playwright/test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Same fixture as export.spec.ts: the frame flashes white from x.5 to x.6 of every second.
const fixture = join(dirname(fileURLToPath(import.meta.url)), "fixtures/clip.mp4");
const PX_PER_SECOND = 60; // <Timeline> default zoom

test("preview shows the right frame after seeking forward and back", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Import media files").setInputFiles(fixture);
  await expect(page.locator(".cutiva-clip--video")).toHaveCount(1);

  const ruler = page.getByRole("slider", { name: "Playhead" });
  const box = (await ruler.boundingBox())!;
  const brightness = () =>
    page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>('canvas[aria-label="Video preview"]')!;
      // Sample the middle of the picture; the sides are letterbox.
      const d = c.getContext("2d")!.getImageData(c.width / 4, c.height / 4, c.width / 2, c.height / 2).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += (d[i]! + d[i + 1]! + d[i + 2]!) / 3;
      return sum / (d.length / 4);
    });

  // Forward, back within a second, then a long jump back to the start.
  for (const [seconds, white] of [
    [1.55, true],
    [1.45, false],
    [2.55, true],
    [2.65, false],
    [2.52, true],
    [0.55, true],
    [0.4, false],
  ] as const) {
    await page.mouse.click(box.x + seconds * PX_PER_SECOND, box.y + box.height / 2);
    if (white) await expect.poll(brightness, { message: `white at ${seconds}s` }).toBeGreaterThan(240);
    else await expect.poll(brightness, { message: `not white at ${seconds}s` }).toBeLessThan(200);
  }
});
