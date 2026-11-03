import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { installFakeDetector } from "./fake-detector";

// fixtures/talk.mp4: 6 s, 1920x1080, 25 fps, no audio (so every frame counts as voiced). Two "faces":
// a red square (x 390–690) and a blue one (x 1230–1530), both y 300–600, on grey. A white "mouth"
// box flickers inside the red one for the first 3 s and inside the blue one after. A fake detector
// (fake-detector.ts) reads the mouths from the pixels, so the planner sees Speaker A talking, then Speaker B.
// A 9:16 window (607x1080) centred on a face shows only that face's colour at 30% height.
const fixture = join(dirname(fileURLToPath(import.meta.url)), "fixtures/talk.mp4");

type Rgb = [number, number, number];
const near = (v: number, want: number) => Math.abs(v - want) < 30;
const colorOf = ([r, g, b]: Rgb): "red" | "blue" | "grey" | "dim" | "other" =>
  r > 180 && g < 80 && b < 80
    ? "red"
    : b > 180 && r < 80 && g < 100
      ? "blue"
      : near(r, 128) && near(g, 128) && near(b, 128)
        ? "grey"
        : near(r, 83) && near(g, 83) && near(b, 83)
          ? "dim" // the wide layout's blurred, darkened background
          : "other";
const shown = (page: Page) =>
  page.getByLabel("Video preview").evaluate((c: HTMLCanvasElement) => Array.from(c.getContext("2d")!.getImageData(Math.floor(c.width / 2), Math.floor(c.height * 0.3), 1, 1).data.slice(0, 3)) as Rgb).then(colorOf);

