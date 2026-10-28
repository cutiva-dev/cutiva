import { describe, expect, it } from "vitest";
import { applyCommand, createEditor, CutivaError, sequentialIds, type Asset, type Command, type Project } from "../src/index.js";

const video: Asset = { id: "ast_v", kind: "video", name: "v.mp4", uri: "file://v.mp4", durationUs: 20_000_000, hasAudio: true };
const music: Asset = { id: "ast_a", kind: "audio", name: "a.mp3", uri: "file://a.mp3", durationUs: 60_000_000 };

function setup() {
  const editor = createEditor({ ids: sequentialIds() });
  editor.dispatch({ type: "asset.add", asset: video });
  editor.dispatch({ type: "asset.add", asset: music });
  const { clipId, trackId } = editor.dispatch({ type: "clip.add", assetId: "ast_v", sourceOutUs: 10_000_000 });
  return { editor, clipId, trackId };
}

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof CutivaError ? e.code : "OTHER";
  }
  return "NONE";
};

const clips = (editor: ReturnType<typeof setup>["editor"], track = 0) =>
  editor.project.tracks[track]!.clips.map((c) => [c.id, c.startUs, c.sourceInUs, c.sourceOutUs]);

describe("asset.add and track.add", () => {
  it("adding the same asset twice keeps one copy", () => {
    const { editor } = setup();
    expect(editor.dispatch({ type: "asset.add", asset: video })).toEqual({ type: "asset.add", assetId: "ast_v" });
    expect(editor.project.assets).toHaveLength(2);
  });

  it("uses the given track id or makes one", () => {
    const { editor } = setup();
    expect(editor.dispatch({ type: "track.add", kind: "audio", trackId: "music" }).trackId).toBe("music");
    expect(editor.dispatch({ type: "track.add", kind: "video" }).trackId).toBe("trk_2");
  });

  it("mutes a track, and fails on unknown tracks", () => {
    const { editor, trackId } = setup();
    editor.dispatch({ type: "track.setMuted", trackId, muted: true });
    expect(editor.project.tracks[0]!.muted).toBe(true);
    expect(codeOf(() => editor.dispatch({ type: "track.setMuted", trackId: "nope", muted: true }))).toBe("TRACK_NOT_FOUND");
  });
});

describe("clip.add", () => {
  it("places a clip on an explicit track at an explicit start, leaving a gap", () => {
    const { editor } = setup();
    const { trackId } = editor.dispatch({ type: "track.add", kind: "audio" });
    const r = editor.dispatch({ type: "clip.add", assetId: "ast_a", trackId, startUs: 3_000_000, sourceInUs: 1_000_000, sourceOutUs: 2_000_000 });
    expect(r.trackId).toBe(trackId);
    expect(clips(editor, 1)).toEqual([[r.clipId, 3_000_000, 1_000_000, 2_000_000]]);
  });

  it("keeps clips sorted by start", () => {
    const { editor } = setup();
    editor.dispatch({ type: "clip.add", assetId: "ast_v", startUs: 15_000_000, sourceOutUs: 1_000_000, clipId: "late" });
    editor.dispatch({ type: "clip.add", assetId: "ast_v", startUs: 12_000_000, sourceOutUs: 1_000_000, clipId: "early" });
    expect(editor.project.tracks[0]!.clips.map((c) => c.id)).toEqual(["clip_1", "early", "late"]);
  });

  it("fails on unknown assets and tracks", () => {
    const { editor } = setup();
    expect(codeOf(() => editor.dispatch({ type: "clip.add", assetId: "nope" }))).toBe("ASSET_NOT_FOUND");
    expect(codeOf(() => editor.dispatch({ type: "clip.add", assetId: "ast_v", trackId: "nope" }))).toBe("TRACK_NOT_FOUND");
  });

  it("does not put audio on a video track", () => {
    const { editor, trackId } = setup();
    expect(codeOf(() => editor.dispatch({ type: "clip.add", assetId: "ast_a", trackId }))).toBe("TRACK_KIND_MISMATCH");
  });

  it("rejects non-integer or negative times", () => {
    const { editor } = setup();
    expect(codeOf(() => editor.dispatch({ type: "clip.add", assetId: "ast_v", startUs: 10_500_000.5 }))).toBe("INVALID_RANGE");
    expect(codeOf(() => editor.dispatch({ type: "clip.add", assetId: "ast_v", startUs: -1 }))).toBe("INVALID_RANGE");
    expect(codeOf(() => editor.dispatch({ type: "clip.add", assetId: "ast_v", sourceInUs: 0.5 }))).toBe("INVALID_RANGE");
    expect(codeOf(() => editor.dispatch({ type: "clip.add", assetId: "ast_v", sourceInUs: -1 }))).toBe("INVALID_RANGE");
  });

  it("rejects clips shorter than 1 ms", () => {
    const { editor } = setup();
    expect(codeOf(() => editor.dispatch({ type: "clip.add", assetId: "ast_v", sourceInUs: 0, sourceOutUs: 999 }))).toBe("INVALID_RANGE");
  });
});

