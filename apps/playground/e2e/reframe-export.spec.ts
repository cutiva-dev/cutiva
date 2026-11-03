import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { installFakeDetector } from "./fake-detector";

// Reframe phase 5: split and wide + blur are drawn, and the exported MP4 matches the preview.
// fixtures/talk.mp4 (see reframe-editor.spec.ts): red face x 390–690, blue face x 1230–1530, both
// y 300–600, on grey; Speaker A (red) talks for the first 3 s, Speaker B (blue) after.
const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "fixtures/talk.mp4");
const mediabunnyEntry = createRequire(import.meta.url).resolve("mediabunny");
const mediabunnyBundle = join(mediabunnyEntry.slice(0, mediabunnyEntry.search(/[\\/]dist[\\/]/)), "dist", "bundles", "mediabunny.min.mjs");

/** Colour classes at fixed points and where red and blue start along some rows, for one frame. */
interface Measure {
  points: Record<string, string>;
  edges: Record<string, { red: number; blue: number }>;
}

/** Installs window.__measure(canvas): the same measurement for the preview and for exported frames. */
function installMeasure() {
  const near = (v: number, want: number) => Math.abs(v - want) < 30;
  const classOf = (r: number, g: number, b: number) =>
    r > 180 && g < 80 && b < 80 ? "red" : b > 180 && r < 80 && g < 100 ? "blue" : near(r, 128) && near(g, 128) && near(b, 128) ? "grey" : near(r, 83) && near(g, 83) && near(b, 83) ? "dim" : "other";
  (window as unknown as { __measure: unknown }).__measure = (canvas: HTMLCanvasElement | OffscreenCanvas) => {
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    const { width: w, height: h } = canvas;
    const data = ctx.getImageData(0, 0, w, h).data;
    const at = (x: number, y: number) => {
      const i = (y * w + x) * 4;
      return classOf(data[i]!, data[i + 1]!, data[i + 2]!);
    };
    const points: Record<string, string> = {};
    for (const [name, fx, fy] of [
      ["centre30", 0.5, 0.3],
      // A split region is sized so the face is 35% of its height, 12% below its top: in a 9:16 frame
      // the faces sit around 15% (top half) and 65% (bottom half) of the height.
      ["top", 0.5, 0.15],
      ["bottom", 0.5, 0.65],
      ["corner", 0.05, 0.05],
      ["wideRed", 300 / 1080, 900 / 1920],
    ] as const)
      points[name] = at(Math.floor(w * fx), Math.floor(h * fy));
    const edges: Record<string, { red: number; blue: number }> = {};
    for (const [name, fy] of [
      ["row15", 0.15],
      ["row30", 0.3],
      ["row65", 0.65],
      ["rowWide", 900 / 1920],
    ] as const) {
      const y = Math.floor(h * fy);
      let red = -1;
      let blue = -1;
      for (let x = 0; x < w; x++) {
        const c = at(x, y);
        if (c === "red" && red < 0) red = x;
        if (c === "blue" && blue < 0) blue = x;
      }
      edges[name] = { red, blue };
    }
    return { points, edges };
  };
}

const measurePreview = (page: Page) => page.getByLabel("Video preview").evaluate((c: HTMLCanvasElement) => (window as unknown as { __measure: (c: HTMLCanvasElement) => Measure }).__measure(c));

async function seek(page: Page, tS: number) {
  // The ruler is 60 px per second from the timeline's left edge.
  await page.getByRole("slider", { name: "Playhead" }).click({ position: { x: Math.round(tS * 60), y: 10 } });
}

