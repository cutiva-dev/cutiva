import { describe, expect, it } from "vitest";
import { fromBase64, toAnalysis, type NativeMeasurements } from "../src/measurements.js";
import { planVideo, reframedProject } from "../src/plan.js";

const b64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes));

/**
 * What the Android analyzer returns for the web E2E fixture talk.mp4 (6 s, 1920x1080): a red face at
 * x 390 and a blue one at x 1230, 300 px tall; red's mouth moves for 3 s, then blue's. Voice all along.
 */
function talk(): NativeMeasurements {
  const frames = Array.from({ length: 30 }, (_, i) => {
    const atUs = i * 200_000;
    const redTalks = atUs < 3_000_000;
    const open = (on: boolean) => (on && i % 2 === 0 ? 0.4 : 0.1);
    return {
      atUs,
      faces: [
        { x: 390, y: 300, w: 300, h: 300, mouth: open(redTalks) },
        { x: 1230, y: 300, w: 300, h: 300, mouth: open(!redTalks) },
      ],
      voice: 0.8,
    };
  });
  return {
    durationUs: 6_000_000,
    width: 1920,
    height: 1080,
    fromUs: 0,
    toUs: 6_000_000,
    fps: 5,
    hasAudio: true,
    frames,
    histograms: frames.map(() => Array.from({ length: 48 }, (_, k) => (k === 8 || k === 24 || k === 40 ? 576 : 0))),
    peak: { width: 4, height: 2, luma: b64(Array(8).fill(128)) },
  };
}

describe("toAnalysis", () => {
  it("decodes base64 without atob", () => {
    expect([...fromBase64(b64([0, 1, 2, 250, 251, 252, 253]))]).toEqual([0, 1, 2, 250, 251, 252, 253]);
    expect([...fromBase64("")]).toEqual([]);
  });

  it("finds cuts and burned-in bars with @cutiva/core", () => {
    const m = talk();
    expect(toAnalysis(m)).toMatchObject({ durationUs: 6_000_000, width: 1920, height: 1080, cuts: [], hasAudio: true });
    expect(toAnalysis(m).activeArea).toBeUndefined();
    // Black top and bottom rows: a letterbox of a quarter of the height each side.
    const bars = { ...m, peak: { width: 4, height: 4, luma: b64([0, 0, 0, 0, 128, 128, 128, 128, 128, 128, 128, 128, 0, 0, 0, 0]) } };
    expect(toAnalysis(bars).activeArea).toEqual({ x: 0, y: 270, w: 1920, h: 540 });
    // The picture changes completely at frame 15 (3 s): a camera cut.
    const cut = { ...m, histograms: m.histograms.map((h, i) => (i < 15 ? h : h.map((_, k) => (k === 15 || k === 31 || k === 47 ? 576 : 0)))) };
    expect(toAnalysis(cut).cuts).toEqual([3_000_000]);
  });
});

describe("planVideo and reframedProject", () => {
  it("follows the speaker, then exports a one-clip reframed project", () => {
    const analysis = toAnalysis(talk());
    const plan = planVideo(analysis);
    expect(plan.passthrough).toBe(false);
    expect(plan.track.people).toHaveLength(2);
    const speakers = plan.track.segments.map((s) => s.speakers[0]);
    expect(new Set(speakers).size).toBe(2);

    const { project, plan: render } = reframedProject("file:///data/talk%20show.mp4", analysis, plan);
    expect(project.settings).toMatchObject({ width: 1080, height: 1920 });
    expect(project.assets[0]).toMatchObject({ name: "talk show.mp4", width: 1920, height: 1080, hasAudio: true });
    expect(render.video).toHaveLength(1);
    expect(render.video[0]).toMatchObject({ uri: "file:///data/talk%20show.mp4", sourceWidth: 1920, sourceHeight: 1080, startUs: 0, endUs: 6_000_000 });
    expect(render.video[0]!.crop!.length).toBeGreaterThan(0);
    expect(render.audio).toHaveLength(1);
  });

  it("applies corrections, keeping them when re-planned", () => {
    const analysis = toAnalysis(talk());
    const first = planVideo(analysis);
    const [seg] = first.track.segments;
    const other = first.track.people.find((p) => p.id !== seg!.speakers[0])!;
    const edited = planVideo(analysis, { track: first.track, edits: [{ type: "segment", segmentId: seg!.id, focus: [other.id], layout: "single" }] });
    const locked = edited.track.segments.find((s) => s.id === seg!.id)!;
    expect(locked).toMatchObject({ locked: true, focus: [other.id] });
    // Edits on a fresh plan work too, and style changes are kept in the track.
    expect(planVideo(analysis, { edits: [{ type: "settings", style: 100 }] }).track.style).toBe(100);
    // Another format: square.
    expect(reframedProject("file:///a.mp4", analysis, planVideo(analysis, { width: 1080, height: 1080 }), { width: 1080, height: 1080 }).project.settings.width).toBe(1080);
  });
});
