import { CutivaError } from "./errors.js";
import { cropRect } from "./reframe.js";
import type { ReframeKey, Us } from "./types.js";

/** A face seen in one analysed frame, in source pixels. */
export interface FaceObservation {
  x: number;
  y: number;
  w: number;
  h: number;
  /** How open the mouth is, from 0 (closed) to 1 (wide open). */
  mouth: number;
}

/** What a detector saw at one source time. */
export interface FrameObservation {
  atUs: Us;
  faces: FaceObservation[];
  /** Loudness of speech around this frame, 0 to 1. Below 0.1 counts as silence. Omit when unknown. */
  voice?: number;
}

export interface AutoReframeInput {
  sourceWidth: number;
  sourceHeight: number;
  /** Output frame size; only its aspect ratio matters. */
  outputWidth: number;
  outputHeight: number;
  /** Length of the analysed source. */
  durationUs: Us;
  /** Frames sorted by strictly increasing `atUs`, ideally 4 to 10 per second. */
  frames: FrameObservation[];
  /** Source times where the camera changes (see `detectCuts`). */
  cuts?: Us[];
  /** 1 (default) uses the full source height; 2 shows half of it. */
  zoom?: number;
  /** Shortest time on one speaker before switching to another. Default 1.5 s. */
  minHoldUs?: Us;
}

export interface ReframePerson {
  /** `s<shot>p<n>`; the same person in two shots gets two ids. */
  id: string;
  shot: number;
  /** Time framed as the speaker. Zero means they never got the frame. */
  speakingUs: Us;
  /** Their largest sighting, for an avatar. */
  face: FaceObservation & { atUs: Us };
}

export interface AutoReframeResult {
  keys: ReframeKey[];
  people: ReframePerson[];
  /** Start time of each shot: 0, then every cut. */
  shotStartsUs: Us[];
}

/** A face matches a track when their centres are closer than this share of the larger face width. */
const MATCH_DISTANCE = 0.75;
/** Tracks seen in fewer than this share of a shot's frames are dropped as noise. */
const MIN_TRACK_SHARE = 0.2;
/** Mouth movement is averaged over this many µs on each side of a frame. */
const ACTIVITY_WINDOW_US = 400_000;
/** Lowest averaged mouth movement that counts as talking. */
const SPEAKING_THRESHOLD = 0.02;
const SILENCE = 0.1;
/** Face positions are averaged over this many µs on each side of a frame. */
const SMOOTH_WINDOW_US = 500_000;
/** The window follows a face only after it moves more than this share of the window's size. */
const DEADZONE = 0.05;
/** The face's centre sits this share of the window height above the window's centre. */
const HEADROOM = 0.15;

interface Track {
  /** Observation by frame index within the shot. */
  seen: Map<number, FaceObservation>;
  last: FaceObservation;
}

const cx = (f: FaceObservation) => f.x + f.w / 2;
const cy = (f: FaceObservation) => f.y + f.h / 2;

function check(ok: boolean, message: string): void {
  if (!ok) throw new CutivaError("INVALID_RANGE", message);
}

/** Follow faces from frame to frame by nearest centre. Faces are matched closest pair first. */
function trackFaces(frames: FrameObservation[]): Track[] {
  const tracks: Track[] = [];
  frames.forEach((frame, fi) => {
    const pairs: [number, number, number][] = [];
    frame.faces.forEach((face, j) => {
      tracks.forEach((t, k) => {
        // Squared distances: no square root, so every language gets the same bits.
        const dx = cx(face) - cx(t.last);
        const dy = cy(face) - cy(t.last);
        const limit = MATCH_DISTANCE * Math.max(face.w, t.last.w);
        if (dx * dx + dy * dy < limit * limit) pairs.push([dx * dx + dy * dy, j, k]);
      });
    });
    pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    const usedFace = new Set<number>();
    const usedTrack = new Set<number>();
    for (const [, j, k] of pairs) {
      if (usedFace.has(j) || usedTrack.has(k)) continue;
      usedFace.add(j);
      usedTrack.add(k);
      tracks[k]!.seen.set(fi, frame.faces[j]!);
      tracks[k]!.last = frame.faces[j]!;
    }
    frame.faces.forEach((face, j) => {
      if (!usedFace.has(j)) tracks.push({ seen: new Map([[fi, face]]), last: face });
    });
  });
  const min = Math.max(2, Math.ceil(MIN_TRACK_SHARE * frames.length));
  const kept = tracks.filter((t) => t.seen.size >= min);
  if (kept.length > 0 || tracks.length === 0) return kept;
  return [tracks.reduce((best, t) => (t.seen.size > best.seen.size ? t : best))];
}

