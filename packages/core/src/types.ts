/** All times are integer microseconds. Never floats of seconds. */
export type Us = number;
export type Id = string;

export interface Rational {
  num: number;
  den: number;
}

export interface ProjectSettings {
  width: number;
  height: number;
  fps: Rational;
  sampleRate: number;
}

export type AssetKind = "video" | "audio";

export interface AssetFingerprint {
  size: number;
  /** Hex SHA-256 of the first 64 KiB, used to relink media on another device. */
  sha256Head?: string;
}

export interface Asset {
  id: Id;
  kind: AssetKind;
  name: string;
  uri: string;
  durationUs: Us;
  width?: number;
  height?: number;
  hasAudio?: boolean;
  fingerprint?: AssetFingerprint;
}

/**
 * Where the crop window sits at one instant of the source. Stored in the `core/reframe` effect of a
 * video clip as `params.keys`, sorted by `atUs`. Integers only.
 */
export interface ReframeKey {
  /** Source time of the asset (not timeline time), so split, trim and speed keep the framing. */
  atUs: Us;
  /** Centre of the crop window, in source pixels. */
  x: number;
  y: number;
  /** Height of the crop window in source pixels. Its width follows the project's aspect ratio. */
  h: number;
  /** Jump to this key at `atUs` instead of gliding to it from the previous key. */
  cut?: boolean;
  /**
   * Absent: one window at (x, y, h). `split`: two `regions`, each filling half the output (top, then
   * bottom). `wide`: the whole active area over a blurred fill. Renderers that don't draw layouts
   * yet show the single window (x, y, h), which is always valid.
   */
  layout?: "split" | "wide";
  /** The two windows of a `split` key. Each has the aspect of half the output (`outW : outH / 2`). */
  regions?: [ReframeWindow, ReframeWindow];
}

/** A crop window: centre and height in source pixels; the width follows the output's aspect. */
export interface ReframeWindow {
  x: number;
  y: number;
  h: number;
}

/** Layout of a reframe segment. `auto` lets the planner choose. */
export type SegmentLayout = "auto" | "single" | "split" | "wide";
/** Why a segment was framed the way it is; the editor shows it. */
export type SegmentReason = "lips+voice" | "overlap" | "no-face" | "voice-only" | "never-focus" | "low-quality" | "user";

/** Someone in a reframed clip. Ids, labels and flags only: never embeddings, images or audio. */
export interface TrackPerson {
  /** `p1`, `p2`, … in order of first appearance. */
  id: string;
  label: string;
  /** `voice`: heard with no face on screen. */
  kind: "face" | "voice";
  /** Wins the frame when they and someone else score the same. */
  priority: boolean;
  /** Never framed alone; a segment where only they talk goes wide. */
  neverFocus: boolean;
  /** Ids of detected people the user merged into this one. */
  merged?: string[];
}

/** A stretch of source time framed one way. */
export interface TrackSegment {
  /** `s1`, `s2`, … in time order. */
  id: string;
  /** Source time, `[startUs, endUs)`. */
  startUs: Us;
  endUs: Us;
  /** Who talks in it. */
  speakers: string[];
  /** What the user asked for. */
  layout: SegmentLayout;
  /** Who the user asked to frame (one for single, two for split). Empty: the planner chooses. */
  focus: string[];
  /** What the planner drew. */
  resolved: "single" | "split" | "wide";
  /** Set by any user edit. Re-planning never changes a locked segment. */
  locked: boolean;
  reason: SegmentReason;
  /** A window dragged by hand; only on locked segments. */
  window?: ReframeWindow;
}

/**
 * Automatic framing of a clip: who speaks when and how each stretch is framed. Stored next to the
 * keys in the `core/reframe` effect (`params.track`, ADR 0006); the keys are derived from it.
 */
export interface ReframeTrack {
  version: 1;
  /** Camera style: 0 calm, 50 balanced, 100 dynamic. */
  style: number;
  /** Largest upscale a crop may need before the segment goes wide, in percent (200 = 2x; 1080p to 1080x1920 needs 178). */
  maxUpscalePct: number;
  /** Extra zoom of single windows, in percent (100 = the full height of the active area). */
  zoomPct: number;
  safeZone: "none";
  /** The picture inside burned-in bars, in source pixels. Absent: the whole frame. */
  activeArea?: CropRect;
  people: TrackPerson[];
  segments: TrackSegment[];
}

/** A rectangle of the source frame, in integer source pixels. */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Effect {
  type: string;
  params: Record<string, unknown>;
}

export interface Clip {
  id: Id;
  assetId: Id;
  /** Position on the timeline. */
  startUs: Us;
  /** Range of the source asset that plays. */
  sourceInUs: Us;
  sourceOutUs: Us;
  speed: number;
  volume: number;
  effects: Effect[];
}

export type TrackKind = "video" | "audio";

export interface Track {
  id: Id;
  kind: TrackKind;
  muted: boolean;
  clips: Clip[];
}

export const CPF_VERSION = "0.1.0" as const;

/** Cutiva Project Format (CPF). */
export interface Project {
  $schema?: string;
  version: typeof CPF_VERSION;
  id: Id;
  settings: ProjectSettings;
  assets: Asset[];
  /** Video tracks are composited in array order: later tracks draw on top. */
  tracks: Track[];
  meta?: Record<string, unknown>;
}
