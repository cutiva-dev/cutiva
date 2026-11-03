import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Runs MediaPipe for real, which downloads its WASM and model (~4 MB) from jsDelivr and Google, so
// it only runs with E2E_MEDIAPIPE=1. The stripes fixture has no faces: this checks the wiring
// (detector loads, every frame is analysed, the result is applied), not detection quality.
const fixture = join(dirname(fileURLToPath(import.meta.url)), "fixtures/stripes.mp4");

test("auto-reframe runs MediaPipe over a clip and applies the result", async ({ page }) => {
  test.skip(!process.env.E2E_MEDIAPIPE, "Set E2E_MEDIAPIPE=1 to run (needs the network).");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Import media files").setInputFiles(fixture);
  await page.getByLabel("Format").selectOption({ label: "9:16 vertical" });
  await page.locator(".cutiva-clip--video").click({ position: { x: 20, y: 10 } });
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(page.getByText("0 people · 1 segment")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("No faces here, so the whole picture shows (wide).")).toBeVisible();
  // No faces: wide. The whole picture is letterboxed in the middle (red stripe on its left) over a
  // blurred, darkened copy of its centre (the green stripe) at the top.
  const pixel = (x: number, y: number) =>
    page.getByLabel("Video preview").evaluate((c: HTMLCanvasElement, [px, py]) => Array.from(c.getContext("2d")!.getImageData(px!, py!, 1, 1).data.slice(0, 3)), [x, y]);
  await expect.poll(async () => ((p) => p[0]! < 60 && p[1]! > 120 && p[1]! < 210 && p[2]! < 60)(await pixel(540, 100))).toBe(true);
  expect(((p) => p[0]! > 200 && p[1]! < 60 && p[2]! < 60)(await pixel(100, 960))).toBe(true);

  // Feedback: rate the one framing, report. The report downloads and a prefilled GitHub issue opens.
  await page.context().route("https://github.com/**", (route) => route.fulfill({ body: "" }));
  await page.getByRole("button", { name: "Right", exact: true }).click();
  await page.getByRole("button", { name: "Good", exact: true }).click();
  const downloading = page.waitForEvent("download");
  const opening = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Report on GitHub" }).click();
  const issue = await opening;
  await issue.waitForURL(/^https:\/\/github\.com\/cutiva-dev\/cutiva\/issues\/new\?/);
  const params = new URL(issue.url()).searchParams;
  expect(params.get("title")).toBe("Auto-reframe feedback: good");
  expect(params.get("body")).toContain("1 (0 wrong)");
  expect(params.get("body")).toContain((await downloading).suggestedFilename());
  const text = await readFile((await (await downloading).path())!, "utf8");
  const report = JSON.parse(text);
  expect(report).toMatchObject({ version: 2, overall: "good", ratings: [{ atUs: 0, verdict: "good" }] });
  expect(report.final.track).toMatchObject({ version: 1, people: [], segments: [{ reason: "no-face", resolved: "wide" }] });
  expect(report.analysis.frames).toHaveLength(10);
  expect(report.settings).toMatchObject({ sourceWidth: 1280, sourceHeight: 720, outputWidth: 1080, outputHeight: 1920, style: 50, zoomPct: 100 });
  // Numbers only: the file name never leaves the page.
  expect(text).not.toContain("stripes");
  expect(params.get("body")).not.toContain("stripes");

  await page.getByRole("button", { name: "Remove auto-reframe" }).click();
  await expect(page.getByRole("button", { name: "Analyze", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
