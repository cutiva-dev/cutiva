import { describe, expect, it } from "vitest";
import {
  autoReframe,
  clipCropKeys,
  createEditor,
  cropAt,
  cropRect,
  CutivaError,
  detectCuts,
  normalizeReframeKeys,
  normalizeReframeParams,
  normalizeReframeTrack,
  parseProject,
  reframeKeys,
  reframeTrack,
  renderPlan,
  resolveVideoAt,
  sequentialIds,
  type Asset,
  type AutoReframeInput,
  type FaceObservation,
  type FrameObservation,
} from "../src/index.js";

const wide: Asset = { id: "ast_w", kind: "video", name: "w.mp4", uri: "file://w.mp4", durationUs: 10_000_000, width: 1920, height: 1080, hasAudio: true };
const unsized: Asset = { id: "ast_u", kind: "video", name: "u.mp4", uri: "file://u.mp4", durationUs: 10_000_000 };
const music: Asset = { id: "ast_a", kind: "audio", name: "a.mp3", uri: "file://a.mp3", durationUs: 10_000_000 };

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof CutivaError ? e.code : "OTHER";
  }
  return "NONE";
};

function setup() {
  const editor = createEditor({ ids: sequentialIds(), settings: { width: 1080, height: 1920 } });
  for (const asset of [wide, unsized, music]) editor.dispatch({ type: "asset.add", asset });
  const { clipId } = editor.dispatch({ type: "clip.add", assetId: "ast_w" });
  return { editor, clipId };
}

describe("reframe keys", () => {
  it("validates and copies keys", () => {
    expect(normalizeReframeKeys([{ atUs: 0, x: 1, y: 2, h: 3, cut: false }, { atUs: 5, x: 1, y: 2, h: 3, cut: true }])).toEqual([
      { atUs: 0, x: 1, y: 2, h: 3 },
      { atUs: 5, x: 1, y: 2, h: 3, cut: true },
    ]);
    for (const bad of [
      "nope",
      [null],
      [{ atUs: 0.5, x: 0, y: 0, h: 1 }],
      [{ atUs: 0, x: -1, y: 0, h: 1 }],
      [{ atUs: 0, x: 0, y: 0, h: 0 }],
      [{ atUs: 0, x: 0, y: 0, h: 1, cut: "yes" }],
      [{ atUs: 5, x: 0, y: 0, h: 1 }, { atUs: 5, x: 0, y: 0, h: 1 }],
    ]) {
      expect(codeOf(() => normalizeReframeKeys(bad))).toBe("INVALID_RANGE");
    }
  });

  it("fits the window inside narrow sources", () => {
    // 100x1000 source into 16:9: the tallest 16:9 window that fits is 56 px tall.
    expect(cropRect({ atUs: 0, x: 50, y: 500, h: 1000 }, 100, 1000, 1920, 1080)).toEqual({ x: 0, y: 472, w: 100, h: 56 });
  });

  it("uses the first key before it starts", () => {
    const keys = [{ atUs: 1000, rect: { x: 1, y: 2, w: 3, h: 4 }, cut: false }];
    expect(cropAt(keys, 0)).toEqual({ x: 1, y: 2, w: 3, h: 4 });
  });

  it("needs the asset's size", () => {
    const clip = { id: "c", assetId: "ast_u", startUs: 0, sourceInUs: 0, sourceOutUs: 1000, speed: 1, volume: 1, effects: [{ type: "core/reframe", params: { keys: [{ atUs: 0, x: 0, y: 0, h: 1 }] } }] };
    expect(clipCropKeys(clip, unsized, { width: 1080, height: 1920, fps: { num: 30, den: 1 }, sampleRate: 48000 })).toBeNull();
    expect(reframeKeys({ ...clip, effects: [{ type: "core/reframe", params: { keys: [] } }] })).toBeNull();
  });
});