describe("clip.remove", () => {
  it("without ripple leaves a gap", () => {
    const { editor, clipId } = setup();
    const { clipId: b } = editor.dispatch({ type: "clip.add", assetId: "ast_v", sourceOutUs: 2_000_000 });
    editor.dispatch({ type: "clip.remove", clipId });
    expect(clips(editor)).toEqual([[b, 10_000_000, 0, 2_000_000]]);
  });

  it("ripple only shifts clips after the removed one, on its track", () => {
    const { editor } = setup();
    const { clipId: b } = editor.dispatch({ type: "clip.add", assetId: "ast_v", sourceOutUs: 2_000_000 });
    const { clipId: c } = editor.dispatch({ type: "clip.add", assetId: "ast_v", sourceOutUs: 3_000_000 });
    const { clipId: m } = editor.dispatch({ type: "clip.add", assetId: "ast_a", startUs: 11_000_000, sourceOutUs: 1_000_000 });
    editor.dispatch({ type: "clip.remove", clipId: b, ripple: true });
    expect(clips(editor)).toEqual([
      ["clip_1", 0, 0, 10_000_000],
      [c, 10_000_000, 0, 3_000_000],
    ]);
    expect(clips(editor, 1)).toEqual([[m, 11_000_000, 0, 1_000_000]]);
  });

  it("fails on unknown clips", () => {
    const { editor } = setup();
    expect(codeOf(() => editor.dispatch({ type: "clip.remove", clipId: "nope" }))).toBe("CLIP_NOT_FOUND");
  });
});

describe("clip.split", () => {
  it("copies effects instead of sharing them", () => {
    const { editor, clipId } = setup();
    editor.dispatch({ type: "clip.setFade", clipId, inUs: 1_000_000, outUs: 0 });
    const { rightId } = editor.dispatch({ type: "clip.split", clipId, atUs: 5_000_000 });
    const [left, right] = editor.project.tracks[0]!.clips;
    expect(right!.id).toBe(rightId);
    expect(right!.effects).toEqual(left!.effects);
    expect(right!.effects[0]).not.toBe(left!.effects[0]);
  });

  it("rejects non-integer split times", () => {
    const { editor, clipId } = setup();
    expect(codeOf(() => editor.dispatch({ type: "clip.split", clipId, atUs: 5_000_000.5 }))).toBe("INVALID_RANGE");
  });
});

describe("clip.trim", () => {
  it("respects speed when trimming the head", () => {
    const { editor, clipId } = setup();
    editor.dispatch({ type: "clip.move", clipId, startUs: 4_000_000 });
    editor.dispatch({ type: "clip.setSpeed", clipId, speed: 2 });
    editor.dispatch({ type: "clip.trim", clipId, sourceInUs: 2_000_000 });
    // 2 s of source at 2x is 1 s of timeline; the right edge stays at 4 + 10/2 = 9 s.
    expect(clips(editor)).toEqual([[clipId, 5_000_000, 2_000_000, 10_000_000]]);
  });

  it("refuses to move a clip before 0", () => {
    const { editor, clipId } = setup();
    // Starts at 1 s showing source from 5 s: revealing 5 s of head would start it at -4 s.
    editor.dispatch({ type: "clip.trim", clipId, sourceInUs: 5_000_000 });
    editor.dispatch({ type: "clip.move", clipId, startUs: 1_000_000 });
    expect(codeOf(() => editor.dispatch({ type: "clip.trim", clipId, sourceInUs: 0 }))).toBe("INVALID_RANGE");
  });

  it("refuses to grow into the next clip", () => {
    const { editor, clipId } = setup();
    editor.dispatch({ type: "clip.add", assetId: "ast_v", sourceOutUs: 1_000_000 });
    expect(codeOf(() => editor.dispatch({ type: "clip.trim", clipId, sourceOutUs: 12_000_000 }))).toBe("OVERLAP");
  });

  it("refuses ranges past the asset", () => {
    const { editor, clipId } = setup();
    expect(codeOf(() => editor.dispatch({ type: "clip.trim", clipId, sourceOutUs: 21_000_000 }))).toBe("INVALID_RANGE");
  });
});