/** Indexes of the frames within `windowUs` of frame `fi`. */
function windowOf(frames: FrameObservation[], fi: number, windowUs: Us): number[] {
  const t = frames[fi]!.atUs;
  const out: number[] = [];
  for (let g = fi; g >= 0 && t - frames[g]!.atUs <= windowUs; g--) out.unshift(g);
  for (let g = fi + 1; g < frames.length && frames[g]!.atUs - t <= windowUs; g++) out.push(g);
  return out;
}

/** Who talks in each frame: the track whose mouth moves most, or null when nobody does. */
function speakers(frames: FrameObservation[], tracks: Track[]): (number | null)[] {
  const motion = tracks.map((t) =>
    frames.map((_, fi) => {
      const now = t.seen.get(fi);
      const before = t.seen.get(fi - 1);
      return now && before ? Math.abs(now.mouth - before.mouth) : 0;
    }),
  );
  return frames.map((frame, fi) => {
    if (frame.voice !== undefined && frame.voice < SILENCE) return null;
    const win = windowOf(frames, fi, ACTIVITY_WINDOW_US);
    let best: number | null = null;
    let bestActivity = SPEAKING_THRESHOLD;
    motion.forEach((m, k) => {
      let sum = 0;
      for (const g of win) sum += m[g]!;
      const activity = sum / win.length;
      if (activity > bestActivity || (best === null && activity === bestActivity)) {
        best = k;
        bestActivity = activity;
      }
    });
    return best;
  });
}

interface Run {
  track: number;
  /** First frame index. */
  from: number;
  startUs: Us;
}

/** Turn per-frame speakers into runs and fold runs shorter than `minHoldUs` into a neighbour. */
function holdRuns(frames: FrameObservation[], who: number[], startUs: Us, endUs: Us, minHoldUs: Us): Run[] {
  let runs: Run[] = [];
  who.forEach((k, fi) => {
    if (runs.length === 0 || runs[runs.length - 1]!.track !== k) runs.push({ track: k, from: fi, startUs: runs.length === 0 ? startUs : frames[fi]!.atUs });
  });
  const lengthOf = (i: number) => (i + 1 < runs.length ? runs[i + 1]!.startUs : endUs) - runs[i]!.startUs;
  while (runs.length > 1) {
    let shortest = -1;
    for (let i = 0; i < runs.length; i++) {
      if (lengthOf(i) < minHoldUs && (shortest < 0 || lengthOf(i) < lengthOf(shortest))) shortest = i;
    }
    if (shortest < 0) break;
    runs[shortest]!.track = runs[shortest > 0 ? shortest - 1 : 1]!.track;
    runs = runs.filter((r, i) => i === 0 || r.track !== runs[i - 1]!.track);
  }
  return runs;
}

/**
 * Plan crop keys that keep whoever is talking in frame. Pure and deterministic: every SDK gives the
 * same keys for the same observations. Detecting faces and mouth movement is the engine's job.
 *
 * Per shot: faces are tracked by position, the speaker is the person whose mouth moves most, a
 * speaker holds the frame for at least `minHoldUs`, and each speaker change is a cut. While one
 * person speaks the window follows them smoothly once they move past a small dead zone.
 */
