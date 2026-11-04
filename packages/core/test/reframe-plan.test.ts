import { describe, expect, it } from "vitest";
import {
  editReframeTrack,
  planReframe,
  reframeStyle,
  type PlanFace,
  type PlanFrame,
  type ReframePlanInput,
  type ReframeTrack,
  type TrackSegment,
} from "../src/index.js";

// One rule per test, on synthetic observations (docs/reframe-mvp-spec.md, edge cases marked MVP).

const STEP = 200_000;
/** Mouth that alternates 0.1 / 0.3 (talking) or stays at 0.1 (quiet). */
const talk = (i: number) => (i % 2 ? 0.3 : 0.1);
const face = (x: number, mouth: number | null, extra: Partial<PlanFace> = {}): PlanFace => ({ x, y: 300, w: 200, h: 200, mouth, ...extra });
const frames = (count: number, make: (i: number) => Omit<PlanFrame, "atUs">): PlanFrame[] => Array.from({ length: count }, (_, i) => ({ atUs: i * STEP, ...make(i) }));
const input = (fs: PlanFrame[], extra: Partial<ReframePlanInput> = {}): ReframePlanInput => ({
  sourceWidth: 1920,
  sourceHeight: 1080,
  outputWidth: 1080,
  outputHeight: 1920,
  durationUs: fs.length * STEP,
  frames: fs,
  ...extra,
});
const brief = (segments: TrackSegment[]) => segments.map((s) => [s.startUs, s.endUs, s.speakers.join("+"), s.resolved, s.reason]);
const baseTrack = (extra: Partial<ReframeTrack> = {}): ReframeTrack => ({ version: 1, style: 50, maxUpscalePct: 200, zoomPct: 100, safeZone: "none", people: [], segments: [], ...extra });
const A = 400;
const B = 1300;

describe("reframeStyle", () => {
  it("gives the spec's presets and interpolates between them", () => {
    expect(reframeStyle(0)).toEqual({ holdUs: 1_600_000, minSegmentUs: 1_500_000, deadZone: 0.06, minCutoff: 0.3, maxSpeed: 0.15 });
    expect(reframeStyle(50)).toEqual({ holdUs: 1_000_000, minSegmentUs: 1_000_000, deadZone: 0.04, minCutoff: 0.8, maxSpeed: 0.25 });
    expect(reframeStyle(100)).toEqual({ holdUs: 400_000, minSegmentUs: 600_000, deadZone: 0.02, minCutoff: 1.5, maxSpeed: 0.4 });
    const q = reframeStyle(25);
    expect([q.holdUs, q.minSegmentUs]).toEqual([1_300_000, 1_250_000]);
    expect(reframeStyle(75).holdUs).toBe(700_000);
  });
});

describe("planReframe input", () => {
  it("refuses bad sizes, times and observations", () => {
    const ok = input(frames(2, () => ({ faces: [] })));
    expect(() => planReframe({ ...ok, sourceWidth: 0 })).toThrow("Sizes");
    expect(() => planReframe({ ...ok, durationUs: 0 })).toThrow("durationUs");
    expect(() => planReframe({ ...ok, frames: [{ atUs: 5, faces: [] }, { atUs: 5, faces: [] }] })).toThrow("increasing");
    expect(() => planReframe({ ...ok, frames: [{ atUs: ok.durationUs, faces: [] }] })).toThrow("before durationUs");
    expect(() => planReframe({ ...ok, frames: [{ atUs: 0, faces: [], voice: 2 }] })).toThrow("voice");
    expect(() => planReframe({ ...ok, frames: [{ atUs: 0, faces: [], pan: -3 }] })).toThrow("pan");
    expect(() => planReframe({ ...ok, frames: [{ atUs: 0, faces: [face(0, 0, { w: 0 })] }] })).toThrow("positive");
    expect(() => planReframe({ ...ok, frames: [{ atUs: 0, faces: [face(0, 7)] }] })).toThrow("mouth");
    expect(() => planReframe({ ...ok, frames: [{ atUs: 0, faces: [face(0, 0, { conf: 9 })] }] })).toThrow("conf");
    expect(() => planReframe({ ...ok, cuts: [0.5] })).toThrow("Cuts");
    expect(() => planReframe({ ...ok, activeArea: { x: 1000, y: 0, w: 1000, h: 1080 } })).toThrow("activeArea");
    expect(() => planReframe({ ...ok, minShotUs: -1 })).toThrow("minShotUs");
    expect(() => planReframe({ ...ok, minShotUs: 1.5 })).toThrow("minShotUs");
  });

  it("frames nothing as wide no-face", () => {
    const r = planReframe(input([], { durationUs: 1_000_000 }));
    expect(brief(r.track.segments)).toEqual([[0, 1_000_000, "", "wide", "no-face"]]);
    expect(r.keys).toEqual([{ atUs: 0, x: 960, y: 540, h: 1080, cut: true, layout: "wide" }]);
  });
});

