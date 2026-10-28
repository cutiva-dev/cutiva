import { describe, expect, it } from "vitest";
import {
  audioSegments,
  createEditor,
  CutivaError,
  formatTimecode,
  parseProject,
  resolveVideoAt,
  sequentialIds,
  type Asset,
} from "../src/index.js";

const video: Asset = { id: "ast_v", kind: "video", name: "intro.mp4", uri: "file://intro.mp4", durationUs: 20_000_000, hasAudio: true };
const music: Asset = { id: "ast_a", kind: "audio", name: "music.mp3", uri: "file://music.mp3", durationUs: 60_000_000 };

function setup() {
  const editor = createEditor({ ids: sequentialIds(), settings: { width: 1280, height: 720 } });
  editor.dispatch({ type: "asset.add", asset: video });
  editor.dispatch({ type: "asset.add", asset: music });
  const { clipId, trackId } = editor.dispatch({ type: "clip.add", assetId: "ast_v" });
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

describe("clip.add", () => {
  it("creates a matching track automatically and appends clips back to back", () => {
    const { editor } = setup();
    editor.dispatch({ type: "clip.add", assetId: "ast_v", sourceInUs: 0, sourceOutUs: 5_000_000 });
    const track = editor.project.tracks[0]!;
    expect(track.kind).toBe("video");
    expect(track.clips.map((c) => c.startUs)).toEqual([0, 20_000_000]);
    expect(editor.durationUs).toBe(25_000_000);
  });

  it("rejects ranges outside the asset", () => {
    const { editor } = setup();
    expect(codeOf(() => editor.dispatch({ type: "clip.add", assetId: "ast_v", sourceOutUs: 99_000_000 }))).toBe("INVALID_RANGE");
  });

  it("rejects overlaps and leaves state untouched", () => {
    const { editor } = setup();
    const before = editor.project;
    expect(codeOf(() => editor.dispatch({ type: "clip.add", assetId: "ast_v", startUs: 1_000_000 }))).toBe("OVERLAP");
    expect(editor.project).toBe(before);
  });

  it("does not put video on an audio track", () => {
    const { editor } = setup();
    const { trackId } = editor.dispatch({ type: "track.add", kind: "audio" });
    expect(codeOf(() => editor.dispatch({ type: "clip.add", assetId: "ast_v", trackId }))).toBe("TRACK_KIND_MISMATCH");
  });
});

describe("clip.split", () => {
  it("splits at a timeline time and keeps source continuity", () => {
    const { editor, clipId } = setup();
    const { leftId, rightId } = editor.dispatch({ type: "clip.split", clipId, atUs: 12_000_000 });
    const [left, right] = editor.project.tracks[0]!.clips;
    expect(left!.id).toBe(leftId);
    expect(right!.id).toBe(rightId);
    expect(left!.sourceOutUs).toBe(12_000_000);
    expect(right!.sourceInUs).toBe(12_000_000);
    expect(right!.startUs).toBe(12_000_000);
    expect(editor.durationUs).toBe(20_000_000);
  });

  it("respects speed when mapping to source time", () => {
    const { editor, clipId } = setup();
    editor.dispatch({ type: "clip.setSpeed", clipId, speed: 2 });
    expect(editor.durationUs).toBe(10_000_000);
    editor.dispatch({ type: "clip.split", clipId, atUs: 4_000_000 });
    expect(editor.project.tracks[0]!.clips[1]!.sourceInUs).toBe(8_000_000);
  });

  it("refuses split points on the edges", () => {
    const { editor, clipId } = setup();
    expect(codeOf(() => editor.dispatch({ type: "clip.split", clipId, atUs: 0 }))).toBe("INVALID_RANGE");
    expect(codeOf(() => editor.dispatch({ type: "clip.split", clipId, atUs: 20_000_000 }))).toBe("INVALID_RANGE");
  });
});

describe("clip.trim", () => {
  it("trimming the head keeps the right edge in place", () => {
    const { editor, clipId } = setup();
    editor.dispatch({ type: "clip.trim", clipId, sourceInUs: 2_000_000 });
    const clip = editor.project.tracks[0]!.clips[0]!;
    expect(clip.startUs).toBe(2_000_000);
    expect(clip.sourceInUs).toBe(2_000_000);
  });

  it("trimming the tail shortens the clip", () => {
    const { editor, clipId } = setup();
    editor.dispatch({ type: "clip.trim", clipId, sourceOutUs: 8_000_000 });
    expect(editor.durationUs).toBe(8_000_000);
  });
});

describe("clip.reorder and clip.remove", () => {
  it("reorders magnetically with no gaps", () => {
    const { editor } = setup();
    const { clipId: b } = editor.dispatch({ type: "clip.add", assetId: "ast_v", sourceOutUs: 3_000_000 });
    editor.dispatch({ type: "clip.reorder", clipId: b, index: 0 });
    const clips = editor.project.tracks[0]!.clips;
    expect(clips[0]!.id).toBe(b);
    expect(clips.map((c) => c.startUs)).toEqual([0, 3_000_000]);
  });

  it("ripple delete closes the gap", () => {
    const { editor, clipId } = setup();
    editor.dispatch({ type: "clip.add", assetId: "ast_v", sourceOutUs: 3_000_000 });
    editor.dispatch({ type: "clip.remove", clipId, ripple: true });
    expect(editor.project.tracks[0]!.clips[0]!.startUs).toBe(0);
  });
});

describe("history", () => {
  it("undo and redo restore exact states", () => {
    const { editor, clipId } = setup();
    const before = editor.project;
    editor.dispatch({ type: "clip.split", clipId, atUs: 5_000_000 });
    const after = editor.project;
    expect(editor.undo()).toBe(true);
    expect(editor.project).toBe(before);
    expect(editor.redo()).toBe(true);
    expect(editor.project).toBe(after);
  });

  it("a new edit clears the redo stack", () => {
    const { editor, clipId } = setup();
    editor.dispatch({ type: "clip.split", clipId, atUs: 5_000_000 });
    editor.undo();
    editor.dispatch({ type: "clip.setVolume", clipId, volume: 0.5 });
    expect(editor.canRedo).toBe(false);
  });

  it("batch is one undo step and atomic", () => {
    const { editor, clipId } = setup();
    const before = editor.project;
    expect(() =>
      editor.batch([
        { type: "clip.setVolume", clipId, volume: 0.2 },
        { type: "clip.split", clipId, atUs: 0 },
      ]),
    ).toThrow(CutivaError);
    expect(editor.project).toBe(before);
    editor.batch([
      { type: "clip.setVolume", clipId, volume: 0.2 },
      { type: "clip.split", clipId, atUs: 10_000_000 },
    ]);
    editor.undo();
    expect(editor.project).toBe(before);
  });

  it("notifies subscribers", () => {
    const { editor, clipId } = setup();
    const causes: string[] = [];
    editor.subscribe((c) => causes.push(typeof c.cause === "string" ? c.cause : c.cause.type));
    editor.dispatch({ type: "clip.setVolume", clipId, volume: 0.5 });
    editor.undo();
    expect(causes).toEqual(["clip.setVolume", "undo"]);
  });
});

describe("CPF serialization", () => {
  it("round-trips through JSON", () => {
    const { editor, clipId } = setup();
    editor.dispatch({ type: "clip.split", clipId, atUs: 5_000_000 });
    editor.dispatch({ type: "clip.add", assetId: "ast_a", sourceOutUs: 10_000_000 });
    const json = JSON.stringify(editor.toJSON());
    const reopened = createEditor({ project: json });
    expect(reopened.project).toEqual(editor.project);
  });

  it("rejects invalid documents with a path", () => {
    expect(() => parseProject({ version: "0.1.0", id: "p", settings: {}, assets: [], tracks: [] })).toThrow(/settings/);
    expect(codeOf(() => parseProject({ version: "9.9.9" }))).toBe("UNSUPPORTED_VERSION");
  });

  it("rejects clips that point to missing assets", () => {
    const doc = createEditor({ ids: sequentialIds() }).toJSON();
    doc.tracks.push({ id: "t", kind: "video", muted: false, clips: [{ id: "c", assetId: "nope", startUs: 0, sourceInUs: 0, sourceOutUs: 10, speed: 1, volume: 1, effects: [] }] });
    expect(codeOf(() => parseProject(doc))).toBe("INVALID_PROJECT");
  });
});

describe("resolve", () => {
  it("returns the source time to draw at a timeline time", () => {
    const { editor, clipId } = setup();
    editor.dispatch({ type: "clip.trim", clipId, sourceInUs: 2_000_000 });
    const layers = resolveVideoAt(editor.project, 5_000_000);
    expect(layers).toHaveLength(1);
    expect(layers[0]!.sourceTimeUs).toBe(5_000_000);
    expect(resolveVideoAt(editor.project, 1_000_000)).toHaveLength(0);
  });

  it("lists audio from audio tracks and video clips, skipping muted tracks", () => {
    const { editor, clipId } = setup();
    const { trackId } = editor.dispatch({ type: "clip.add", assetId: "ast_a", sourceOutUs: 10_000_000 });
    editor.dispatch({ type: "clip.setFade", clipId, inUs: 500_000, outUs: 1_000_000 });
    expect(audioSegments(editor.project)).toHaveLength(2);
    expect(audioSegments(editor.project)[0]!.fadeOutUs).toBe(1_000_000);
    editor.dispatch({ type: "track.setMuted", trackId, muted: true });
    expect(audioSegments(editor.project)).toHaveLength(1);
  });
});

it("formats timecodes", () => {
  expect(formatTimecode(62_500_000)).toBe("00:01:02.500");
});