export function autoReframe(input: AutoReframeInput): AutoReframeResult {
  const { sourceWidth: srcW, sourceHeight: srcH, outputWidth: outW, outputHeight: outH, durationUs, frames } = input;
  const zoom = input.zoom ?? 1;
  const minHoldUs = input.minHoldUs ?? 1_500_000;
  for (const v of [srcW, srcH, outW, outH]) check(Number.isInteger(v) && v >= 1, "Sizes must be positive integers.");
  check(Number.isInteger(durationUs) && durationUs >= 1, "durationUs must be a positive integer.");
  check(zoom >= 1 && zoom <= 10, "zoom must be between 1 and 10.");
  check(Number.isInteger(minHoldUs) && minHoldUs >= 0, "minHoldUs must be a non-negative integer.");
  frames.forEach((f, i) => check(Number.isInteger(f.atUs) && f.atUs >= 0 && (i === 0 || f.atUs > frames[i - 1]!.atUs), "Frames must have increasing integer atUs."));
  for (const c of input.cuts ?? []) check(Number.isInteger(c) && c >= 0, "Cuts must be non-negative integers.");

  const shotStartsUs = [0, ...new Set((input.cuts ?? []).filter((c) => c > 0 && c < durationUs))].sort((a, b) => a - b);
  const h = Math.max(1, Math.floor(srcH / zoom));
  const win = cropRect({ atUs: 0, x: 0, y: 0, h }, srcW, srcH, outW, outH);
  const keyAt = (atUs: Us, x: number, y: number, cut?: boolean): ReframeKey => ({
    atUs,
    x: Math.round(x),
    y: Math.round(y + HEADROOM * win.h),
    h,
    ...(cut ? { cut: true } : {}),
  });

  const keys: ReframeKey[] = [];
  const people: ReframePerson[] = [];
  shotStartsUs.forEach((startUs, shot) => {
    const endUs = shotStartsUs[shot + 1] ?? durationUs;
    const shotFrames = frames.filter((f) => f.atUs >= startUs && f.atUs < endUs);
    const tracks = trackFaces(shotFrames);
    if (tracks.length === 0) {
      keys.push({ atUs: startUs, x: Math.floor(srcW / 2), y: Math.floor(srcH / 2), h, cut: true });
      return;
    }

    const raw = speakers(shotFrames, tracks);
    const firstSpeaker = raw.find((k) => k !== null);
    let main = 0;
    tracks.forEach((t, k) => {
      const area = (tr: Track) => [...tr.seen.values()].reduce((s, f) => s + f.w * f.h, 0);
      if (area(t) > area(tracks[main]!)) main = k;
    });
    let current = firstSpeaker ?? main;
    const who = raw.map((k) => (current = k ?? current));
    const runs = holdRuns(shotFrames, who, startUs, endUs, minHoldUs);

    const centreNear = (k: number, fi: number) => {
      let n = 0;
      let sx = 0;
      let sy = 0;
      for (const g of windowOf(shotFrames, fi, SMOOTH_WINDOW_US)) {
        const f = tracks[k]!.seen.get(g);
        if (f) {
          n++;
          sx += cx(f);
          sy += cy(f);
        }
      }
      return n > 0 ? { x: sx / n, y: sy / n } : null;
    };

    const spoke = tracks.map(() => 0);
    runs.forEach((run, r) => {
      const to = r + 1 < runs.length ? runs[r + 1]!.from : shotFrames.length;
      spoke[run.track]! += (r + 1 < runs.length ? runs[r + 1]!.startUs : endUs) - run.startUs;
      // The speaker may be out of sight when their run starts: frame them where they first show up.
      // Every run holds a frame near one of its speaker's sightings (the frame that made them the
      // speaker, or for the most visible person, the whole shot), so this always finds one.
      let fi = run.from;
      let at = centreNear(run.track, fi);
      while (!at && fi + 1 < to) at = centreNear(run.track, ++fi);
      let last = keyAt(run.startUs, at!.x, at!.y, true);
      let anchor = at!;
      keys.push(last);
      for (let g = fi + 1; g < to; g++) {
        const p = centreNear(run.track, g);
        if (!p || (Math.abs(p.x - anchor.x) <= DEADZONE * win.w && Math.abs(p.y - anchor.y) <= DEADZONE * win.h)) continue;
        const before = shotFrames[g - 1]!.atUs;
        if (before > last.atUs) keys.push({ atUs: before, x: last.x, y: last.y, h });
        last = keyAt(shotFrames[g]!.atUs, p.x, p.y);
        anchor = p;
        keys.push(last);
      }
    });

    tracks.forEach((t, k) => {
      let face: (FaceObservation & { atUs: Us }) | null = null;
      for (const [fi, f] of t.seen) {
        if (!face || f.w * f.h > face.w * face.h) face = { ...f, atUs: shotFrames[fi]!.atUs };
      }
      people.push({ id: `s${shot}p${k}`, shot, speakingUs: spoke[k]!, face: face! });
    });
  });

  return { keys, people, shotStartsUs };
}

/** A colour histogram of one analysed frame. Any bin layout works, as long as every frame uses the same. */
export interface FrameHistogram {
  atUs: Us;
  bins: number[];
}

/**
 * Source times where the camera changes: frames whose histogram differs from the previous frame's
 * by at least `threshold` (half the L1 distance of the normalised histograms, 0 to 1), at least
 * `minShotUs` after the previous cut. The cut is placed at the later frame.
 */
export function detectCuts(frames: FrameHistogram[], options: { threshold?: number; minShotUs?: Us } = {}): Us[] {
  const threshold = options.threshold ?? 0.4;
  const minShotUs = options.minShotUs ?? 1_000_000;
  const norm = (bins: number[]) => {
    const total = bins.reduce((s, b) => s + b, 0);
    return bins.map((b) => (total > 0 ? b / total : 0));
  };
  const cuts: Us[] = [];
  let lastCut = frames[0]?.atUs ?? 0;
  for (let i = 1; i < frames.length; i++) {
    const a = norm(frames[i - 1]!.bins);
    const b = norm(frames[i]!.bins);
    check(a.length === b.length, "Every histogram needs the same number of bins.");
    let d = 0;
    for (let j = 0; j < a.length; j++) d += Math.abs(a[j]! - b[j]!);
    d /= 2;
    if (d >= threshold && frames[i]!.atUs - lastCut >= minShotUs) {
      cuts.push(frames[i]!.atUs);
      lastCut = frames[i]!.atUs;
    }
  }
  return cuts;
}
