import { CutivaError } from "./errors.js";
import { cropRect } from "./reframe.js";
import type { CropRect, ReframeKey, ReframeTrack, ReframeWindow, TrackPerson, TrackSegment, Us } from "./types.js";

/*
 * The Reframe planner (ADR 0006, docs/reframe-mvp-spec.md "Motor de decisión"). From what a
 * detector saw, it decides who is framed when (segments) and writes the crop keys renderers read.
 * Pure and deterministic: no clocks, no randomness, every sort fully ordered, and arithmetic written
 * the same way in Dart so both give the same output. The steps are described in
 * apps/website/content/docs/auto-reframe.mdx ("The reframe planner").
 */

/** A face seen in one analysed frame, in source pixels (display orientation). */
export interface PlanFace {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Mouth openness, 0 closed to 1 wide open. `null` when the mouth can't be seen (a microphone in front of it). */
  mouth: number | null;
  /** Detector confidence, 0 to 1. Faces under 0.6 are ignored. Omit when the detector gives none. */
  conf?: number;
}

/** What the detectors saw at one source time. */
export interface PlanFrame {
  atUs: Us;
  faces: PlanFace[];
  /** Speech level around this frame, 0 to 1; 0.1 and above counts as voice. Omit on every frame when the source has no audio. */
  voice?: number;
  /** Stereo balance of the speech, -1 (left) to 1 (right). Omit for mono. */
  pan?: number;
}

export interface ReframePlanInput {
  sourceWidth: number;
  sourceHeight: number;
  /** Output frame size; only its aspect ratio matters. */
  outputWidth: number;
  outputHeight: number;
  /** Length of the analysed source. */
  durationUs: Us;
  /** Frames sorted by strictly increasing `atUs`, all before `durationUs`; 5 per second is typical. */
  frames: PlanFrame[];
  /** Source times where the camera changes (see `detectCuts`). */
  cuts?: Us[];
  /** The picture inside burned-in bars. Defaults to the track's, then to the whole frame. */
  activeArea?: CropRect;
  /** The clip's current track: its settings, people (names, flags, merges) and locked segments are kept. */
  track?: ReframeTrack;
}

export interface ReframePlanResult {
  track: ReframeTrack;
  keys: ReframeKey[];
  /** The source already has the output's shape (within 2%): one key showing the whole active area, no segments. */
  passthrough: boolean;
}

// ---- Constants (starting values; calibrated with the test footage) ----

const MIN_CONF = 0.6;
/** Faces shorter than this share of the frame height are ignored (audience, background). */
const MIN_FACE_SHARE = 0.04;
/** Most faces considered per frame and people per shot. */
const MAX_CANDIDATES = 4;
const MIN_IOU = 0.3;
/** A track that isn't seen for longer than this ends; a later face starts a new person. */
const MAX_GAP_US = 1_000_000;
/** Tracks seen in fewer than this share of a shot's frames are dropped as noise. */
const MIN_TRACK_SHARE = 0.2;
const VOICE_LEVEL = 0.1;
const VOICE_MIN_US = 250_000;
const VOICE_GAP_US = 300_000;
/** Lip activity is the spread of mouth openness within this many µs on each side of a frame. */
const LIPS_WINDOW_US = 250_000;
/** A standard deviation of mouth openness this large scores 1. */
const LIPS_FULL = 0.05;
/** A visible face with lip activity under this isn't a candidate speaker. */
const LIPS_CANDIDATE = 0.3;
const W_LIPS = 0.6;
const W_PAN = 0.25;
const W_CONTINUITY = 0.15;
/** A challenger must beat the current speaker by this much for `holdUs` to take the frame. */
const SWITCH_MARGIN = 0.15;
const OVERLAP_SCORE = 0.5;
const OVERLAP_MIN_US = 1_500_000;
/** Voice with no candidate face for longer than this goes wide. */
const VOICE_ONLY_MIN_US = 1_000_000;
/** Segment edges closer than this to a camera cut move onto it. */
const SNAP_US = 400_000;
/** The top of the face sits this share of the window height below the window's top. */
const HEADROOM = 0.12;
/** In a split, each face fills about this share of its region's height. */
const SPLIT_FACE_SHARE = 0.35;
const PASSTHROUGH = 0.02;
const ONE_EURO_BETA = 1;
const ONE_EURO_D_CUTOFF = 1;

/** Camera style presets: calm (0), balanced (50), dynamic (100). Values in between are linear. */
const STYLE = {
  holdUs: [1_600_000, 1_000_000, 400_000],
  minSegmentUs: [1_500_000, 1_000_000, 600_000],
  deadZone: [0.06, 0.04, 0.02],
  minCutoff: [0.3, 0.8, 1.5],
  maxSpeed: [0.15, 0.25, 0.4],
} as const;

/** n / d rounded half up, for integers with d > 0. */
const divRound = (n: number, d: number): number => Math.floor((2 * n + d) / (2 * d));
/** Rounded half up; Dart writes the same `floor(x + 0.5)`. */
const half = (x: number): number => Math.floor(x + 0.5);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** The style's parameters. Integers (µs) are interpolated with integer arithmetic. */
export function reframeStyle(style: number): { holdUs: Us; minSegmentUs: Us; deadZone: number; minCutoff: number; maxSpeed: number } {
  const [i, u] = style <= 50 ? [0, style] : [1, style - 50];
  const int = (v: readonly number[]) => v[i]! + divRound((v[i + 1]! - v[i]!) * u, 50);
  const real = (v: readonly number[]) => v[i]! + ((v[i + 1]! - v[i]!) * u) / 50;
  return { holdUs: int(STYLE.holdUs), minSegmentUs: int(STYLE.minSegmentUs), deadZone: real(STYLE.deadZone), minCutoff: real(STYLE.minCutoff), maxSpeed: real(STYLE.maxSpeed) };
}