describe("clip.setReframe and project.setSize", () => {
  it("sets, replaces and removes the reframe as undoable steps", () => {
    const { editor, clipId } = setup();
    editor.dispatch({ type: "clip.setReframe", clipId, keys: [{ atUs: 0, x: 480, y: 540, h: 1080 }] });
    expect(resolveVideoAt(editor.project, 0)[0]!.crop).toEqual({ x: 176, y: 0, w: 608, h: 1080 });
    editor.dispatch({ type: "clip.setReframe", clipId, keys: [{ atUs: 0, x: 1440, y: 540, h: 1080 }] });
    expect(editor.project.tracks[0]!.clips[0]!.effects.filter((e) => e.type === "core/reframe")).toHaveLength(1);
    editor.dispatch({ type: "clip.setReframe", clipId, keys: [] });
    expect(resolveVideoAt(editor.project, 0)[0]!.crop).toBeUndefined();
    expect(renderPlan(editor.project).video[0]!.crop).toBeUndefined();
    editor.undo();
    expect(resolveVideoAt(editor.project, 0)[0]!.crop!.x).toBe(1136);
  });

  it("keeps the framing on both halves of a split, because keys use source time", () => {
    const { editor, clipId } = setup();
    editor.dispatch({ type: "clip.setReframe", clipId, keys: [{ atUs: 0, x: 480, y: 540, h: 1080 }, { atUs: 5_000_000, x: 1440, y: 540, h: 1080, cut: true }] });
    editor.dispatch({ type: "clip.split", clipId, atUs: 4_000_000 });
    expect(resolveVideoAt(editor.project, 4_500_000)[0]!.crop!.x).toBe(176);
    expect(resolveVideoAt(editor.project, 6_000_000)[0]!.crop!.x).toBe(1136);
    expect(renderPlan(editor.project).video.map((v) => v.crop!.length)).toEqual([2, 2]);
    // A half that starts after the last key only needs that key.
    const right = editor.project.tracks[0]!.clips[1]!.id;
    editor.dispatch({ type: "clip.split", clipId: right, atUs: 7_000_000 });
    expect(renderPlan(editor.project).video[2]!.crop).toEqual([{ atUs: 5_000_000, rect: { x: 1136, y: 0, w: 608, h: 1080 }, cut: true }]);
  });

  it("rejects audio clips, unsized assets and bad keys", () => {
    const { editor, clipId } = setup();
    const audio = editor.dispatch({ type: "clip.add", assetId: "ast_a" }).clipId;
    const plain = editor.dispatch({ type: "clip.add", assetId: "ast_u" }).clipId;
    const key = { atUs: 0, x: 0, y: 0, h: 1 };
    expect(codeOf(() => editor.dispatch({ type: "clip.setReframe", clipId: audio, keys: [key] }))).toBe("TRACK_KIND_MISMATCH");
    expect(codeOf(() => editor.dispatch({ type: "clip.setReframe", clipId: plain, keys: [key] }))).toBe("ASSET_SIZE_UNKNOWN");
    expect(codeOf(() => editor.dispatch({ type: "clip.setReframe", clipId: plain, keys: [] }))).toBe("NONE");
    expect(codeOf(() => editor.dispatch({ type: "clip.setReframe", clipId, keys: [{ ...key, h: 0 }] }))).toBe("INVALID_RANGE");
    expect(codeOf(() => editor.dispatch({ type: "clip.setReframe", clipId: "nope", keys: [] }))).toBe("CLIP_NOT_FOUND");
  });

  it("changes the output size, which reshapes the window", () => {
    const { editor, clipId } = setup();
    editor.dispatch({ type: "clip.setReframe", clipId, keys: [{ atUs: 0, x: 960, y: 540, h: 1080 }] });
    editor.dispatch({ type: "project.setSize", width: 1080, height: 1080 });
    expect(editor.project.settings).toMatchObject({ width: 1080, height: 1080 });
    expect(resolveVideoAt(editor.project, 0)[0]!.crop).toEqual({ x: 420, y: 0, w: 1080, h: 1080 });
    for (const [width, height] of [[1, 100], [100, 2.5]]) {
      expect(codeOf(() => editor.dispatch({ type: "project.setSize", width: width!, height: height! }))).toBe("INVALID_RANGE");
    }
  });

  it("parses reframes and rejects broken ones", () => {
    const { editor, clipId } = setup();
    editor.dispatch({ type: "clip.setReframe", clipId, keys: [{ atUs: 0, x: 480, y: 540, h: 1080, cut: true }] });
    const json = editor.toJSON();
    expect(parseProject(JSON.stringify(json))).toEqual(json);

    const broken = structuredClone(json);
    (broken.tracks[0]!.clips[0]!.effects[0]!.params as { keys: unknown }).keys = [{ atUs: -1, x: 0, y: 0, h: 1 }];
    expect(codeOf(() => parseProject(broken))).toBe("INVALID_PROJECT");

    const onAudio = structuredClone(json);
    onAudio.tracks.push({ id: "ta", kind: "audio", muted: false, clips: [{ id: "ca", assetId: "ast_a", startUs: 0, sourceInUs: 0, sourceOutUs: 1000, speed: 1, volume: 1, effects: [{ type: "core/reframe", params: { keys: [] } }] }] });
    expect(codeOf(() => parseProject(onAudio))).toBe("INVALID_PROJECT");
  });
});