describe("planReframe rules", () => {
  it("lips without voice don't count as talking: silence keeps the framing", () => {
    // A talks with voice for 2 s; then B's lips move with no voice (laughing): A keeps the frame.
    const fs = frames(20, (i) => ({ voice: i < 10 ? 0.5 : 0, faces: [face(A, i < 10 ? talk(i) : 0.1), face(B, i >= 10 ? talk(i) : 0.1)] }));
    expect(brief(planReframe(input(fs)).track.segments)).toEqual([[0, 4_000_000, "p1", "single", "lips+voice"]]);
  });

  it("before anyone talks, the first speaker holds the frame", () => {
    const fs = frames(20, (i) => ({ voice: i < 10 ? 0 : 0.5, faces: [face(A, 0.1), face(B, i >= 10 ? talk(i) : 0.1)] }));
    expect(brief(planReframe(input(fs)).track.segments)).toEqual([[0, 4_000_000, "p2", "single", "lips+voice"]]);
  });

  it("fills voice gaps under 300 ms and drops bursts under 250 ms", () => {
    // One silent frame (200 ms) inside A's speech is filled; a lone 200 ms burst later is dropped.
    const voice = (i: number) => (i === 5 ? 0 : i < 10 ? 0.5 : i === 15 ? 0.5 : 0);
    const fs = frames(20, (i) => ({ voice: voice(i), faces: [face(A, i < 10 ? talk(i) : 0.1), face(B, i === 15 ? 0.3 : 0.1)] }));
    expect(brief(planReframe(input(fs)).track.segments)).toEqual([[0, 4_000_000, "p1", "single", "lips+voice"]]);
  });

  it("without audio, lips decide", () => {
    const fs = frames(20, (i) => ({ faces: [face(A, i < 10 ? talk(i) : 0.1), face(B, i >= 10 ? talk(i) : 0.1)] }));
    // Lips look 500 ms each side: A's move up to frame 11, B's from frame 9 (a 600 ms overlap, kept on A);
    // from frame 12 only B's do, so B claims the frame there and wins a hold later, back-dated to 2.4 s.
    expect(brief(planReframe(input(fs)).track.segments)).toEqual([
      [0, 2_400_000, "p1", "single", "lips+voice"],
      [2_400_000, 4_000_000, "p2", "single", "lips+voice"],
    ]);
  });

  it("minShotUs raises the camera style's minimum shot; shorter shots fold into a neighbour", () => {
    // The case above: A for 2.4 s, then B for 1.6 s. The balanced style's minimum is 1 s.
    const fs = frames(20, (i) => ({ faces: [face(A, i < 10 ? talk(i) : 0.1), face(B, i >= 10 ? talk(i) : 0.1)] }));
    expect(brief(planReframe(input(fs, { minShotUs: 1_500_000 })).track.segments).map((s) => s[2])).toEqual(["p1", "p2"]);
    expect(brief(planReframe(input(fs, { minShotUs: 2_000_000 })).track.segments)).toEqual([[0, 4_000_000, "p1", "single", "lips+voice"]]);
  });

  it("a challenger keeps its claim through frames where its lips pause or nobody beats the margin", () => {
    // A talks for 2 s, then B; B's lips stop on frames 13-14 (a pause), which used to reset B's claim.
    const fs = frames(30, (i) => ({ faces: [face(A, i < 10 ? talk(i) : 0.1), face(B, i >= 10 && (i < 13 || i > 16) ? talk(i) : 0.1)] }));
    const segs = brief(planReframe(input(fs)).track.segments);
    expect(segs.map((s) => s[2])).toEqual(["p1", "p2"]);
    expect(segs[1]![0]).toBeLessThan(3_000_000);
  });

  it("a quiet current speaker loses the frame to one whose lips move more", () => {
    // Both keep moving their lips; from frame 10 B's move about twice as much (lips ~0.8 against ~0.4).
    // With continuity weighing 0.05, B's lead (~0.37) clears the 0.15 margin plus A's 0.08 continuity;
    // with the old 0.15 weight A's continuity (0.2) kept the frame.
    const fs = frames(30, (i) => ({ faces: [face(A, i % 2 ? 0.14 : 0.1), face(B, i >= 10 && i % 2 ? 0.18 : 0.1)] }));
    expect(brief(planReframe(input(fs)).track.segments).map((s) => s[2])).toEqual(["p1", "p2"]);
  });

  it("without audio or visible lips, there is no useful signal: the most visible person holds", () => {
    const fs = frames(10, () => ({ voice: 0, faces: [face(A, 0.1, { w: 150, h: 150 }), face(B, 0.1)] }));
    expect(brief(planReframe(input(fs)).track.segments)).toEqual([[0, 2_000_000, "p2", "single", "lips+voice"]]);
  });

  it("a covered mouth (null) keeps whoever already talks: voice and continuity decide", () => {
    const fs = frames(20, (i) => ({ voice: 0.5, faces: [face(A, i < 3 ? talk(i) : null), face(B, null)] }));
    expect(brief(planReframe(input(fs)).track.segments)).toEqual([[0, 4_000_000, "p1", "single", "lips+voice"]]);
  });

  it("stereo pan tells two covered mouths apart", () => {
    // Nobody's lips are visible; the voice is panned hard right from 2 s, where B sits.
    const fs = frames(30, (i) => ({ voice: 0.5, pan: i < 10 ? -0.6 : 0.6, faces: [face(A, null), face(B, null)] }));
    const r = planReframe(input(fs));
    // Expected pan: A -0.48, B 0.46. Score = (0.25 pan + 0.15 continuity) / 0.4. From 2 s, A scores 0.375
    // (pan 0) and B 0.536 (pan 0.858) > 0.375 + 0.15: B wins after the 1 s hold, back-dated to 2 s.
    expect(brief(r.track.segments)).toEqual([
      [0, 2_000_000, "p1", "single", "lips+voice"],
      [2_000_000, 6_000_000, "p2", "single", "lips+voice"],
    ]);
  });

  it("short interruptions fold into the segment around them", () => {
    // B says "uh-huh" for 0.6 s in the middle of A's turn; with a 0.4 s hold (dynamic) B wins it, then it folds back.
    const bTalks = (i: number) => i >= 10 && i < 13;
    const fs = frames(25, (i) => ({ voice: 0.5, faces: [face(A, bTalks(i) ? 0.1 : talk(i)), face(B, bTalks(i) ? talk(i) : 0.1)] }));
    const r = planReframe(input(fs, { track: baseTrack({ style: 100 }) }));
    expect(brief(r.track.segments)).toEqual([[0, 5_000_000, "p1", "single", "lips+voice"]]);
  });

  it("ignores small, unsure and out-of-area faces and keeps at most four people", () => {
    const crowd = (i: number) => [
      face(100, talk(i)),
      face(500, 0.1),
      face(900, 0.1),
      face(1300, 0.1),
      face(1700, 0.1, { w: 150, h: 150 }),
      face(800, 0.3, { y: 900, w: 30, h: 30 }), // audience: under 4% of the height
      face(1500, 0.3, { conf: 0.4 }), // unsure
    ];
    const r = planReframe(input(frames(10, (i) => ({ voice: 0.5, faces: crowd(i) }))));
    expect(r.track.people.map((p) => p.id)).toEqual(["p1", "p2", "p3", "p4"]);
    expect(brief(r.track.segments)).toEqual([[0, 2_000_000, "p1", "single", "lips+voice"]]);
  });

  it("someone who leaves for over a second comes back as a new person", () => {
    const fs = frames(30, (i) => ({ voice: 0.5, faces: i >= 10 && i < 17 ? [] : [face(A, talk(i))] }));
    const r = planReframe(input(fs));
    expect(r.track.people.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(brief(r.track.segments)).toEqual([
      [0, 2_000_000, "p1", "single", "lips+voice"],
      [2_000_000, 3_400_000, "", "wide", "no-face"],
      [3_400_000, 6_000_000, "p2", "single", "lips+voice"],
    ]);
  });

  it("fills a missed detection up to a second by interpolating the face", () => {
    // Frames 5-8 lose the face (800 ms) while it moves from x 400 to 520 (IoU 0.67): one person, and the window moves.
    const fs = frames(15, (i) => ({ voice: 0.5, faces: i >= 5 && i < 9 ? [] : [face(i < 5 ? 400 : 520, talk(i), { w: 600, h: 600 })] }));
    const r = planReframe(input(fs));
    expect(r.track.people).toHaveLength(1);
    expect(brief(r.track.segments)).toEqual([[0, 3_000_000, "p1", "single", "lips+voice"]]);
    expect(r.keys[0]!.x).toBe(700);
    expect(r.keys[r.keys.length - 1]!.x).toBeGreaterThan(760);
  });

  it("two people close together share one window instead of a split", () => {
    const fs = frames(20, (i) => ({ voice: 0.5, faces: [face(700, talk(i)), face(1000, talk(i))] }));
    const r = planReframe(input(fs));
    expect(brief(r.track.segments)).toEqual([[0, 4_000_000, "p1+p2", "single", "overlap"]]);
    // Union of both faces: x 700 to 1200, centre 950.
    expect(r.keys[0]).toEqual({ atUs: 0, x: 950, y: 540, h: 1080, cut: true });
  });

  it("a close-up wider than the window stays centred on the face, without zooming out", () => {
    const fs = frames(10, (i) => ({ voice: 0.5, faces: [face(560, talk(i), { y: 100, w: 800, h: 800 })] }));
    const r = planReframe(input(fs));
    expect(r.keys).toEqual([{ atUs: 0, x: 960, y: 540, h: 1080, cut: true }]);
  });

  it("a source narrower than the output crops in y and follows the face vertically", () => {
    // 1080x1920 to 1:1: the window is 1080 x 1080 and only moves up and down.
    const fs = frames(10, (i) => ({ voice: 0.5, faces: [face(440, talk(i), { y: 200 })] }));
    const r = planReframe(input(fs, { sourceWidth: 1080, sourceHeight: 1920, outputWidth: 1080, outputHeight: 1080 }));
    // y = 200 + 0.38 * 1080 = 610.4, inside [540, 1380].
    expect(r.keys).toEqual([{ atUs: 0, x: 540, y: 610, h: 1080, cut: true }]);
  });

  it("works on uneven frame times (variable frame rate)", () => {
    const times = [0, 150_000, 420_000, 600_000, 790_000, 1_000_000, 1_230_000, 1_400_000];
    const fs = times.map((atUs, i) => ({ atUs, voice: 0.5, faces: [face(A, talk(i))] }));
    const r = planReframe(input(fs, { durationUs: 1_600_000 }));
    expect(brief(r.track.segments)).toEqual([[0, 1_600_000, "p1", "single", "lips+voice"]]);
  });

  it("zoom makes the window smaller", () => {
    const fs = frames(10, (i) => ({ voice: 0.5, faces: [face(A, talk(i))] }));
    // 2x zoom on 1080p needs 1920 / 540 = 3.6x upscaling, so allow it.
    const r = planReframe(input(fs, { track: baseTrack({ zoomPct: 200, maxUpscalePct: 400 }) }));
    // h = floor(1080 * 100 / 200) = 540, w = round(540 * 1080 / 1920) = 304; y = 300 + 0.38 * 540 = 505.2.
    expect(r.keys).toEqual([{ atUs: 0, x: 500, y: 505, h: 540, cut: true }]);
  });

  it("priority breaks a tie between two people", () => {
    const fs = frames(10, (i) => ({ voice: 0.5, faces: [face(A, i === 0 ? 0.3 : talk(i + 1)), face(B, i === 0 ? 0.3 : talk(i + 1))] }));
    const people = [
      { id: "p1", label: "A", kind: "face" as const, priority: false, neverFocus: false },
      { id: "p2", label: "B", kind: "face" as const, priority: true, neverFocus: false },
    ];
    // Both talk for 2 s: an overlap over 1.5 s, but they sit far apart, so a split; the tie decides who is current.
    const r = planReframe(input(fs, { track: baseTrack({ people }) }));
    expect(brief(r.track.segments)).toEqual([[0, 2_000_000, "p1+p2", "split", "overlap"]]);
    // With only 1.4 s of overlap it becomes single, on the priority person.
    const short = planReframe(input(fs.slice(0, 7), { durationUs: 1_400_000, track: baseTrack({ people }) }));
    expect(brief(short.track.segments)).toEqual([[0, 1_400_000, "p2", "single", "lips+voice"]]);
  });

  it("a split that needs too much upscaling goes wide", () => {
    const fs = frames(10, (i) => ({ voice: 0.5, faces: [face(A, talk(i), { w: 60, h: 60 }), face(B, talk(i), { w: 60, h: 60 })] }));
    // Region h = round(60 / 0.35) = 171; 960 / 171 = 5.6x.
    expect(brief(planReframe(input(fs)).track.segments)).toEqual([[0, 2_000_000, "p1+p2", "wide", "low-quality"]]);
  });

  it("close people in a low-resolution source go wide too", () => {
    const fs = frames(10, (i) => ({ voice: 0.5, faces: [face(200, talk(i), { y: 100, w: 60, h: 60 }), face(300, talk(i), { y: 100, w: 60, h: 60 })] }));
    const r = planReframe(input(fs, { sourceWidth: 854, sourceHeight: 480 }));
    expect(brief(r.track.segments)).toEqual([[0, 2_000_000, "p1+p2", "wide", "low-quality"]]);
  });

  it("a never-focus person alone on screen gets a wide shot", () => {
    const fs = frames(10, () => ({ voice: 0, faces: [face(A, 0.1)] }));
    const people = [{ id: "p1", label: "Host", kind: "face" as const, priority: false, neverFocus: true }];
    expect(brief(planReframe(input(fs, { track: baseTrack({ people }) })).track.segments)).toEqual([[0, 2_000_000, "p1", "wide", "never-focus"]]);
  });

  it("merged people are one person, even across shots, and the window jumps at the cut", () => {
    const fs = frames(20, (i) => ({ voice: 0.5, faces: [face(i < 10 ? A : B, talk(i))] }));
    const first = planReframe(input(fs, { cuts: [2_000_000] }));
    expect(first.track.people.map((p) => p.id)).toEqual(["p1", "p2"]);
    const merged = editReframeTrack(first.track, { type: "merge", personId: "p2", intoId: "p1" });
    const r = planReframe(input(fs, { cuts: [2_000_000], track: merged }));
    expect(r.track.people).toEqual([{ id: "p1", label: "Speaker A", kind: "face", priority: false, neverFocus: false, merged: ["p2"] }]);
    expect(brief(r.track.segments)).toEqual([[0, 4_000_000, "p1", "single", "lips+voice"]]);
    expect(r.keys).toEqual([
      { atUs: 0, x: 500, y: 540, h: 1080, cut: true },
      { atUs: 2_000_000, x: 1400, y: 540, h: 1080, cut: true },
    ]);
  });

  it("lists where each person was seen, by time then person, with merges applied and noise dropped", () => {
    // Two people side by side; a tiny face (under 4% of the height) and an unsure one are dropped.
    const fs = frames(3, (i) => ({ voice: 0.5, faces: [face(B, talk(i)), face(A, 0.1), face(900, 0.1, { h: 20 }), face(1700, 0.1, { conf: 0.2 })] }));
    const r = planReframe(input(fs));
    const box = (personId: string, atUs: number, x: number) => ({ personId, atUs, x, y: 300, w: 200, h: 200 });
    expect(r.sightings).toEqual([box("p1", 0, A), box("p2", 0, B), box("p1", STEP, A), box("p2", STEP, B), box("p1", 2 * STEP, A), box("p2", 2 * STEP, B)]);

    const merged = planReframe(input(fs, { track: editReframeTrack(r.track, { type: "merge", personId: "p2", intoId: "p1" }) }));
    expect(merged.sightings.map((x) => [x.personId, x.atUs, x.x])).toEqual([
      ["p1", 0, A],
      ["p1", 0, B],
      ["p1", STEP, A],
      ["p1", STEP, B],
      ["p1", 2 * STEP, A],
      ["p1", 2 * STEP, B],
    ]);
    expect(planReframe(input([], { sourceWidth: 1080, sourceHeight: 1920, durationUs: 1_000_000 })).sightings).toEqual([]);
  });

  it("keeps the off-camera voice's id and anyone a locked segment still names", () => {
    const fs = frames(10, (i) => ({ voice: 0.5, faces: [face(A, 0.1)] }));
    void talk;
    const track = baseTrack({
      people: [
        { id: "p4", label: "Narrator", kind: "voice", priority: false, neverFocus: false },
        { id: "p7", label: "Gone", kind: "face", priority: false, neverFocus: false },
      ],
      segments: [{ id: "s1", startUs: 1_000_000, endUs: 3_000_000, speakers: ["p7"], layout: "wide", focus: [], resolved: "wide", locked: true, reason: "user" }],
    });
    const r = planReframe(input(fs, { durationUs: 2_000_000, track }));
    expect(r.track.people.map((p) => [p.id, p.label])).toEqual([
      ["p1", "Speaker A"],
      ["p4", "Narrator"],
      ["p7", "Gone"],
    ]);
    // The voice-only stretch is 1 s (not over 1 s), so it holds: no voice segment. The locked one is cut at the clip's end.
    expect(brief(r.track.segments)).toEqual([
      [0, 1_000_000, "p4", "wide", "voice-only"],
      [1_000_000, 2_000_000, "p7", "wide", "user"],
    ]);
  });

  it("draws locked splits, windows and segments whose person is gone", () => {
    const fs = frames(25, (i) => ({ voice: 0.5, faces: [face(A, talk(i)), face(B, 0.1)] }));
    const seg = (id: string, startUs: number, endUs: number, extra: Partial<TrackSegment>): TrackSegment => ({
      id, startUs, endUs, speakers: ["p1"], layout: "single", focus: [], resolved: "single", locked: true, reason: "user", ...extra,
    });
    const people = [
      { id: "p1", label: "A", kind: "face" as const, priority: false, neverFocus: false },
      { id: "p2", label: "B", kind: "face" as const, priority: false, neverFocus: false },
      { id: "p9", label: "Old", kind: "face" as const, priority: false, neverFocus: false },
    ];
    const track = baseTrack({
      people,
      segments: [
        seg("s1", 0, 1_000_000, { layout: "split", resolved: "split", focus: ["p1", "p2"] }),
        seg("s2", 1_000_000, 2_000_000, { window: { x: 700, y: 540, h: 1080 } }),
        seg("s3", 2_000_000, 3_000_000, { focus: ["p9"] }),
        seg("s4", 3_000_000, 4_000_000, { speakers: [], focus: [] }),
        seg("s5", 4_000_000, 5_000_000, { layout: "split", resolved: "split", focus: ["p1", "p9"] }),
      ],
    });
    const r = planReframe(input(fs, { track }));
    expect(r.keys.map((k) => [k.atUs, k.x, k.layout ?? "single"])).toEqual([
      [0, 960, "split"],
      [1_000_000, 700, "single"],
      [2_000_000, 960, "single"],
      [3_000_000, 960, "single"],
      [4_000_000, 960, "wide"],
    ]);
    expect(r.track.segments.every((s) => s.locked)).toBe(true);
  });

  it("an auto segment boxed in by locked ones too short to fold stays", () => {
    const fs = frames(15, (i) => ({ voice: 0.5, faces: [face(A, talk(i))] }));
    const lock = (id: string, startUs: number, endUs: number): TrackSegment => ({ id, startUs, endUs, speakers: ["p1"], layout: "wide", focus: [], resolved: "wide", locked: true, reason: "user" });
    const r = planReframe(input(fs, { track: baseTrack({ people: [{ id: "p1", label: "A", kind: "face", priority: false, neverFocus: false }], segments: [lock("s1", 0, 1_000_000), lock("s2", 1_400_000, 3_000_000)] }) }));
    expect(brief(r.track.segments)).toEqual([
      [0, 1_000_000, "p1", "wide", "user"],
      [1_000_000, 1_400_000, "p1", "single", "lips+voice"],
      [1_400_000, 3_000_000, "p1", "wide", "user"],
    ]);
  });

  it("at a cut, a silent new shot takes its first speaker, else its most visible person", () => {
    const fs = frames(30, (i) => ({
      voice: (i >= 10 && i < 15) || i >= 20 ? 0 : 0.5,
      faces: i < 10 ? [face(A, talk(i))] : i < 20 ? [face(B, i >= 15 ? talk(i) : 0.1)] : [face(A, 0.1), face(B, 0.1, { w: 300, h: 300 })],
    }));
    const r = planReframe(input(fs, { cuts: [2_000_000, 4_000_000], track: baseTrack({ style: 100 }) }));
    expect(brief(r.track.segments).map((s) => s.slice(0, 3))).toEqual([
      [0, 2_000_000, "p1"],
      [2_000_000, 4_000_000, "p2"],
      [4_000_000, 6_000_000, "p4"],
    ]);
  });

  it("keeps the active area from the previous track", () => {
    const fs = frames(5, (i) => ({ voice: 0.5, faces: [face(600, talk(i))] }));
    const area = { x: 240, y: 0, w: 1440, h: 1080 };
    expect(planReframe(input(fs, { track: baseTrack({ activeArea: area }) })).track.activeArea).toEqual(area);
  });

  it("passes the previous people through on an already vertical source", () => {
    const people = [{ id: "p1", label: "Host", kind: "face" as const, priority: true, neverFocus: false, merged: ["p3"] }];
    const r = planReframe(input([], { sourceWidth: 1080, sourceHeight: 1920, durationUs: 1_000_000, track: baseTrack({ people }) }));
    expect(r.passthrough).toBe(true);
    expect(r.track.people).toEqual(people);
    expect(r.track.people[0]).not.toBe(people[0]);
  });

  it("follows smoothly and never faster than the top speed", () => {
    const fs = frames(20, (i) => ({ voice: 0.5, faces: [face(400 + Math.min(i, 10) * 40, talk(i))] }));
    const { keys } = planReframe(input(fs));
    for (let k = 1; k < keys.length; k++) {
      const dt = (keys[k]!.atUs - keys[k - 1]!.atUs) / 1e6;
      expect(Math.abs(keys[k]!.x - keys[k - 1]!.x)).toBeLessThanOrEqual(Math.ceil(0.25 * 608 * dt) + 1);
    }
    // Small movements inside the dead zone don't move the window.
    const jitter = planReframe(input(frames(20, (i) => ({ voice: 0.5, faces: [face(400 + (i % 2) * 10, talk(i))] }))));
    expect(jitter.keys).toHaveLength(1);
  });
});

describe("editReframeTrack", () => {
  const track = baseTrack({
    people: [
      { id: "p1", label: "A", kind: "face", priority: false, neverFocus: false },
      { id: "p2", label: "B", kind: "face", priority: false, neverFocus: false, merged: ["p5"] },
      { id: "p3", label: "Voice", kind: "voice", priority: false, neverFocus: false },
    ],
    segments: [
      { id: "s1", startUs: 0, endUs: 1_000_000, speakers: ["p1"], layout: "auto", focus: [], resolved: "single", locked: false, reason: "lips+voice" },
      { id: "s2", startUs: 1_000_000, endUs: 2_000_000, speakers: ["p1", "p2"], layout: "auto", focus: [], resolved: "split", locked: false, reason: "overlap" },
    ],
  });

  it("locks a segment with the chosen layout and focus", () => {
    const one = editReframeTrack(track, { type: "segment", segmentId: "s1", focus: ["p2"] });
    expect(one.segments[0]).toMatchObject({ layout: "single", focus: ["p2"], resolved: "single", locked: true, reason: "user" });
    expect(track.segments[0]!.locked).toBe(false);
    expect(editReframeTrack(track, { type: "segment", segmentId: "s1", focus: ["p1", "p2"] }).segments[0]!.layout).toBe("split");
    expect(editReframeTrack(track, { type: "segment", segmentId: "s2", layout: "split" }).segments[1]!.resolved).toBe("split");
    expect(editReframeTrack(track, { type: "segment", segmentId: "s1", layout: "wide" }).segments[0]!.resolved).toBe("wide");
    const dragged = editReframeTrack(track, { type: "segment", segmentId: "s1", window: { x: 800, y: 540, h: 1080 } });
    expect(dragged.segments[0]).toMatchObject({ layout: "single", window: { x: 800, y: 540, h: 1080 }, locked: true });
    expect(editReframeTrack(dragged, { type: "segment", segmentId: "s1", layout: "wide" }).segments[0]!.window).toBeUndefined();
  });

  it("resets a segment to automatic", () => {
    const dragged = editReframeTrack(track, { type: "segment", segmentId: "s1", window: { x: 800, y: 540, h: 1080 } });
    // The reason stays "user" until the next planReframe recomputes it.
    expect(editReframeTrack(dragged, { type: "reset", segmentId: "s1" }).segments[0]).toEqual({ ...track.segments[0], reason: "user" });
  });

  it("changes people and settings", () => {
    const p = editReframeTrack(track, { type: "person", personId: "p1", label: "Ana", priority: true, neverFocus: true });
    expect(p.people[0]).toMatchObject({ label: "Ana", priority: true, neverFocus: true });
    expect(editReframeTrack(track, { type: "person", personId: "p1" }).people[0]).toEqual(track.people[0]);
    const s = editReframeTrack(track, { type: "settings", style: 0, maxUpscalePct: 300, zoomPct: 150 });
    expect([s.style, s.maxUpscalePct, s.zoomPct]).toEqual([0, 300, 150]);
    expect(editReframeTrack(track, { type: "settings" })).toEqual(track);
  });

  it("merges two people, keeping their earlier merges", () => {
    const m = editReframeTrack(track, { type: "merge", personId: "p2", intoId: "p1" });
    expect(m.people.map((p) => [p.id, p.merged])).toEqual([
      ["p1", ["p2", "p5"]],
      ["p3", undefined],
    ]);
    expect(m.segments[1]!.speakers).toEqual(["p1"]);
  });

  it("refuses edits it can't apply", () => {
    expect(() => editReframeTrack(track, { type: "reset", segmentId: "s9" })).toThrow(expect.objectContaining({ code: "SEGMENT_NOT_FOUND" }));
    expect(() => editReframeTrack(track, { type: "person", personId: "p9" })).toThrow(expect.objectContaining({ code: "PERSON_NOT_FOUND" }));
    expect(() => editReframeTrack(track, { type: "segment", segmentId: "s1", focus: ["p3"] })).toThrow("no face");
    expect(() => editReframeTrack(track, { type: "segment", segmentId: "s1", focus: ["p1", "p1"] })).toThrow("at most two");
    expect(() => editReframeTrack(track, { type: "segment", segmentId: "s1", layout: "split" })).toThrow("two people");
    expect(() => editReframeTrack(track, { type: "segment", segmentId: "s1", window: { x: -1, y: 0, h: 10 } })).toThrow("window");
    expect(() => editReframeTrack(track, { type: "person", personId: "p1", label: "" })).toThrow("label");
    expect(() => editReframeTrack(track, { type: "merge", personId: "p1", intoId: "p1" })).toThrow("themselves");
    expect(() => editReframeTrack(track, { type: "merge", personId: "p3", intoId: "p1" })).toThrow("two faces");
    expect(() => editReframeTrack(track, { type: "settings", style: 101 })).toThrow("style");
    expect(() => editReframeTrack(track, { type: "settings", maxUpscalePct: 99 })).toThrow("maxUpscalePct");
    expect(() => editReframeTrack(track, { type: "settings", zoomPct: 50 })).toThrow("zoomPct");
  });
});
