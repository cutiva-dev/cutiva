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