function check(ok: boolean, message: string): void {
  if (!ok) throw new CutivaError("INVALID_RANGE", message);
}
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

interface FaceTrack {
  shot: number;
  /** Sightings by frame index, in increasing order. */
  seen: { fi: number; face: PlanFace }[];
  /** Index into `people` once assigned. */
  person: number;
}

type Label =
  | { kind: "speak"; person: number }
  | { kind: "over"; a: number; b: number }
  | { kind: "voice" }
  | { kind: "noface" }
  | { kind: "never"; person: number }
  | { kind: "hold" };

const sameLabel = (x: Label, y: Label): boolean => {
  if (x.kind !== y.kind) return false;
  if (x.kind === "speak" || x.kind === "never") return x.person === (y as typeof x).person;
  if (x.kind === "over") return x.a === (y as typeof x).a && x.b === (y as typeof x).b;
  return true;
};

interface Seg {
  startUs: Us;
  endUs: Us;
  label: Label;
  /** A locked segment from the previous track, passed through. */
  locked?: TrackSegment;
}

const iou = (a: PlanFace, b: PlanFace): number => {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
};

const personNumber = (id: string): number => Number(id.slice(1));

/**
 * Plan a clip's reframe: segments (who is framed, and how) and the crop keys that draw them.
 * Locked segments, names, flags and merges of `input.track` are kept. Throws INVALID_RANGE on bad input.
 */
