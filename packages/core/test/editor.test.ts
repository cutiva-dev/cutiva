import { afterEach, describe, expect, it, vi } from "vitest";
import {
  audioSegments,
  clipDurationUs,
  createEditor,
  formatTimecode,
  projectDurationUs,
  randomId,
  renderPlan,
  resolveVideoAt,
  secondsToUs,
  sequentialIds,
  usToSeconds,
  type Asset,
} from "../src/index.js";

const video: Asset = { id: "ast_v", kind: "video", name: "v.mp4", uri: "file://v.mp4", durationUs: 20_000_000, hasAudio: true };

function setup(historyLimit?: number) {
  const editor = createEditor({ ids: sequentialIds(), historyLimit });
  editor.dispatch({ type: "asset.add", asset: video });
  const { clipId } = editor.dispatch({ type: "clip.add", assetId: "ast_v" });
  return { editor, clipId };
}

describe("editor", () => {
  it("starts empty and reports what it can undo", () => {
    const editor = createEditor({ ids: sequentialIds() });
    expect(editor.canUndo).toBe(false);
    expect(editor.undo()).toBe(false);
    expect(editor.redo()).toBe(false);
    expect(editor.durationUs).toBe(0);
    editor.dispatch({ type: "asset.add", asset: video });
    expect(editor.canUndo).toBe(true);
  });

  it("opens an existing project", () => {
    const { editor } = setup();
    const reopened = createEditor({ project: editor.toJSON() });
    expect(reopened.project).toEqual(editor.project);
    expect(reopened.canUndo).toBe(false);
  });

  it("keeps at most historyLimit undo steps", () => {
    const { editor, clipId } = setup(2);
    for (const volume of [0.1, 0.2, 0.3]) editor.dispatch({ type: "clip.setVolume", clipId, volume });
    expect(editor.undo()).toBe(true);
    expect(editor.undo()).toBe(true);
    expect(editor.undo()).toBe(false);
    expect(editor.project.tracks[0]!.clips[0]!.volume).toBe(0.1);
  });

  it("load replaces the project, clears history and notifies", () => {
    const { editor } = setup();
    const other = createEditor({ ids: sequentialIds(), settings: { width: 640, height: 360 } }).toJSON();
    const causes: unknown[] = [];
    editor.subscribe((c) => causes.push(c.cause));
    editor.load(JSON.stringify(other));
    expect(editor.project.settings.width).toBe(640);
    expect(editor.canUndo).toBe(false);
    expect(editor.canRedo).toBe(false);
    expect(causes).toEqual(["load"]);
  });

  it("a failed load keeps the current project", () => {
    const { editor } = setup();
    const before = editor.project;
    expect(() => editor.load({ version: "0.1.0" })).toThrow();
    expect(editor.project).toBe(before);
  });

  it("an empty batch changes nothing", () => {
    const { editor } = setup();
    const before = editor.project;
    editor.batch([]);
    expect(editor.project).toBe(before);
  });

  it("projects are frozen and toJSON returns a copy", () => {
    const { editor } = setup();
    expect(Object.isFrozen(editor.project)).toBe(true);
    const copy = editor.toJSON();
    copy.tracks[0]!.clips[0]!.volume = 3;
    expect(editor.project.tracks[0]!.clips[0]!.volume).toBe(1);
  });

  it("unsubscribed listeners stop hearing changes", () => {
    const { editor, clipId } = setup();
    const heard: string[] = [];
    const off = editor.subscribe(() => heard.push("x"));
    editor.dispatch({ type: "clip.setVolume", clipId, volume: 0.5 });
    off();
    editor.dispatch({ type: "clip.setVolume", clipId, volume: 0.6 });
    editor.undo();
    editor.redo();
    expect(heard).toEqual(["x"]);
  });
});