describe("clip.move", () => {
  it("moves within a track and keeps it sorted", () => {
    const { editor, clipId } = setup();
    const { clipId: b } = editor.dispatch({ type: "clip.add", assetId: "ast_v", sourceOutUs: 2_000_000 });
    editor.dispatch({ type: "clip.move", clipId, startUs: 20_000_000 });
    expect(clips(editor).map((c) => c[0])).toEqual([b, clipId]);
    expect(editor.durationUs).toBe(30_000_000);
  });

  it("moves to another track of the same kind", () => {
    const { editor, clipId } = setup();
    const { trackId } = editor.dispatch({ type: "track.add", kind: "video" });
    editor.dispatch({ type: "clip.move", clipId, startUs: 1_000_000, trackId });
    expect(editor.project.tracks[0]!.clips).toHaveLength(0);
    expect(clips(editor, 1)).toEqual([[clipId, 1_000_000, 0, 10_000_000]]);
  });

  it("refuses the wrong track kind, overlaps and bad times", () => {
    const { editor, clipId } = setup();
    const { trackId } = editor.dispatch({ type: "track.add", kind: "audio" });
    expect(codeOf(() => editor.dispatch({ type: "clip.move", clipId, startUs: 0, trackId }))).toBe("TRACK_KIND_MISMATCH");
    expect(codeOf(() => editor.dispatch({ type: "clip.move", clipId, startUs: 0, trackId: "nope" }))).toBe("TRACK_NOT_FOUND");
    editor.dispatch({ type: "clip.add", assetId: "ast_v", sourceOutUs: 2_000_000 });
    expect(codeOf(() => editor.dispatch({ type: "clip.move", clipId, startUs: 5_000_000 }))).toBe("OVERLAP");
    expect(codeOf(() => editor.dispatch({ type: "clip.move", clipId, startUs: -1 }))).toBe("INVALID_RANGE");
    expect(codeOf(() => editor.dispatch({ type: "clip.move", clipId, startUs: 1.5 }))).toBe("INVALID_RANGE");
  });

  it("moving onto its own track id is a plain move", () => {
    const { editor, clipId, trackId } = setup();
    editor.dispatch({ type: "clip.move", clipId, startUs: 2_000_000, trackId });
    expect(clips(editor)).toEqual([[clipId, 2_000_000, 0, 10_000_000]]);
  });
});

describe("clip.reorder", () => {
  it("clamps the index and closes gaps", () => {
    const { editor, clipId } = setup();
    const { clipId: b } = editor.dispatch({ type: "clip.add", assetId: "ast_v", startUs: 15_000_000, sourceOutUs: 2_000_000 });
    editor.dispatch({ type: "clip.reorder", clipId, index: 99 });
    expect(clips(editor)).toEqual([
      [b, 0, 0, 2_000_000],
      [clipId, 2_000_000, 0, 10_000_000],
    ]);
    editor.dispatch({ type: "clip.reorder", clipId, index: -5 });
    expect(clips(editor).map((c) => c[0])).toEqual([clipId, b]);
  });
});

describe("clip.setVolume, clip.setSpeed, clip.setFade", () => {
  it("accepts the edges of each range and refuses outside them", () => {
    const { editor, clipId } = setup();
    editor.dispatch({ type: "clip.setVolume", clipId, volume: 0 });
    editor.dispatch({ type: "clip.setVolume", clipId, volume: 4 });
    expect(codeOf(() => editor.dispatch({ type: "clip.setVolume", clipId, volume: 4.01 }))).toBe("INVALID_RANGE");
    expect(codeOf(() => editor.dispatch({ type: "clip.setVolume", clipId, volume: Number.NaN }))).toBe("INVALID_RANGE");
    editor.dispatch({ type: "clip.setSpeed", clipId, speed: 16 });
    editor.dispatch({ type: "clip.setSpeed", clipId, speed: 0.1 });
    expect(codeOf(() => editor.dispatch({ type: "clip.setSpeed", clipId, speed: 0.09 }))).toBe("INVALID_RANGE");
    expect(codeOf(() => editor.dispatch({ type: "clip.setSpeed", clipId, speed: 17 }))).toBe("INVALID_RANGE");
  });

  it("slowing down a clip into its neighbour is refused", () => {
    const { editor, clipId } = setup();
    editor.dispatch({ type: "clip.add", assetId: "ast_v", sourceOutUs: 1_000_000 });
    expect(codeOf(() => editor.dispatch({ type: "clip.setSpeed", clipId, speed: 0.5 }))).toBe("OVERLAP");
  });

  it("fades must fit the clip, be whole microseconds, and zero removes them", () => {
    const { editor, clipId } = setup();
    editor.dispatch({ type: "clip.setFade", clipId, inUs: 4_000_000, outUs: 6_000_000 });
    expect(editor.project.tracks[0]!.clips[0]!.effects).toEqual([{ type: "core/fade", params: { inUs: 4_000_000, outUs: 6_000_000 } }]);
    expect(codeOf(() => editor.dispatch({ type: "clip.setFade", clipId, inUs: 5_000_000, outUs: 5_000_001 }))).toBe("INVALID_RANGE");
    expect(codeOf(() => editor.dispatch({ type: "clip.setFade", clipId, inUs: -1, outUs: 0 }))).toBe("INVALID_RANGE");
    expect(codeOf(() => editor.dispatch({ type: "clip.setFade", clipId, inUs: 0.5, outUs: 0 }))).toBe("INVALID_RANGE");
    editor.dispatch({ type: "clip.setFade", clipId, inUs: 0, outUs: 0 });
    expect(editor.project.tracks[0]!.clips[0]!.effects).toEqual([]);
  });
});

it("applyCommand refuses unknown command types", () => {
  const project = structuredClone(setup().editor.project) as Project;
  expect(() => applyCommand(project, { type: "clip.explode" } as unknown as Command, sequentialIds())).toThrow(/Unknown command/);
});
