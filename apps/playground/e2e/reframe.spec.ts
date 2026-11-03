import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// fixtures/stripes.mp4: 2 s, 1280x720, no audio. Three vertical stripes, 427 px each: red, green,
// blue. A 9:16 window (405x720) fits inside one stripe, so the colour on screen says where it is.
const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "fixtures/stripes.mp4");
const mediabunnyEntry = createRequire(import.meta.url).resolve("mediabunny");
const mediabunnyBundle = join(mediabunnyEntry.slice(0, mediabunnyEntry.search(/[\\/]dist[\\/]/)), "dist", "bundles", "mediabunny.min.mjs");

type Rgb = [number, number, number];
const isColor = ([r, g, b]: Rgb, want: "red" | "green" | "blue" | "black") =>
  want === "black" ? r < 30 && g < 30 && b < 30 : want === "red" ? r > 200 && g < 60 && b < 60 : want === "green" ? g > 200 && r < 60 && b < 60 : b > 200 && r < 60 && g < 60;

/** Pixel of the preview canvas at a fraction of its size. */
const previewPixel = (page: Page, fx: number, fy: number) =>
  page.getByLabel("Video preview").evaluate(
    (c: HTMLCanvasElement, [x, y]) => Array.from(c.getContext("2d")!.getImageData(Math.floor(c.width * x!), Math.floor(c.height * y!), 1, 1).data.slice(0, 3)) as Rgb,
    [fx, fy],
  );

test("reframe a landscape clip to 9:16 by dragging the window: preview and export show that part", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Import media files").setInputFiles(fixture);
  await expect(page.locator(".cutiva-clip--video")).toHaveCount(1);

  await page.getByLabel("Format").selectOption({ label: "9:16 vertical" });
  await expect.poll(() => page.getByLabel("Video preview").evaluate((c: HTMLCanvasElement) => [c.width, c.height])).toEqual([1080, 1920]);
  // Not reframed yet: the whole frame is letterboxed, so the top of the vertical frame is black.
  await expect.poll(async () => isColor(await previewPixel(page, 0.5, 0.05), "black")).toBe(true);

  await page.locator(".cutiva-clip--video").click({ position: { x: 20, y: 10 } });
  const windowBox = page.getByRole("slider", { name: "Framing window" });
  await expect(windowBox).toBeVisible();
  // The source view has exactly the source's shape, so the window sits over the part it shows:
  // centred and 405/1280 of the width before any key exists.
  const view = (await page.getByLabel("Source frame").boundingBox())!;
  const box = (await windowBox.boundingBox())!;
  expect(view.width / view.height).toBeCloseTo(1280 / 720, 1);
  expect(box.width / view.width).toBeCloseTo(405 / 1280, 1);
  expect((box.x + box.width / 2 - view.x) / view.width).toBeCloseTo(0.5, 1);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // Past the left edge of the picture (but inside the page: Playwright's Firefox drops events outside it).
  await page.mouse.move(view.x + 2, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();

  // Window pushed to the left edge: red fills the whole vertical frame, top to bottom.
  await expect.poll(async () => isColor(await previewPixel(page, 0.5, 0.05), "red")).toBe(true);
  expect(isColor(await previewPixel(page, 0.5, 0.95), "red")).toBe(true);
  // One key, made by the drag, undoable.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => isColor(await previewPixel(page, 0.5, 0.05), "black")).toBe(true);
  await page.getByRole("button", { name: "Redo" }).click();
  await expect.poll(async () => isColor(await previewPixel(page, 0.5, 0.05), "red")).toBe(true);

  const exportButton = page.getByRole("button", { name: "Export MP4" });
  const noVideoEncoder = page.getByText("can't encode H.264");
  await expect.poll(async () => (await exportButton.isEnabled()) || (await noVideoEncoder.isVisible())).toBe(true);
  test.skip(await noVideoEncoder.isVisible(), "This browser can't encode H.264, so the app turns export off.");
  const downloading = page.waitForEvent("download");
  await exportButton.click();
  const bytes = await readFile((await (await downloading).path())!);

  await page.route("**/__e2e/mediabunny.mjs", (route) => route.fulfill({ path: mediabunnyBundle, contentType: "text/javascript" }));
  await page.route("**/__e2e/export.mp4", (route) => route.fulfill({ body: bytes, contentType: "video/mp4" }));
  const out = await page.evaluate(async () => {
    const mb = await import(/* @vite-ignore */ `${location.origin}/__e2e/mediabunny.mjs`);
    const input = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BlobSource(await (await fetch("/__e2e/export.mp4")).blob()) });
    const video = await input.getPrimaryVideoTrack();
    const frame = await new mb.CanvasSink(video).getCanvas(1);
    const ctx = frame.canvas.getContext("2d");
    const at = (fy: number) => Array.from(ctx.getImageData(frame.canvas.width / 2, Math.floor(frame.canvas.height * fy), 1, 1).data.slice(0, 3));
    return { size: [video.displayWidth, video.displayHeight], top: at(0.05), bottom: at(0.95) };
  });
  expect(out.size).toEqual([1080, 1920]);
  expect(isColor(out.top as Rgb, "red"), `top pixel ${out.top}`).toBe(true);
  expect(isColor(out.bottom as Rgb, "red"), `bottom pixel ${out.bottom}`).toBe(true);
  expect(errors).toEqual([]);
});