describe("resolve", () => {
  it("skips clips whose asset is missing, silent video, zero volume and muted tracks", () => {
    const { editor, clipId } = setup();
    const project = editor.toJSON();
    expect(audioSegments(project)).toHaveLength(1);

    const silent = structuredClone(project);
    silent.assets[0]!.hasAudio = false;
    expect(audioSegments(silent)).toEqual([]);
    expect(resolveVideoAt(silent, 0)).toHaveLength(1);

    editor.dispatch({ type: "clip.setVolume", clipId, volume: 0 });
    expect(audioSegments(editor.project)).toEqual([]);

    const orphan = structuredClone(project);
    orphan.assets = [];
    expect(audioSegments(orphan)).toEqual([]);
    expect(resolveVideoAt(orphan, 0)).toEqual([]);
  });

  it("treats fades with non-numeric params as no fade", () => {
    const { editor } = setup();
    const project = editor.toJSON();
    project.tracks[0]!.clips[0]!.effects = [{ type: "core/fade", params: { inUs: "1s" } }];
    expect(audioSegments(project)[0]).toMatchObject({ fadeInUs: 0, fadeOutUs: 0 });
  });
});

describe("time", () => {
  it("converts at the edges and rounds to whole microseconds", () => {
    expect(secondsToUs(1.5)).toBe(1_500_000);
    expect(secondsToUs(1 / 3)).toBe(333_333);
    expect(usToSeconds(2_500_000)).toBe(2.5);
  });

  it("rounds clip durations after speed", () => {
    expect(clipDurationUs({ id: "c", assetId: "a", startUs: 0, sourceInUs: 0, sourceOutUs: 1_000_000, speed: 3, volume: 1, effects: [] })).toBe(333_333);
    expect(clipDurationUs({ id: "c", assetId: "a", startUs: 0, sourceInUs: 0, sourceOutUs: 5, speed: 2, volume: 1, effects: [] })).toBe(3);
  });

  it("an empty project lasts 0", () => {
    expect(projectDurationUs(createEditor().project)).toBe(0);
  });

  it("formats hours and never goes negative", () => {
    expect(formatTimecode(3_723_004_000)).toBe("01:02:03.004");
    expect(formatTimecode(-5)).toBe("00:00:00.000");
  });
});

describe("ids", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("random ids carry the prefix and differ", () => {
    const a = randomId("clip");
    expect(a).toMatch(/^clip_[0-9a-f]{10}$/);
    expect(randomId("clip")).not.toBe(a);
  });

  it("random ids work without crypto.randomUUID", () => {
    vi.stubGlobal("crypto", {});
    expect(randomId("ast")).toMatch(/^ast_[0-9a-z]+$/);
  });

  it("sequential ids count per prefix", () => {
    const ids = sequentialIds();
    expect([ids("clip"), ids("clip"), ids("trk")]).toEqual(["clip_1", "clip_2", "trk_1"]);
  });
});

describe("renderPlan", () => {
  it("carries URIs and settings, numbers layers among video tracks only, and skips clips without an asset", () => {
    const editor = createEditor({ ids: sequentialIds() });
    editor.dispatch({ type: "asset.add", asset: video });
    editor.dispatch({ type: "asset.add", asset: { id: "ast_a", kind: "audio", name: "a.mp3", uri: "file://a.mp3", durationUs: 5_000_000 } });
    editor.dispatch({ type: "clip.add", assetId: "ast_a" });
    editor.dispatch({ type: "track.add", kind: "video" });
    editor.dispatch({ type: "clip.add", assetId: "ast_v", trackId: "trk_2", startUs: 1_000_000 });
    const plan = renderPlan(editor.project);
    expect(plan.settings).toEqual(editor.project.settings);
    expect(plan.settings.fps).not.toBe(editor.project.settings.fps);
    expect(plan.video).toEqual([
      { layer: 0, trackId: "trk_2", clipId: "clip_2", assetId: "ast_v", uri: "file://v.mp4", startUs: 1_000_000, endUs: 21_000_000, sourceInUs: 0, sourceOutUs: 20_000_000, speed: 1 },
    ]);
    expect(plan.audio.map((a) => [a.clipId, a.uri])).toEqual([
      ["clip_1", "file://a.mp3"],
      ["clip_2", "file://v.mp4"],
    ]);

    const orphan = editor.toJSON();
    orphan.assets = [];
    expect(renderPlan(orphan)).toMatchObject({ video: [], audio: [] });
  });
});