test("split and wide + blur draw in the preview, and the exported MP4 matches it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(installFakeDetector);
  await page.addInitScript(installMeasure);
  await page.goto("/");
  await page.getByLabel("Import media files").setInputFiles(fixture);
  await page.getByLabel("Format").selectOption({ label: "9:16 vertical" });
  await page.locator(".cutiva-clip--video").click({ position: { x: 20, y: 10 } });
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(page.getByText("2 people · 2 segments")).toBeVisible({ timeout: 30_000 });

  // Split the clip at 1.5 s: 0–1.5 s stays on Speaker A; the right half's first segment goes wide
  // and its second (Speaker B) becomes a split of both.
  await seek(page, 1.5);
  await page.getByRole("button", { name: "Split at playhead" }).click();
  await expect(page.locator(".cutiva-clip--video")).toHaveCount(2);
  await page.getByRole("radio", { name: "Wide" }).click();
  const camera = page.getByRole("group", { name: "Camera" });
  await expect(camera.getByRole("button")).toHaveCount(3);
  await expect(camera.getByRole("button").nth(1)).toHaveAccessibleName(/^Camera: Wide \(locked\)/);
  await camera.getByRole("button").nth(2).click();
  await page.getByRole("radio", { name: "Split" }).click();
  await expect(camera.getByRole("button").nth(2)).toHaveAccessibleName(/^Camera: Split · .+ \(locked\)/);

  // The preview at three instants, once it has drawn the expected layout.
  const samples = [
    { t: 0.75, ready: (m: Measure) => m.points.centre30 === "red" },
    { t: 2.4, ready: (m: Measure) => m.points.corner === "dim" && m.points.wideRed === "red" },
    { t: 4.6, ready: (m: Measure) => new Set([m.points.top, m.points.bottom]).size === 2 && [m.points.top, m.points.bottom].every((c) => c === "red" || c === "blue") },
  ];
  const preview: Measure[] = [];
  for (const s of samples) {
    await seek(page, s.t);
    await expect.poll(async () => s.ready(await measurePreview(page)), { message: `preview at ${s.t} s` }).toBe(true);
    preview.push(await measurePreview(page));
  }
  // Single: only red at 30% height. Wide: the whole picture letterboxed over a dimmed blur, both faces
  // in it. Split: one face per half.
  expect(preview[0]!.edges.row30!.blue).toBe(-1);
  expect(preview[1]!.edges.rowWide!.red).toBeGreaterThan(0);
  expect(preview[1]!.edges.rowWide!.blue).toBeGreaterThan(preview[1]!.edges.rowWide!.red);

  const exportButton = page.getByRole("button", { name: "Export MP4" });
  const noVideoEncoder = page.getByText("can't encode H.264");
  await expect.poll(async () => (await exportButton.isEnabled()) || (await noVideoEncoder.isVisible())).toBe(true);
  test.skip(await noVideoEncoder.isVisible(), "This browser can't encode H.264, so the app turns export off.");
  const downloading = page.waitForEvent("download");
  await exportButton.click();
  const bytes = await readFile((await (await downloading).path())!);

  await page.route("**/__e2e/mediabunny.mjs", (route) => route.fulfill({ path: mediabunnyBundle, contentType: "text/javascript" }));
  await page.route("**/__e2e/export.mp4", (route) => route.fulfill({ body: bytes, contentType: "video/mp4" }));
  const exported = await page.evaluate(async (times) => {
    const mb = await import(/* @vite-ignore */ `${location.origin}/__e2e/mediabunny.mjs`);
    const input = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BlobSource(await (await fetch("/__e2e/export.mp4")).blob()) });
    const video = await input.getPrimaryVideoTrack();
    const sink = new mb.CanvasSink(video);
    const out: Measure[] = [];
    for (const t of times) out.push((window as unknown as { __measure: (c: HTMLCanvasElement) => Measure }).__measure((await sink.getCanvas(t)).canvas));
    return { size: [video.displayWidth, video.displayHeight], frames: out };
  }, samples.map((s) => s.t));

  expect(exported.size).toEqual([1080, 1920]);
  let worst = 0;
  samples.forEach((s, i) => {
    const p = preview[i]!;
    const e = exported.frames[i]!;
    expect(e.points, `colours at ${s.t} s`).toEqual(p.points);
    for (const row of Object.keys(p.edges)) {
      for (const c of ["red", "blue"] as const) {
        const a = p.edges[row]![c];
        const b = e.edges[row]![c];
        if (a >= 0 && b >= 0) worst = Math.max(worst, Math.abs(a - b));
        // Same face edge to within 2 output pixels (about 1 source pixel at 1.78x); or absent in both.
        expect(a < 0 ? b : Math.abs(a - b), `${c} edge on ${row} at ${s.t} s: preview ${a}, export ${b}`).toBeLessThanOrEqual(a < 0 ? -1 : 2);
      }
    }
  });
  test.info().annotations.push({ type: "largest edge difference", description: `${worst} px between preview and export` });
  expect(errors).toEqual([]);
});