const face = (cx: number, mouth = 0, size = 200): FaceObservation => ({ x: cx - size / 2, y: 300, w: size, h: size, mouth });
const base = { sourceWidth: 1920, sourceHeight: 1080, outputWidth: 1080, outputHeight: 1920 };
/** `n` frames 200 ms apart, built by `fn(index)`. */
const frames = (n: number, fn: (i: number) => Omit<FrameObservation, "atUs">, from = 0): FrameObservation[] =>
  Array.from({ length: n }, (_, i) => ({ atUs: from + i * 200_000, ...fn(i) }));

describe("autoReframe", () => {
  it("validates its input", () => {
    const ok: AutoReframeInput = { ...base, durationUs: 1_000_000, frames: [] };
    for (const bad of [
      { ...ok, sourceWidth: 0 },
      { ...ok, durationUs: 0 },
      { ...ok, zoom: 0.5 },
      { ...ok, minHoldUs: -1 },
      { ...ok, frames: [{ atUs: 5, faces: [] }, { atUs: 5, faces: [] }] },
      { ...ok, cuts: [1.5] },
    ]) {
      expect(codeOf(() => autoReframe(bad))).toBe("INVALID_RANGE");
    }
  });

  it("centres shots without faces and starts each shot with a cut", () => {
    const result = autoReframe({
      ...base,
      durationUs: 4_000_000,
      cuts: [2_000_000, 2_000_000, 0, 9_000_000],
      frames: frames(20, (i) => ({ faces: i < 10 ? [] : [face(1440)] })),
    });
    expect(result.shotStartsUs).toEqual([0, 2_000_000]);
    expect(result.keys).toEqual([
      { atUs: 0, x: 960, y: 540, h: 1080, cut: true },
      { atUs: 2_000_000, x: 1440, y: 562, h: 1080, cut: true },
    ]);
    expect(result.people.map((p) => [p.id, p.speakingUs])).toEqual([["s1p0", 2_000_000]]);
  });

  it("holds the speaker through short interruptions and silence", () => {
    // A talks, B blurts for 0.4 s, A talks again; then B talks while the audio says it's silent.
    const talking = (i: number, from: number, to: number) => (i >= from && i < to ? i % 2 : 0);
    const result = autoReframe({
      ...base,
      durationUs: 8_000_000,
      frames: frames(40, (i) => ({
        faces: [face(480, i < 10 || (i >= 12 && i < 25) ? i % 2 : 0), face(1440, talking(i, 10, 12) + talking(i, 25, 40))],
        voice: i >= 25 ? 0 : 1,
      })),
    });
    expect(result.keys).toEqual([{ atUs: 0, x: 480, y: 562, h: 1080, cut: true }]);
    expect(result.people.map((p) => p.speakingUs)).toEqual([8_000_000, 0]);
  });

  it("folds a short first run into the next one", () => {
    const result = autoReframe({
      ...base,
      durationUs: 4_000_000,
      frames: frames(20, (i) => ({ faces: [face(480, i < 3 ? i % 2 : 0), face(1440, i >= 3 ? i % 2 : 0)] })),
    });
    expect(result.keys).toEqual([{ atUs: 0, x: 1440, y: 562, h: 1080, cut: true }]);
  });

  it("frames the most visible person when nobody talks, and zooms in", () => {
    const result = autoReframe({ ...base, zoom: 2, durationUs: 2_000_000, frames: frames(10, () => ({ faces: [face(480, 0, 100), face(1440, 0, 300)] })) });
    expect(result.keys).toEqual([{ atUs: 0, x: 1440, y: 531, h: 540, cut: true }]);
  });

  it("keeps the longest track when every face is brief", () => {
    const result = autoReframe({
      ...base,
      durationUs: 4_000_000,
      frames: frames(20, (i) => ({ faces: i === 3 ? [face(480)] : i === 8 || i === 9 ? [face(1440)] : [] })),
    });
    expect(result.people.map((p) => p.face.atUs)).toEqual([1_600_000]);
    expect(result.keys[0]).toMatchObject({ atUs: 0, x: 1440 });
  });

  it("finds a speaker who is out of sight when their run starts", () => {
    // B talks from frame 10 but its first sighting in a smoothing window is frame 13 (0.6 s later).
    const result = autoReframe({
      ...base,
      durationUs: 6_000_000,
      minHoldUs: 0,
      frames: frames(30, (i) => ({
        faces: [face(480, i < 10 ? i % 2 : 0), ...(i < 3 || i >= 16 ? [face(1440, i >= 16 ? i % 2 : 0)] : [])],
      })),
    });
    expect(result.keys.map((k) => [k.x, k.cut === true])).toEqual([
      [480, true],
      [1440, true],
    ]);
  });
});

