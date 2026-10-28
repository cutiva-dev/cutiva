import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_FORMATS, BufferSource, Input } from "mediabunny";

// fixtures/clip.mp4: 4 s, 640x360, H.264 + AAC. Every second, from x.5 to x.6, the frame flashes
// white and a 440 Hz beep plays; the rest is a test pattern and silence. The markers let us check
// that the exported picture and sound land at the right times, not just that the file is long enough.
const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "fixtures/clip.mp4");
const mediabunnyEntry = createRequire(import.meta.url).resolve("mediabunny");
const mediabunnyBundle = join(mediabunnyEntry.slice(0, mediabunnyEntry.lastIndexOf("/dist/")), "dist/bundles/mediabunny.min.mjs");

const PX_PER_SECOND = 60; // <Timeline> default zoom

const clipTitles = (page: Page) => page.locator(".cutiva-clip").evaluateAll((els) => els.map((e) => e.getAttribute("title")));

test("import, split, delete the first part, export: output is trimmed and in sync", async ({ page, browserName }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");
  await page.getByLabel("Import media files").setInputFiles(fixture);
  await expect.poll(() => clipTitles(page)).toEqual(["clip.mp4 · 00:00:00.000 – 00:00:04.000"]);

  // Seek to 1 s on the ruler, select the clip, split.
  const ruler = page.getByRole("slider", { name: "Playhead" });
  const box = (await ruler.boundingBox())!;
  await page.mouse.click(box.x + PX_PER_SECOND, box.y + box.height / 2);
  await expect(page.locator(".tc")).toContainText("00:00:01.000");
  await page.locator(".cutiva-clip--video").click({ position: { x: 2.5 * PX_PER_SECOND, y: 10 } });
  await page.getByRole("button", { name: "Split at playhead" }).click();
  await expect.poll(() => clipTitles(page)).toEqual([
    "clip.mp4 · 00:00:00.000 – 00:00:01.000",
    "clip.mp4 · 00:00:01.000 – 00:00:04.000",
  ]);

  // Remove the first second; the rest ripples to zero.
  await page.locator(".cutiva-clip--video").first().click({ position: { x: PX_PER_SECOND / 2, y: 10 } });
  await page.getByRole("button", { name: "Delete clip" }).click();
  await expect.poll(() => clipTitles(page)).toEqual(["clip.mp4 · 00:00:00.000 – 00:00:03.000"]);

  // Watch the main thread while exporting: the UI must stay responsive.
  await page.evaluate(() => {
    const w = window as unknown as { longTasks: number[] };
    w.longTasks = [];
    new PerformanceObserver((list) => list.getEntries().forEach((e) => w.longTasks.push(e.duration))).observe({ type: "longtask" });
  });
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export MP4" }).click();
  const download = await downloading;
  await expect(page.getByRole("status")).toHaveText("Export finished.");
  const longTasks = await page.evaluate(() => (window as unknown as { longTasks: number[] }).longTasks);
  // CI's macOS runners are several times slower and occasionally show a ~260 ms task that never
  // appears locally; half a second still catches a real freeze there.
  const limitMs = process.env.CI ? 500 : 250;
  expect(Math.max(0, ...longTasks), `main-thread tasks during export: ${longTasks.map(Math.round).join(", ")} ms`).toBeLessThan(limitMs);
  const bytes = await readFile((await download.path())!);

  // Container: one H.264 track and one AAC track, 3 s long.
  const input = new Input({ formats: ALL_FORMATS, source: new BufferSource(bytes) });
  const video = (await input.getPrimaryVideoTrack())!;
  const audio = (await input.getPrimaryAudioTrack())!;
  expect(video.codec).toBe("avc");
  // Firefox can't encode AAC, so export falls back to Opus there.
  expect(audio?.codec).toBe(browserName === "firefox" ? "opus" : "aac");
  expect([video.displayWidth, video.displayHeight]).toEqual([1920, 1080]);
  expect(await video.computeDuration()).toBeCloseTo(3, 2);
  // AAC pads its last frame, so audio may run a little past the video, never short of it.
  const audioEnd = await audio.computeDuration();
  expect(audioEnd).toBeGreaterThanOrEqual(3 - 0.005);
  expect(audioEnd).toBeLessThan(3 + 0.05);

  // Decode in the browser (WebCodecs) to check where the markers landed. The source's markers at
  // 1.5, 2.5 and 3.5 s should now be at 0.5, 1.5 and 2.5 s.
  await page.route("**/__e2e/mediabunny.mjs", (route) => route.fulfill({ path: mediabunnyBundle, contentType: "text/javascript" }));
  await page.route("**/__e2e/export.mp4", (route) => route.fulfill({ body: bytes, contentType: "video/mp4" }));
  const markers = await page.evaluate(async () => {
    const mb = await import(/* @vite-ignore */ `${location.origin}/__e2e/mediabunny.mjs`);
    const blob = await (await fetch("/__e2e/export.mp4")).blob();
    const input = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BlobSource(blob) });

    const audio = await input.getPrimaryAudioTrack();
    const onsets: number[] = [];
    let wasLoud = false;
    for await (const sample of new mb.AudioSampleSink(audio).samples()) {
      const ch = new Float32Array(sample.numberOfFrames);
      sample.copyTo(ch, { planeIndex: 0, format: "f32-planar" });
      ch.forEach((v, i) => {
        const t = sample.timestamp + i / sample.sampleRate;
        const loud = Math.abs(v) > 0.3;
        if (loud && !wasLoud && t >= 0 && (onsets.length === 0 || t - onsets[onsets.length - 1]! > 0.5)) onsets.push(t);
        if (loud) wasLoud = true;
        else if (Math.abs(v) < 0.01) wasLoud = false;
      });
      sample.close();
    }

    const video = await input.getPrimaryVideoTrack();
    const sink = new mb.CanvasSink(video, { width: 160 });
    const brightness: Record<string, number> = {};
    for (const t of [0.45, 0.55, 0.65, 1.55, 2.55]) {
      const frame = await sink.getCanvas(t);
      const ctx = frame.canvas.getContext("2d");
      const px = ctx.getImageData(0, 0, frame.canvas.width, frame.canvas.height).data;
      let sum = 0;
      for (let i = 0; i < px.length; i += 4) sum += (px[i] + px[i + 1] + px[i + 2]) / 3;
      brightness[t] = sum / (px.length / 4);
    }
    return { onsets, brightness };
  });

  // Sound: three beeps, each within 5 ms of where it belongs.
  expect(markers.onsets).toHaveLength(3);
  markers.onsets.forEach((t, i) => expect(Math.abs(t - (0.5 + i))).toBeLessThan(0.005));
  // Picture: white during the flashes, not just before or after.
  for (const t of ["0.55", "1.55", "2.55"]) expect(markers.brightness[t]).toBeGreaterThan(240);
  for (const t of ["0.45", "0.65"]) expect(markers.brightness[t]).toBeLessThan(200);

  expect(errors).toEqual([]);
});