test("reframe editor: analyse, lanes, click a face, layouts, people, camera style, undo and save", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(installFakeDetector);
  await page.goto("/");
  await page.getByLabel("Import media files").setInputFiles(fixture);
  await page.getByLabel("Format").selectOption({ label: "9:16 vertical" });
  await page.locator(".cutiva-clip--video").click({ position: { x: 20, y: 10 } });
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(page.getByText("2 people · 2 segments")).toBeVisible({ timeout: 30_000 });

  // Lanes under the video track: who talks, and what the camera shows.
  const speakers = page.getByRole("group", { name: "Speakers" });
  const camera = page.getByRole("group", { name: "Camera" });
  await expect(speakers.getByRole("button")).toHaveCount(2);
  await expect(speakers.getByRole("button").nth(0)).toHaveAccessibleName(/^Speakers: Speaker A, 00:00:00/);
  await expect(speakers.getByRole("button").nth(1)).toHaveAccessibleName(/^Speakers: Speaker B, 00:00:03/);
  await expect(camera.getByRole("button").nth(1)).toHaveAccessibleName(/^Camera: Speaker B, /);

  // Clicking a segment moves the playhead to its middle; the preview frames that speaker.
  await camera.getByRole("button").nth(0).click();
  await expect.poll(() => shown(page)).toBe("red");
  await camera.getByRole("button").nth(1).click();
  await expect.poll(() => shown(page)).toBe("blue");
  await expect(page.getByRole("heading", { name: /Segment 2/ })).toBeVisible();

  // Click the red face on the source: segment 2 frames Speaker A, locked.
  const started = Date.now();
  await page.getByRole("button", { name: "Frame Speaker A" }).click();
  await expect.poll(() => shown(page)).toBe("red");
  const editMs = Date.now() - started;
  await expect(camera.getByRole("button").nth(1)).toHaveAccessibleName(/^Camera: Speaker A \(locked\)/);
  await expect(page.getByRole("radio", { name: "Single" })).toHaveAttribute("aria-checked", "true");

  // Undo and redo the click.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => shown(page)).toBe("blue");
  await page.getByRole("button", { name: "Redo" }).click();
  await expect.poll(() => shown(page)).toBe("red");

  // Reset to automatic gives the segment back to the planner.
  await page.getByRole("button", { name: "Reset to automatic" }).click();
  await expect.poll(() => shown(page)).toBe("blue");
  await expect(page.getByRole("radio", { name: "Auto" })).toHaveAttribute("aria-checked", "true");

  // Wide: the whole picture over a blurred copy; 30% down is the darkened background.
  await page.getByRole("radio", { name: "Wide" }).click();
  await expect(camera.getByRole("button").nth(1)).toHaveAccessibleName(/^Camera: Wide \(locked\)/);
  await expect.poll(() => shown(page)).toBe("dim");
  await page.getByRole("radio", { name: "Auto" }).click();
  await expect.poll(() => shown(page)).toBe("blue");

  // People: rename, Never focus re-plans every unlocked segment.
  const name = page.getByLabel("Name of Speaker B");
  await name.fill("Guest");
  await name.press("Enter");
  await expect(camera.getByRole("button").nth(1)).toHaveAccessibleName(/^Camera: Guest, /);
  await page.locator(".people li", { hasText: "Never focus" }).nth(1).getByLabel("Never focus").check();
  await expect(camera.getByRole("button").nth(1)).toHaveAccessibleName(/^Camera: Wide, /);
  await expect(page.getByText("only someone marked Never focus is talking")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(camera.getByRole("button").nth(1)).toHaveAccessibleName(/^Camera: Guest, /);

  // Camera style: Calm holds 1.6 s before switching.
  const style = page.getByRole("slider", { name: "Camera style" });
  await style.focus();
  await style.press("Home");
  await expect(page.getByText("Calm · holds 1.6 s before switching")).toBeVisible();
  await expect(page.getByText("2 people · 2 segments")).toBeVisible();

  // Zoom 1.2x: a crop would now upscale past 2x, so both segments go wide; Keep crop locks one.
  const zoom = page.getByRole("slider", { name: "Zoom" });
  await zoom.focus();
  await zoom.press("ArrowRight");
  await zoom.press("ArrowRight");
  await expect(camera.getByRole("button").nth(1)).toHaveAccessibleName(/^Camera: Wide, /);
  await expect(page.getByText(/Low quality crop/)).toBeVisible();
  await page.getByRole("button", { name: "Keep crop" }).click();
  await expect(camera.getByRole("button").nth(1)).toHaveAccessibleName(/^Camera: Guest \(locked\)/);
  await expect.poll(() => shown(page)).toBe("blue");

  // Dragging the window locks the segment too and keeps where it was dropped.
  const windowBox = page.getByRole("slider", { name: "Framing window" });
  const view = (await page.getByLabel("Source frame").boundingBox())!;
  const box = (await windowBox.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(view.x + view.width / 2, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(camera.getByRole("button").nth(1)).toHaveAccessibleName(/\(locked\)/);
  await expect.poll(() => shown(page)).toBe("grey");

  // Everything is in the saved project: the track with names, style and the locked segment.
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project" }).click();
  const saved = JSON.parse(await readFile((await (await downloading).path())!, "utf8"));
  const effect = saved.tracks[0].clips[0].effects.find((e: { type: string }) => e.type === "core/reframe");
  expect(effect.params.track).toMatchObject({ version: 1, style: 0, zoomPct: 120, people: [{ id: "p1", label: "Speaker A" }, { id: "p2", label: "Guest" }] });
  expect(effect.params.track.segments[1]).toMatchObject({ locked: true, reason: "user", window: { h: 900 } });
  // Dropped at the source's centre (to a pixel or so: the mouse moves in screen pixels).
  expect(Math.abs(effect.params.track.segments[1].window.x - 960)).toBeLessThanOrEqual(10);
  // Numbers only: no faces, images or audio in the project.
  expect(JSON.stringify(saved)).not.toMatch(/sightings|frames|data:image/);

  test.info().annotations.push({ type: "edit to preview", description: `${editMs} ms (click to the new colour on screen, includes polling)` });
  expect(errors).toEqual([]);
});

test("reframe editor: the analysis survives a reload, Apply to every clip, Analyze again without the cache", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(installFakeDetector);
  await page.goto("/");
  await page.getByLabel("Import media files").setInputFiles(fixture);
  await page.getByLabel("Format").selectOption({ label: "9:16 vertical" });
  await page.locator(".cutiva-clip--video").click({ position: { x: 20, y: 10 } });
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(page.getByText("2 people · 2 segments")).toBeVisible({ timeout: 30_000 });

  // Split at 4.5 s: both halves keep the track. Calm on the right half, then apply it to every clip.
  await page.getByRole("group", { name: "Camera" }).getByRole("button").nth(1).click();
  await page.getByRole("button", { name: "Split at playhead" }).click();
  await expect(page.locator(".cutiva-clip--video")).toHaveCount(2);
  const style = page.getByRole("slider", { name: "Camera style" });
  await style.focus();
  await style.press("Home");
  await expect(page.getByText(/^Calm · /)).toBeVisible();
  await page.getByRole("button", { name: "Apply to every clip" }).click();
  await page.locator(".cutiva-clip--video").first().click({ position: { x: 20, y: 10 } });
  await expect(page.getByText(/^Calm · /)).toBeVisible();
  // One undo step for every clip.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText(/^Balanced · /)).toBeVisible();
  await page.getByRole("button", { name: "Redo" }).click();

  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project" }).click();
  const projectFile = (await (await downloading).path())!;

  // Reload: the project comes back from the file, the analysis from IndexedDB.
  await page.reload();
  await page.getByLabel("Open project file").setInputFiles(projectFile);
  await page.getByLabel("Link media files").setInputFiles(fixture);
  await page.locator(".cutiva-clip--video").first().click({ position: { x: 20, y: 10 } });
  await expect(page.getByRole("button", { name: "Frame Speaker A" })).toBeVisible();
  await expect(page.getByText(/analysis isn't on this device/)).toHaveCount(0);

  // Without the cache, edits that re-plan wait for a new analysis; locked choices stay.
  // Delete it before the app opens it again (an open connection blocks the delete).
  await page.reload();
  await page.evaluate(() => new Promise((resolve, reject) => Object.assign(indexedDB.deleteDatabase("cutiva"), { onsuccess: resolve, onerror: reject, onblocked: reject })));
  await page.getByLabel("Open project file").setInputFiles(projectFile);
  await page.getByLabel("Link media files").setInputFiles(fixture);
  await page.locator(".cutiva-clip--video").first().click({ position: { x: 20, y: 10 } });
  await expect(page.getByText(/analysis isn't on this device/)).toBeVisible();
  await expect(page.getByRole("slider", { name: "Camera style" })).toBeDisabled();
  await page.getByRole("button", { name: "Analyze again" }).first().click();
  await expect(page.getByText(/analysis isn't on this device/)).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByText(/^Calm · /)).toBeVisible();
  expect(errors).toEqual([]);
});