export function planReframe(input: ReframePlanInput): ReframePlanResult {
  const { sourceWidth: srcW, sourceHeight: srcH, outputWidth: outW, outputHeight: outH, durationUs, frames } = input;
  for (const v of [srcW, srcH, outW, outH]) check(Number.isInteger(v) && v >= 1, "Sizes must be positive integers.");
  check(Number.isInteger(durationUs) && durationUs >= 1, "durationUs must be a positive integer.");
  frames.forEach((f, i) => {
    check(Number.isInteger(f.atUs) && f.atUs >= 0 && f.atUs < durationUs && (i === 0 || f.atUs > frames[i - 1]!.atUs), "Frames must have increasing integer atUs before durationUs.");
    check(f.voice === undefined || (isNum(f.voice) && f.voice >= 0 && f.voice <= 1), "voice must be between 0 and 1.");
    check(f.pan === undefined || (isNum(f.pan) && f.pan >= -1 && f.pan <= 1), "pan must be between -1 and 1.");
    for (const face of f.faces) {
      check([face.x, face.y, face.w, face.h].every(isNum) && face.w > 0 && face.h > 0, "Faces need finite x, y and positive w, h.");
      check(face.mouth === null || (isNum(face.mouth) && face.mouth >= 0 && face.mouth <= 1), "mouth must be null or between 0 and 1.");
      check(face.conf === undefined || (isNum(face.conf) && face.conf >= 0 && face.conf <= 1), "conf must be between 0 and 1.");
    }
  });
  for (const c of input.cuts ?? []) check(Number.isInteger(c) && c >= 0, "Cuts must be non-negative integers.");

  const prev = input.track;
  const style = prev?.style ?? 50;
  const maxUpscalePct = prev?.maxUpscalePct ?? 200;
  const zoomPct = prev?.zoomPct ?? 100;
  const givenArea = input.activeArea ?? prev?.activeArea;
  const area: CropRect = givenArea ?? { x: 0, y: 0, w: srcW, h: srcH };
  check(area.x >= 0 && area.y >= 0 && area.w >= 1 && area.h >= 1 && area.x + area.w <= srcW && area.y + area.h <= srcH, "activeArea must lie inside the source frame.");
  const params = reframeStyle(style);
  const trackOf = (people: TrackPerson[], segments: TrackSegment[]): ReframeTrack => ({
    version: 1,
    style,
    maxUpscalePct,
    zoomPct,
    safeZone: "none",
    ...(givenArea ? { activeArea: { ...givenArea } } : {}),
    people,
    segments,
  });
  const areaCentre = { x: area.x + Math.floor(area.w / 2), y: area.y + Math.floor(area.h / 2) };

  // 1. Passthrough: the active area already has the output's shape.
  if (Math.abs(area.w * outH - area.h * outW) <= PASSTHROUGH * area.h * outW) {
    return {
      track: trackOf(prev ? prev.people.map((p) => ({ ...p, ...(p.merged ? { merged: [...p.merged] } : {}) })) : [], []),
      keys: [{ atUs: 0, x: areaCentre.x, y: areaCentre.y, h: area.h, cut: true }],
      passthrough: true,
    };
  }

  // Window size for single framing: the full height of the active area (or less with zoom).
  const fullH = Math.min(area.h, Math.floor((area.w * outH) / outW));
  const keyH = Math.max(1, Math.floor((fullH * 100) / zoomPct));
  const win = cropRect({ x: 0, y: 0, h: keyH }, srcW, srcH, outW, outH, area);

  // 2. Shots.
  const shotStarts = [0, ...new Set((input.cuts ?? []).filter((c) => c > 0 && c < durationUs))].sort((a, b) => a - b);
  const cuts = shotStarts.slice(1);
  const shotOf = (atUs: Us) => {
    let s = 0;
    while (s + 1 < shotStarts.length && shotStarts[s + 1]! <= atUs) s++;
    return s;
  };
  const n = frames.length;
  const at = (fi: number) => frames[fi]!.atUs;
  const endOf = (fi: number) => (fi + 1 < n ? at(fi + 1) : durationUs);
  const frameShot = frames.map((f) => shotOf(f.atUs));

  // 3. Faces: drop unsure, small and out-of-area faces; keep the four largest.
  const kept = frames.map((f) =>
    f.faces
      .filter((face) => (face.conf === undefined || face.conf >= MIN_CONF) && face.h >= MIN_FACE_SHARE * srcH)
      .filter((face) => {
        const cx = face.x + face.w / 2;
        const cy = face.y + face.h / 2;
        return cx >= area.x && cx < area.x + area.w && cy >= area.y && cy < area.y + area.h;
      })
      .map((face, j) => ({ face, j }))
      .sort((a, b) => b.face.w * b.face.h - a.face.w * a.face.h || a.face.x - b.face.x || a.face.y - b.face.y || a.j - b.j)
      .slice(0, MAX_CANDIDATES)
      .map(({ face }) => face),
  );

  // 4. Tracking within each shot by box overlap.
  const tracks: FaceTrack[] = [];
  shotStarts.forEach((_, shot) => {
    const fis = frames.map((_, fi) => fi).filter((fi) => frameShot[fi] === shot);
    const shotTracks: FaceTrack[] = [];
    for (const fi of fis) {
      const faces = kept[fi]!;
      const pairs: [number, number, number][] = [];
      faces.forEach((face, j) => {
        shotTracks.forEach((t, k) => {
          const last = t.seen[t.seen.length - 1]!;
          if (at(fi) - at(last.fi) > MAX_GAP_US) return;
          const o = iou(face, last.face);
          if (o >= MIN_IOU) pairs.push([o, j, k]);
        });
      });
      pairs.sort((a, b) => b[0] - a[0] || a[1] - b[1] || a[2] - b[2]);
      const usedFace = new Set<number>();
      const usedTrack = new Set<number>();
      for (const [, j, k] of pairs) {
        if (usedFace.has(j) || usedTrack.has(k)) continue;
        usedFace.add(j);
        usedTrack.add(k);
        shotTracks[k]!.seen.push({ fi, face: faces[j]! });
      }
      faces.forEach((face, j) => {
        if (!usedFace.has(j)) shotTracks.push({ shot, seen: [{ fi, face }], person: -1 });
      });
    }
    const min = Math.max(2, Math.ceil(MIN_TRACK_SHARE * fis.length));
    let good = shotTracks.filter((t) => t.seen.length >= min);
    if (good.length === 0 && shotTracks.length > 0) good = [shotTracks.reduce((best, t) => (t.seen.length > best.seen.length ? t : best))];
    good = good
      .map((t, k) => ({ t, k }))
      .sort((a, b) => b.t.seen.length - a.t.seen.length || a.t.seen[0]!.fi - b.t.seen[0]!.fi || a.k - b.k)
      .slice(0, MAX_CANDIDATES)
      .sort((a, b) => a.t.seen[0]!.fi - b.t.seen[0]!.fi || a.t.seen[0]!.face.x - b.t.seen[0]!.face.x || a.t.seen[0]!.face.y - b.t.seen[0]!.face.y || a.k - b.k)
      .map(({ t }) => t);
    tracks.push(...good);
  });

  /** A track's box at a frame: a sighting, a straight line between two sightings, or the last sighting held after it. */
  const boxAt = (t: FaceTrack, fi: number, holdAfter: boolean): PlanFace | null => {
    if (frameShot[fi] !== t.shot || fi < t.seen[0]!.fi) return null;
    let k = 0;
    while (k + 1 < t.seen.length && t.seen[k + 1]!.fi <= fi) k++;
    const a = t.seen[k]!;
    if (a.fi === fi) return a.face;
    const b = t.seen[k + 1];
    if (!b) return holdAfter ? a.face : null;
    const u = (at(fi) - at(a.fi)) / (at(b.fi) - at(a.fi));
    return { x: a.face.x + (b.face.x - a.face.x) * u, y: a.face.y + (b.face.y - a.face.y) * u, w: a.face.w + (b.face.w - a.face.w) * u, h: a.face.h + (b.face.h - a.face.h) * u, mouth: null };
  };

  // 5. People: one per track, numbered by first appearance; merges and names come from the previous track.
  const owner = new Map<string, string>();
  for (const p of prev?.people ?? []) for (const m of p.merged ?? []) owner.set(m, p.id);
  const prevById = new Map((prev?.people ?? []).map((p) => [p.id, p]));
  const personIds: string[] = [];
  tracks.forEach((t, k) => {
    const auto = `p${k + 1}`;
    const id = owner.get(auto) ?? auto;
    let idx = personIds.indexOf(id);
    if (idx < 0) idx = personIds.push(id) - 1;
    t.person = idx;
  });
  const P = personIds.length;
  const flag = (i: number, f: "priority" | "neverFocus") => prevById.get(personIds[i]!)?.[f] === true;
  /** The person's box at a frame: their first track in this shot that has one. */
  const personBox = (i: number, fi: number, holdAfter: boolean): PlanFace | null => {
    for (const t of tracks) if (t.person === i) {
      const b = boxAt(t, fi, holdAfter);
      if (b) return b;
    }
    return null;
  };
  const present = (i: number, fi: number) => personBox(i, fi, false) !== null;

  // 6. Voice: level per frame, short gaps filled, short bursts dropped.
  const noAudio = frames.every((f) => f.voice === undefined);
  const voiced = frames.map((f) => noAudio || (f.voice ?? 0) >= VOICE_LEVEL);
  if (!noAudio) {
    const runs = (v: boolean) => {
      const out: [number, number][] = [];
      for (let i = 0; i < n; i++) {
        if (voiced[i] !== v) continue;
        if (out.length > 0 && out[out.length - 1]![1] === i) out[out.length - 1]![1] = i + 1;
        else out.push([i, i + 1]);
      }
      return out;
    };
    for (const [a, b] of runs(false)) if (a > 0 && b < n && endOf(b - 1) - at(a) < VOICE_GAP_US) for (let i = a; i < b; i++) voiced[i] = true;
    for (const [a, b] of runs(true)) if (endOf(b - 1) - at(a) < VOICE_MIN_US) for (let i = a; i < b; i++) voiced[i] = false;
  }

  // 7. Lip activity: the spread of mouth openness around each frame, from real sightings.
  const lips = (i: number, fi: number): number | null => {
    const values: number[] = [];
    for (const t of tracks) {
      if (t.person !== i || t.shot !== frameShot[fi]) continue;
      for (const s of t.seen) if (Math.abs(at(s.fi) - at(fi)) <= LIPS_WINDOW_US && s.face.mouth !== null) values.push(s.face.mouth);
      if (values.length > 0) break;
    }
    if (values.length < 2) return null;
    let mean = 0;
    for (const v of values) mean += v;
    mean /= values.length;
    let variance = 0;
    for (const v of values) variance += (v - mean) * (v - mean);
    variance /= values.length;
    return Math.min(1, Math.sqrt(variance) / LIPS_FULL);
  };
  const score = (i: number, fi: number, current: number | null): number => {
    const l = lips(i, fi);
    const pan = noAudio ? undefined : frames[fi]!.pan;
    let sum = W_CONTINUITY * (i === current ? 1 : 0);
    let weight = W_CONTINUITY;
    if (l !== null) {
      sum += W_LIPS * l;
      weight += W_LIPS;
    }
    if (pan !== undefined) {
      const box = personBox(i, fi, false)!;
      const expected = clamp(((box.x + box.w / 2) / srcW) * 2 - 1, -1, 1);
      // 1 when the voice comes from where the face sits, 0 once it is a full half of the stereo field away.
      sum += W_PAN * Math.max(0, 1 - Math.abs(pan - expected));
      weight += W_PAN;
    }
    return sum / weight;
  };

  // 8. Label each frame, with hysteresis between speakers.
  const labels: Label[] = [];
  const speakerOf: (number | null)[] = [];
  let current: number | null = null;
  type Challenge = { person: number; from: number };
  let challenger = null as Challenge | null;
  for (let fi = 0; fi < n; fi++) {
    const visible = Array.from({ length: P }, (_, i) => i).filter((i) => present(i, fi));
    if (visible.length === 0) {
      labels.push({ kind: "noface" });
      speakerOf.push(current);
      challenger = null;
      continue;
    }
    if (!voiced[fi]) {
      labels.push({ kind: "hold" });
      speakerOf.push(current);
      challenger = null;
      continue;
    }
    const focusable = visible.filter((i) => !flag(i, "neverFocus"));
    const candidates = focusable.filter((i) => {
      const l = lips(i, fi);
      return l === null || l >= LIPS_CANDIDATE;
    });
    if (candidates.length === 0) {
      const talking = visible.filter((i) => flag(i, "neverFocus") && (lips(i, fi) ?? 0) >= LIPS_CANDIDATE);
      labels.push(talking.length > 0 ? { kind: "never", person: talking[0]! } : { kind: "voice" });
      speakerOf.push(current);
      challenger = null;
      continue;
    }
    const scores = new Map(focusable.map((i) => [i, score(i, fi, current)]));
    const ranked = [...candidates].sort((a, b) => scores.get(b)! - scores.get(a)! || Number(flag(b, "priority")) - Number(flag(a, "priority")) || a - b);
    const best = ranked[0]!;
    if (current === null || !present(current, fi) || flag(current, "neverFocus")) {
      current = best;
      challenger = null;
    } else if (best !== current && scores.get(best)! > (scores.get(current) ?? 0) + SWITCH_MARGIN) {
      const ch: Challenge = challenger !== null && challenger.person === best ? challenger : { person: best, from: fi };
      challenger = ch;
      if (at(fi) - at(ch.from) >= params.holdUs) {
        // Cut where the new speaker started, as an editor would.
        for (let g = ch.from; g < fi; g++) {
          speakerOf[g] = best;
          const lab = labels[g]!;
          if (lab.kind === "speak") labels[g] = { kind: "speak", person: best };
        }
        current = best;
        challenger = null;
      }
    } else challenger = null;
    // Talking at once needs moving lips on both: pan and continuity alone can't tell two voices apart.
    const over = ranked.filter((i) => scores.get(i)! > OVERLAP_SCORE && (lips(i, fi) ?? 0) >= LIPS_CANDIDATE);
    speakerOf.push(current);
    labels.push(over.length >= 2 ? { kind: "over", a: Math.min(over[0]!, over[1]!), b: Math.max(over[0]!, over[1]!) } : { kind: "speak", person: current });
  }

  // 9. Durations: short overlaps become the current speaker; short voice-only stretches hold.
  const runsOf = (pred: (l: Label) => boolean, same: (a: Label, b: Label) => boolean) => {
    const out: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      if (!pred(labels[i]!)) continue;
      const last = out[out.length - 1];
      if (last && last[1] === i && same(labels[last[0]]!, labels[i]!)) last[1] = i + 1;
      else out.push([i, i + 1]);
    }
    return out;
  };
  for (const [a, b] of runsOf((l) => l.kind === "over", sameLabel)) {
    if (endOf(b - 1) - at(a) < OVERLAP_MIN_US) for (let i = a; i < b; i++) labels[i] = { kind: "speak", person: speakerOf[i]! };
  }
  for (const [a, b] of runsOf((l) => l.kind === "voice", sameLabel)) {
    if (endOf(b - 1) - at(a) <= VOICE_ONLY_MIN_US) for (let i = a; i < b; i++) labels[i] = { kind: "hold" };
  }

  // 10. Silences keep the framing before them; at a shot's start, the first speaker; else the most visible person.
  const seenBy = (i: number, fi: number) => personBox(i, fi, true) !== null;
  const valid = (l: Label, fi: number): boolean => {
    if (l.kind === "speak" || l.kind === "never") return seenBy(l.person, fi);
    if (l.kind === "over") return seenBy(l.a, fi) && seenBy(l.b, fi);
    if (l.kind === "noface") return false;
    return l.kind === "voice";
  };
  const mostVisible = (fi: number): Label => {
    let best = -1;
    let bestArea = -1;
    for (let i = 0; i < P; i++) {
      if (flag(i, "neverFocus") || !seenBy(i, fi)) continue;
      let sum = 0;
      for (const t of tracks) if (t.person === i && t.shot === frameShot[fi]) for (const s of t.seen) sum += s.face.w * s.face.h;
      if (sum > bestArea) {
        best = i;
        bestArea = sum;
      }
    }
    if (best >= 0) return { kind: "speak", person: best };
    const never = Array.from({ length: P }, (_, i) => i).find((i) => seenBy(i, fi));
    return never !== undefined ? { kind: "never", person: never } : { kind: "noface" };
  };
  for (let fi = 0; fi < n; fi++) {
    if (labels[fi]!.kind !== "hold") continue;
    const before = fi > 0 ? labels[fi - 1]! : null;
    if (before && frameShot[fi - 1] === frameShot[fi] && valid(before, fi)) {
      labels[fi] = before;
      continue;
    }
    let next: Label | null = null;
    for (let g = fi + 1; g < n && frameShot[g] === frameShot[fi]; g++) {
      const l = labels[g]!;
      if (l.kind === "hold") continue;
      if (valid(l, fi)) next = l;
      break;
    }
    labels[fi] = next ?? mostVisible(fi);
  }

  // 11. Segments: runs of one label, then locked segments put back as they were.
  let segs: Seg[] = [];
  for (let fi = 0; fi < n; fi++) {
    const last = segs[segs.length - 1];
    if (last && sameLabel(last.label, labels[fi]!)) last.endUs = endOf(fi);
    else segs.push({ startUs: segs.length === 0 ? 0 : at(fi), endUs: endOf(fi), label: labels[fi]! });
  }
  if (segs.length === 0) segs.push({ startUs: 0, endUs: durationUs, label: { kind: "noface" } });
  const personIndex = (id: string) => personIds.indexOf(owner.get(id) ?? id);
  const locked = (prev?.segments ?? [])
    .filter((s) => s.locked && s.startUs < durationUs)
    .map((s) => ({ ...s, endUs: Math.min(s.endUs, durationUs) }));
  for (const l of locked) {
    const out: Seg[] = [];
    for (const s of segs) {
      if (s.locked || s.endUs <= l.startUs || s.startUs >= l.endUs) {
        out.push(s);
        continue;
      }
      if (s.startUs < l.startUs) out.push({ ...s, endUs: l.startUs });
      if (s.endUs > l.endUs) out.push({ ...s, startUs: l.endUs });
    }
    out.push({ startUs: l.startUs, endUs: l.endUs, label: { kind: "hold" }, locked: l });
    segs = out.sort((a, b) => a.startUs - b.startUs);
  }

  // 12. Short segments fold into a neighbour, then edges move onto nearby camera cuts.
  const coalesce = () => {
    const out: Seg[] = [];
    for (const s of segs) {
      const last = out[out.length - 1];
      if (last && !last.locked && !s.locked && last.endUs === s.startUs && sameLabel(last.label, s.label)) last.endUs = s.endUs;
      else out.push(s);
    }
    segs = out;
  };
  coalesce();
  const stuck = new Set<Seg>();
  for (;;) {
    let shortest = -1;
    segs.forEach((s, i) => {
      if (s.locked || stuck.has(s) || s.endUs - s.startUs >= params.minSegmentUs) return;
      if (shortest < 0 || s.endUs - s.startUs < segs[shortest]!.endUs - segs[shortest]!.startUs) shortest = i;
    });
    if (shortest < 0) break;
    const s = segs[shortest]!;
    const before = segs[shortest - 1];
    const after = segs[shortest + 1];
    const into = before && !before.locked && before.endUs === s.startUs ? before : after && !after.locked && after.startUs === s.endUs ? after : null;
    if (!into) {
      stuck.add(s);
      continue;
    }
    s.label = into.label;
    coalesce();
  }
  for (let i = 1; i < segs.length; i++) {
    const a = segs[i - 1]!;
    const b = segs[i]!;
    if (a.locked || b.locked || a.endUs !== b.startUs) continue;
    let best: Us | null = null;
    for (const c of cuts) if (Math.abs(c - b.startUs) < SNAP_US && (best === null || Math.abs(c - b.startUs) < Math.abs(best - b.startUs))) best = c;
    if (best !== null && best > a.startUs && best < b.endUs) {
      a.endUs = best;
      b.startUs = best;
    }
  }

  // 13. Turn segments into track segments and keys.
  const fisIn = (s: { startUs: Us; endUs: Us }) => frames.map((_, fi) => fi).filter((fi) => at(fi) >= s.startUs && at(fi) < s.endUs);
  const meanBox = (i: number, fis: number[]): PlanFace | null => {
    const boxes = fis.map((fi) => personBox(i, fi, true)).filter((b): b is PlanFace => b !== null);
    if (boxes.length === 0) return null;
    const m = { x: 0, y: 0, w: 0, h: 0 };
    for (const b of boxes) {
      m.x += b.x;
      m.y += b.y;
      m.w += b.w;
      m.h += b.h;
    }
    return { x: m.x / boxes.length, y: m.y / boxes.length, w: m.w / boxes.length, h: m.h / boxes.length, mouth: null };
  };
  const union = (a: PlanFace, b: PlanFace): PlanFace => {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y, mouth: null };
  };
  const maxRegionH = Math.min(area.h, Math.floor((area.w * outH) / (2 * outW)));
  const regionFor = (box: PlanFace): ReframeWindow => {
    const rh = clamp(half(box.h / SPLIT_FACE_SHARE), 1, Math.max(1, maxRegionH));
    const rw = clamp(divRound(rh * 2 * outW, outH), 1, area.w);
    return {
      x: half(clamp(box.x + box.w / 2, area.x + rw / 2, area.x + area.w - rw / 2)),
      y: half(clamp(box.y + (0.5 - HEADROOM) * rh, area.y + rh / 2, area.y + area.h - rh / 2)),
      h: rh,
    };
  };
  const lowQualitySingle = outH * 100 > maxUpscalePct * win.h;

  const people: TrackPerson[] = [];
  let faceCount = 0;
  const letter = (k: number) => (k < 26 ? String.fromCharCode(65 + k) : String(k + 1));
  personIds.forEach((id) => {
    const old = prevById.get(id);
    const label = old?.label ?? `Speaker ${letter(faceCount)}`;
    faceCount++;
    people.push({ id, label, kind: "face", priority: old?.priority ?? false, neverFocus: old?.neverFocus ?? false, ...(old?.merged ? { merged: [...old.merged] } : {}) });
  });
  // People only a locked segment still names (no longer detected) stay, with their names.
  for (const l of locked) for (const id of [...l.speakers, ...l.focus]) {
    const old = prevById.get(id);
    if (old && !people.some((p) => p.id === id)) people.push({ ...old, ...(old.merged ? { merged: [...old.merged] } : {}) });
  }
  let voiceId: string | null = null;
  const voicePerson = (): string => {
    if (voiceId) return voiceId;
    const old = prev?.people.find((p) => p.kind === "voice");
    if (old && !people.some((p) => p.id === old.id)) people.push({ ...old });
    if (old) return (voiceId = old.id);
    const used = [...people.map((p) => p.id), ...people.flatMap((p) => p.merged ?? []), ...(prev?.people ?? []).flatMap((p) => [p.id, ...(p.merged ?? [])])];
    voiceId = `p${Math.max(0, ...used.map(personNumber)) + 1}`;
    people.push({ id: voiceId, label: "Off-camera voice", kind: "voice", priority: false, neverFocus: false });
    return voiceId;
  };

  const segments: TrackSegment[] = [];
  const keys: ReframeKey[] = [];
  const pushKey = (k: ReframeKey) => {
    const last = keys[keys.length - 1];
    if (last && last.atUs >= k.atUs) keys.pop();
    keys.push(k);
  };
  const wideKey = (atUs: Us): ReframeKey => ({ atUs, x: areaCentre.x, y: areaCentre.y, h: keyH, cut: true, layout: "wide" });
  const splitKey = (atUs: Us, a: PlanFace, b: PlanFace): ReframeKey => {
    const [l, r] = a.x + a.w / 2 <= b.x + b.w / 2 ? [a, b] : [b, a];
    return { atUs, x: areaCentre.x, y: areaCentre.y, h: keyH, cut: true, layout: "split", regions: [regionFor(l), regionFor(r)] };
  };
  const centreFor = (box: PlanFace) => ({
    x: clamp(box.x + box.w / 2, area.x + win.w / 2, area.x + area.w - win.w / 2),
    y: clamp(box.y + (0.5 - HEADROOM) * win.h, area.y + win.h / 2, area.y + area.h - win.h / 2),
  });
  /** Follow one person (or two side by side) through a segment: dead zone, One Euro filter, top speed. */
  const follow = (seg: { startUs: Us; endUs: Us }, boxOf: (fi: number) => PlanFace | null) => {
    const fis = fisIn(seg).filter((fi) => boxOf(fi) !== null);
    if (fis.length === 0) {
      pushKey({ atUs: seg.startUs, x: areaCentre.x, y: areaCentre.y, h: keyH, cut: true });
      return;
    }
    let pos = centreFor(boxOf(fis[0]!)!);
    let moving = false;
    let speed = { x: 0, y: 0 };
    let last: ReframeKey = { atUs: seg.startUs, x: half(pos.x), y: half(pos.y), h: keyH, cut: true };
    pushKey(last);
    const alpha = (cutoff: number, te: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * te));
    for (let k = 1; k < fis.length; k++) {
      const fi = fis[k]!;
      const prevFi = fis[k - 1]!;
      const target = centreFor(boxOf(fi)!);
      if (frameShot[fi] !== frameShot[prevFi]) {
        // A camera cut inside the segment (a merged person): jump, don't glide.
        pos = target;
        moving = false;
        speed = { x: 0, y: 0 };
        last = { atUs: at(fi), x: half(pos.x), y: half(pos.y), h: keyH, cut: true };
        pushKey(last);
        continue;
      }
      const te = (at(fi) - at(prevFi)) / 1e6;
      // Dead zone: start moving once the face leaves it, then follow until the window reaches the face.
      if (!moving && (Math.abs(target.x - pos.x) > params.deadZone * win.w || Math.abs(target.y - pos.y) > params.deadZone * win.h)) moving = true;
      else if (moving && Math.abs(target.x - pos.x) < 1 && Math.abs(target.y - pos.y) < 1) moving = false;
      const goal = moving ? target : pos;
      const step = (p: number, g: number, v: number, scale: number) => {
        const dv = (g - p) / te / scale;
        const nv = v + alpha(ONE_EURO_D_CUTOFF, te) * (dv - v);
        const cutoff = params.minCutoff + ONE_EURO_BETA * Math.abs(nv);
        const limit = params.maxSpeed * scale * te;
        return { p: p + clamp(alpha(cutoff, te) * (g - p), -limit, limit), v: nv };
      };
      const sx = step(pos.x, goal.x, speed.x, win.w);
      const sy = step(pos.y, goal.y, speed.y, win.h);
      pos = { x: sx.p, y: sy.p };
      speed = { x: sx.v, y: sy.v };
      const rx = half(pos.x);
      const ry = half(pos.y);
      if (rx === last.x && ry === last.y) continue;
      if (at(prevFi) > last.atUs) pushKey({ atUs: at(prevFi), x: last.x, y: last.y, h: keyH });
      last = { atUs: at(fi), x: rx, y: ry, h: keyH };
      pushKey(last);
    }
  };

  for (const s of segs) {
    if (s.locked) {
      const l = s.locked;
      const focus = (l.focus.length > 0 ? l.focus : l.speakers).map(personIndex);
      segments.push({ ...l, speakers: [...l.speakers], focus: [...l.focus], ...(l.window ? { window: { ...l.window } } : {}) });
      if (l.window) pushKey({ atUs: l.startUs, x: l.window.x, y: l.window.y, h: l.window.h, cut: true });
      else if (l.resolved === "wide") pushKey(wideKey(l.startUs));
      else if (l.resolved === "split") {
        // Both people must be in sight; otherwise the stretch goes wide.
        const fis = fisIn(l);
        const a = focus.length >= 2 && focus[0]! >= 0 ? meanBox(focus[0]!, fis) : null;
        const b = focus.length >= 2 && focus[1]! >= 0 ? meanBox(focus[1]!, fis) : null;
        pushKey(a && b ? splitKey(l.startUs, a, b) : wideKey(l.startUs));
      } else if (focus.length > 0 && focus[0]! >= 0) follow(l, (fi) => personBox(focus[0]!, fi, true));
      else pushKey({ atUs: l.startUs, x: areaCentre.x, y: areaCentre.y, h: keyH, cut: true });
      continue;
    }
    const base = { startUs: s.startUs, endUs: s.endUs, layout: "auto" as const, focus: [] as string[], locked: false };
    const lab = s.label;
    if (lab.kind === "noface" || lab.kind === "hold") {
      segments.push({ ...base, id: "", speakers: [], resolved: "wide", reason: "no-face" });
      pushKey(wideKey(s.startUs));
    } else if (lab.kind === "voice") {
      segments.push({ ...base, id: "", speakers: [voicePerson()], resolved: "wide", reason: "voice-only" });
      pushKey(wideKey(s.startUs));
    } else if (lab.kind === "never") {
      segments.push({ ...base, id: "", speakers: [personIds[lab.person]!], resolved: "wide", reason: "never-focus" });
      pushKey(wideKey(s.startUs));
    } else if (lab.kind === "speak") {
      const speakers = [personIds[lab.person]!];
      if (lowQualitySingle) {
        segments.push({ ...base, id: "", speakers, resolved: "wide", reason: "low-quality" });
        pushKey(wideKey(s.startUs));
      } else {
        segments.push({ ...base, id: "", speakers, resolved: "single", reason: "lips+voice" });
        follow(s, (fi) => personBox(lab.person, fi, true));
      }
    } else {
      const speakers = [personIds[lab.a]!, personIds[lab.b]!];
      const fis = fisIn(s);
      const a = meanBox(lab.a, fis);
      const b = meanBox(lab.b, fis);
      if (!a || !b) {
        // Only one of them is ever in sight here: frame that one.
        segments.push({ ...base, id: "", speakers, resolved: "single", reason: "overlap" });
        follow(s, (fi) => personBox(a ? lab.a : lab.b, fi, true));
        continue;
      }
      const both = union(a, b);
      if (both.w <= win.w && both.h <= win.h) {
        // Side by side: one window holds both.
        if (lowQualitySingle) {
          segments.push({ ...base, id: "", speakers, resolved: "wide", reason: "low-quality" });
          pushKey(wideKey(s.startUs));
        } else {
          segments.push({ ...base, id: "", speakers, resolved: "single", reason: "overlap" });
          follow(s, (fi) => {
            const x = personBox(lab.a, fi, true);
            const y = personBox(lab.b, fi, true);
            return x && y ? union(x, y) : (x ?? y);
          });
        }
      } else {
        const key = splitKey(s.startUs, a, b);
        if (key.regions!.some((r) => outH * 100 > maxUpscalePct * 2 * r.h)) {
          segments.push({ ...base, id: "", speakers, resolved: "wide", reason: "low-quality" });
          pushKey(wideKey(s.startUs));
        } else {
          segments.push({ ...base, id: "", speakers, resolved: "split", reason: "overlap" });
          pushKey(key);
        }
      }
    }
  }
  segments.forEach((s, i) => (s.id = `s${i + 1}`));
  people.sort((a, b) => personNumber(a.id) - personNumber(b.id));
  return { track: trackOf(people, segments), keys, passthrough: false };
}