describe("detectCuts", () => {
  it("handles empty input, blank frames and mismatched bins", () => {
    expect(detectCuts([])).toEqual([]);
    expect(detectCuts([{ atUs: 0, bins: [0, 0] }, { atUs: 2_000_000, bins: [0, 0] }])).toEqual([]);
    expect(detectCuts([{ atUs: 0, bins: [1, 0] }, { atUs: 100, bins: [0, 1] }], { minShotUs: 0, threshold: 1 })).toEqual([100]);
    expect(codeOf(() => detectCuts([{ atUs: 0, bins: [1] }, { atUs: 1, bins: [1, 2] }]))).toBe("INVALID_RANGE");
  });
});

describe("reframe track in the project (ADR 0006)", () => {
  const track = {
    version: 1,
    style: 50,
    maxUpscalePct: 200,
    zoomPct: 100,
    safeZone: "none",
    activeArea: { x: 240, y: 0, w: 1440, h: 1080 },
    people: [
      { id: "p1", label: "Ana", kind: "face", priority: false, neverFocus: false, merged: ["p3"] },
      { id: "p2", label: "Voice", kind: "voice", priority: false, neverFocus: false },
    ],
    segments: [
      { id: "s1", startUs: 0, endUs: 1_000_000, speakers: ["p1"], layout: "auto", focus: [], resolved: "single", locked: false, reason: "lips+voice" },
      { id: "s2", startUs: 1_000_000, endUs: 2_000_000, speakers: ["p1"], layout: "single", focus: ["p1"], resolved: "single", locked: true, reason: "user", window: { x: 700, y: 540, h: 1080 } },
    ],
  } as const;
  const keys = [
    { atUs: 0, x: 500, y: 540, h: 1080, cut: true },
    { atUs: 1_000_000, x: 960, y: 540, h: 1080, cut: true, layout: "split", regions: [{ x: 500, y: 500, h: 571 }, { x: 1400, y: 500, h: 571 }] },
    { atUs: 2_000_000, x: 960, y: 540, h: 1080, cut: true, layout: "wide" },
  ];

  it("validates keys with layouts", () => {
    expect(normalizeReframeKeys(keys)).toEqual(keys);
    expect(codeOf(() => normalizeReframeKeys([{ atUs: 0, x: 1, y: 1, h: 1, layout: "grid" }]))).toBe("INVALID_RANGE");
    expect(codeOf(() => normalizeReframeKeys([{ atUs: 0, x: 1, y: 1, h: 1, layout: "split" }]))).toBe("INVALID_RANGE");
    expect(codeOf(() => normalizeReframeKeys([{ atUs: 0, x: 1, y: 1, h: 1, regions: [] }]))).toBe("INVALID_RANGE");
    expect(codeOf(() => normalizeReframeKeys([{ atUs: 0, x: 1, y: 1, h: 1, layout: "split", regions: [{ x: 1, y: 1, h: 1 }] }]))).toBe("INVALID_RANGE");
    expect(codeOf(() => normalizeReframeKeys([{ atUs: 0, x: 1, y: 1, h: 1, layout: "split", regions: [{ x: 1, y: 1, h: 0 }, { x: 1, y: 1, h: 1 }] }]))).toBe("INVALID_RANGE");
  });

  it("validates a track", () => {
    expect(normalizeReframeTrack(track)).toEqual(track);
    const bad = (patch: Record<string, unknown>) => codeOf(() => normalizeReframeTrack({ ...track, ...patch }));
    const seg = (patch: Record<string, unknown>) => bad({ segments: [{ ...track.segments[0], ...patch }] });
    const person = (patch: Record<string, unknown>) => bad({ people: [{ ...track.people[0], ...patch }], segments: [] });
    expect(codeOf(() => normalizeReframeTrack(null))).toBe("INVALID_RANGE");
    expect(codeOf(() => normalizeReframeTrack([]))).toBe("INVALID_RANGE");
    for (const patch of [{ version: 2 }, { style: 101 }, { style: 1.5 }, { maxUpscalePct: 99 }, { zoomPct: 1001 }, { safeZone: "tiktok" }, { activeArea: { x: 0, y: 0, w: 0, h: 1 } }, { activeArea: null }, { people: {} }, { segments: {} }]) {
      expect(bad(patch), JSON.stringify(patch)).toBe("INVALID_RANGE");
    }
    for (const patch of [{ id: "x1" }, { label: "" }, { kind: "robot" }, { priority: "yes" }, { merged: ["p1"] }, { merged: "p3" }]) expect(person(patch), JSON.stringify(patch)).toBe("INVALID_RANGE");
    expect(bad({ people: [track.people[0], track.people[0]], segments: [] })).toBe("INVALID_RANGE");
    expect(bad({ people: [null], segments: [] })).toBe("INVALID_RANGE");
    expect(bad({ people: [track.people[0], { ...track.people[1], merged: ["p3"] }], segments: [] })).toBe("INVALID_RANGE");
    for (const patch of [{ id: "t1" }, { startUs: 5, endUs: 5 }, { layout: "grid" }, { resolved: "auto" }, { reason: "magic" }, { locked: 1 }, { focus: ["p9"] }, { speakers: ["p1", "p1"] }, { focus: ["p1", "p2", "p1"] }, { window: { x: 1, y: 1, h: 1 } }]) {
      expect(seg(patch), JSON.stringify(patch)).toBe("INVALID_RANGE");
    }
    expect(bad({ segments: [null] })).toBe("INVALID_RANGE");
    expect(bad({ segments: [track.segments[1], track.segments[0]] })).toBe("INVALID_RANGE");
    expect(bad({ segments: [track.segments[0], { ...track.segments[1], id: "s1" }] })).toBe("INVALID_RANGE");
    const { activeArea: _, ...noArea } = track;
    expect(normalizeReframeTrack(noArea)).toEqual(noArea);
  });

  it("checks the active area against the asset", () => {
    expect(codeOf(() => normalizeReframeParams({ keys, track: { ...track, activeArea: { x: 1000, y: 0, w: 1440, h: 1080 } } }, wide))).toBe("INVALID_RANGE");
    expect(normalizeReframeParams({ keys }, wide)).toEqual({ keys });
    expect(normalizeReframeParams({ keys, track }).track).toEqual(track);
  });

  it("stores, keeps and removes the track with clip.setReframe, and saves it in the project", () => {
    const { editor, clipId } = setup();
    editor.dispatch({ type: "clip.setReframe", clipId, keys, track: track as never });
    const clip = () => editor.project.tracks[0]!.clips[0]!;
    expect(reframeTrack(clip())).toEqual(track);
    // Keys alone keep the track.
    editor.dispatch({ type: "clip.setReframe", clipId, keys: [keys[0]!] });
    expect(reframeTrack(clip())).toEqual(track);
    // The active area keeps windows inside it: x 500 is pushed to 240 + 304.
    const [first] = clipCropKeys(clip(), wide, editor.project.settings)!;
    expect(first!.rect).toEqual({ x: 240, y: 0, w: 608, h: 1080 });
    // Save and open: the track survives.
    const reopened = parseProject(JSON.parse(JSON.stringify(editor.toJSON())));
    expect(reframeTrack(reopened.tracks[0]!.clips[0]!)).toEqual(track);
    editor.dispatch({ type: "clip.setReframe", clipId, keys: [keys[0]!], track: null });
    expect(reframeTrack(clip())).toBeNull();
    editor.undo();
    expect(reframeTrack(clip())).toEqual(track);
    expect(codeOf(() => editor.dispatch({ type: "clip.setReframe", clipId, keys, track: { ...track, version: 9 } as never }))).toBe("INVALID_RANGE");
  });

  it("refuses a broken track when opening a project", () => {
    const { editor, clipId } = setup();
    editor.dispatch({ type: "clip.setReframe", clipId, keys, track: track as never });
    const json = JSON.parse(JSON.stringify(editor.toJSON()));
    json.tracks[0].clips[0].effects[0].params.track.segments[0].reason = "magic";
    expect(codeOf(() => parseProject(json))).toBe("INVALID_PROJECT");
  });

  it("clamps crops inside an active area", () => {
    const area = { x: 240, y: 0, w: 1440, h: 1080 };
    expect(cropRect({ x: 1700, y: 540, h: 2000 }, 1920, 1080, 1080, 1920, area)).toEqual({ x: 1072, y: 0, w: 608, h: 1080 });
    expect(cropRect({ x: 960, y: 540, h: 1080 }, 1920, 1080, 1080, 1080, area)).toEqual({ x: 420, y: 0, w: 1080, h: 1080 });
  });
});