/** A change the user makes to a clip's Reframe Track. Re-run `planReframe` with the result to redraw the keys. */
export type ReframeEdit =
  /** Choose how a segment is framed. Locks it. `window` keeps a dragged framing (single). */
  | { type: "segment"; segmentId: string; layout?: "single" | "split" | "wide"; focus?: string[]; window?: ReframeWindow }
  /** Give a segment back to the planner. */
  | { type: "reset"; segmentId: string }
  | { type: "person"; personId: string; label?: string; priority?: boolean; neverFocus?: boolean }
  /** `personId` and `intoId` are the same person: keep `intoId`. */
  | { type: "merge"; personId: string; intoId: string }
  | { type: "settings"; style?: number; maxUpscalePct?: number; zoomPct?: number };

/** Apply one edit to a track and return the new track; the input is not changed. Throws SEGMENT_NOT_FOUND, PERSON_NOT_FOUND or INVALID_RANGE. */
export function editReframeTrack(track: ReframeTrack, edit: ReframeEdit): ReframeTrack {
  const next: ReframeTrack = structuredClone(track);
  const segment = (id: string) => {
    const s = next.segments.find((x) => x.id === id);
    if (!s) throw new CutivaError("SEGMENT_NOT_FOUND", `The track has no segment "${id}".`);
    return s;
  };
  const person = (id: string) => {
    const p = next.people.find((x) => x.id === id);
    if (!p) throw new CutivaError("PERSON_NOT_FOUND", `The track has no person "${id}".`);
    return p;
  };
  switch (edit.type) {
    case "segment": {
      const s = segment(edit.segmentId);
      const focus = edit.focus ?? s.focus;
      for (const id of focus) check(person(id).kind === "face", `"${id}" has no face to frame.`);
      check(new Set(focus).size === focus.length && focus.length <= 2, "focus names at most two different people.");
      const layout = edit.window ? "single" : (edit.layout ?? (focus.length === 2 ? "split" : "single"));
      if (layout === "split") check((focus.length > 0 ? focus : s.speakers).length >= 2, "A split needs two people.");
      if (edit.window) {
        const w = edit.window;
        check([w.x, w.y].every((v) => Number.isInteger(v) && v >= 0) && Number.isInteger(w.h) && w.h >= 1, "window needs integer x, y >= 0 and h >= 1.");
        s.window = { x: w.x, y: w.y, h: w.h };
      } else delete s.window;
      Object.assign(s, { layout, focus: [...focus], resolved: layout, locked: true, reason: "user" });
      break;
    }
    case "reset": {
      const s = segment(edit.segmentId);
      delete s.window;
      Object.assign(s, { layout: "auto", focus: [], locked: false });
      break;
    }
    case "person": {
      const p = person(edit.personId);
      if (edit.label !== undefined) {
        check(edit.label.length >= 1 && edit.label.length <= 60, "A label has 1 to 60 characters.");
        p.label = edit.label;
      }
      if (edit.priority !== undefined) p.priority = edit.priority;
      if (edit.neverFocus !== undefined) p.neverFocus = edit.neverFocus;
      break;
    }
    case "merge": {
      check(edit.personId !== edit.intoId, "A person can't be merged into themselves.");
      const from = person(edit.personId);
      const into = person(edit.intoId);
      check(from.kind === into.kind, "Only two faces or two voices can be merged.");
      into.merged = [...(into.merged ?? []), from.id, ...(from.merged ?? [])];
      next.people = next.people.filter((p) => p !== from);
      const swap = (ids: string[]) => [...new Set(ids.map((id) => (id === from.id ? into.id : id)))];
      for (const s of next.segments) {
        s.speakers = swap(s.speakers);
        s.focus = swap(s.focus);
      }
      break;
    }
    case "settings": {
      if (edit.style !== undefined) {
        check(Number.isInteger(edit.style) && edit.style >= 0 && edit.style <= 100, "style is an integer from 0 to 100.");
        next.style = edit.style;
      }
      if (edit.maxUpscalePct !== undefined) {
        check(Number.isInteger(edit.maxUpscalePct) && edit.maxUpscalePct >= 100, "maxUpscalePct is an integer of at least 100.");
        next.maxUpscalePct = edit.maxUpscalePct;
      }
      if (edit.zoomPct !== undefined) {
        check(Number.isInteger(edit.zoomPct) && edit.zoomPct >= 100 && edit.zoomPct <= 1000, "zoomPct is an integer from 100 to 1000.");
        next.zoomPct = edit.zoomPct;
      }
      break;
    }
  }
  return next;
}
