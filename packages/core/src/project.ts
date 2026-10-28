import { CutivaError } from "./errors.js";
import { clipEndUs } from "./time.js";
import type { IdFactory } from "./ids.js";
import { randomId } from "./ids.js";
import { CPF_VERSION, type AssetKind, type Clip, type Project, type ProjectSettings, type Track, type TrackKind } from "./types.js";

export const DEFAULT_SETTINGS: ProjectSettings = {
  width: 1920,
  height: 1080,
  fps: { num: 30, den: 1 },
  sampleRate: 48_000,
};

export const CPF_SCHEMA_URL = "https://cutiva.dev/schema/0.1.json";

export function createProject(settings: Partial<ProjectSettings> = {}, ids: IdFactory = randomId): Project {
  return {
    $schema: CPF_SCHEMA_URL,
    version: CPF_VERSION,
    id: ids("prj"),
    settings: { ...DEFAULT_SETTINGS, ...settings },
    assets: [],
    tracks: [],
  };
}

export function findTrack(project: Project, trackId: string): Track {
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track) throw new CutivaError("TRACK_NOT_FOUND", `Track "${trackId}" does not exist.`);
  return track;
}

export function findClip(project: Project, clipId: string): { track: Track; clip: Clip; index: number } {
  for (const track of project.tracks) {
    const index = track.clips.findIndex((c) => c.id === clipId);
    if (index >= 0) return { track, clip: track.clips[index]!, index };
  }
  throw new CutivaError("CLIP_NOT_FOUND", `Clip "${clipId}" does not exist.`);
}

// ---------- Validation of untrusted JSON ----------

type Json = Record<string, unknown>;

function fail(path: string, expected: string): never {
  throw new CutivaError("INVALID_PROJECT", `Invalid project at ${path}: expected ${expected}.`);
}
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
function num(o: Json, k: string, path: string, opts: { int?: boolean; min?: number; max?: number } = {}): number {
  const v = o[k];
  if (typeof v !== "number" || !Number.isFinite(v)) fail(`${path}.${k}`, "a number");
  if (opts.int && !Number.isInteger(v)) fail(`${path}.${k}`, "an integer");
  if (opts.min !== undefined && v < opts.min) fail(`${path}.${k}`, `a number >= ${opts.min}`);
  if (opts.max !== undefined && v > opts.max) fail(`${path}.${k}`, `a number <= ${opts.max}`);
  return v;
}
function str(o: Json, k: string, path: string): string {
  const v = o[k];
  if (typeof v !== "string" || v.length === 0) fail(`${path}.${k}`, "a non-empty string");
  return v;
}
function arr(o: Json, k: string, path: string): unknown[] {
  const v = o[k];
  if (!Array.isArray(v)) fail(`${path}.${k}`, "an array");
  return v;
}

/**
 * Parse and validate a CPF document (object or JSON string).
 * Returns a clean Project or throws CutivaError("INVALID_PROJECT" | "UNSUPPORTED_VERSION").
 */
export function parseProject(input: unknown): Project {
  const raw = typeof input === "string" ? (JSON.parse(input) as unknown) : input;
  if (!isObj(raw)) fail("$", "an object");
  const version = raw.version;
  if (version !== CPF_VERSION) {
    throw new CutivaError("UNSUPPORTED_VERSION", `CPF version "${String(version)}" is not supported (expected ${CPF_VERSION}).`);
  }
  const s = raw.settings;
  if (!isObj(s)) fail("$.settings", "an object");
  const fps = s.fps;
  if (!isObj(fps)) fail("$.settings.fps", "an object");
  const settings: ProjectSettings = {
    width: num(s, "width", "$.settings", { int: true, min: 2 }),
    height: num(s, "height", "$.settings", { int: true, min: 2 }),
    fps: { num: num(fps, "num", "$.settings.fps", { int: true, min: 1 }), den: num(fps, "den", "$.settings.fps", { int: true, min: 1 }) },
    sampleRate: num(s, "sampleRate", "$.settings", { int: true, min: 8000 }),
  };

  const assetKinds = new Map<string, AssetKind>();
  const assets = arr(raw, "assets", "$").map((a, i) => {
    const p = `$.assets[${i}]`;
    if (!isObj(a)) fail(p, "an object");
    const kind = a.kind;
    if (kind !== "video" && kind !== "audio") fail(`${p}.kind`, '"video" or "audio"');
    const id = str(a, "id", p);
    assetKinds.set(id, kind);
    const fp = a.fingerprint;
    return {
      id,
      kind: kind as AssetKind,
      name: typeof a.name === "string" ? a.name : id,
      uri: str(a, "uri", p),
      durationUs: num(a, "durationUs", p, { int: true, min: 1 }),
      ...(typeof a.width === "number" ? { width: a.width } : {}),
      ...(typeof a.height === "number" ? { height: a.height } : {}),
      ...(typeof a.hasAudio === "boolean" ? { hasAudio: a.hasAudio } : {}),
      ...(isObj(fp) && typeof fp.size === "number"
        ? { fingerprint: { size: fp.size, ...(typeof fp.sha256Head === "string" ? { sha256Head: fp.sha256Head } : {}) } }
        : {}),
    };
  });

  const clipIds = new Set<string>();
  const tracks = arr(raw, "tracks", "$").map((t, i) => {
    const p = `$.tracks[${i}]`;
    if (!isObj(t)) fail(p, "an object");
    const kind = t.kind;
    if (kind !== "video" && kind !== "audio") fail(`${p}.kind`, '"video" or "audio"');
    const clips = arr(t, "clips", p).map((c, j) => {
      const cp = `${p}.clips[${j}]`;
      if (!isObj(c)) fail(cp, "an object");
      const id = str(c, "id", cp);
      if (clipIds.has(id)) fail(`${cp}.id`, "a unique clip id");
      clipIds.add(id);
      const assetId = str(c, "assetId", cp);
      const assetKind = assetKinds.get(assetId);
      if (!assetKind) fail(`${cp}.assetId`, "the id of an asset in $.assets");
      if (assetKind !== kind) fail(`${cp}.assetId`, `a ${kind} asset, like its track`);
      const clip: Clip = {
        id,
        assetId,
        startUs: num(c, "startUs", cp, { int: true, min: 0 }),
        sourceInUs: num(c, "sourceInUs", cp, { int: true, min: 0 }),
        sourceOutUs: num(c, "sourceOutUs", cp, { int: true, min: 1 }),
        speed: c.speed === undefined ? 1 : num(c, "speed", cp, { min: 0.1, max: 16 }),
        volume: c.volume === undefined ? 1 : num(c, "volume", cp, { min: 0, max: 4 }),
        effects: Array.isArray(c.effects)
          ? c.effects.filter(isObj).map((e) => ({ type: String(e.type), params: isObj(e.params) ? e.params : {} }))
          : [],
      };
      if (clip.sourceOutUs <= clip.sourceInUs) fail(`${cp}.sourceOutUs`, "a value greater than sourceInUs");
      return clip;
    });
    // Clips are kept in start order; they may have gaps but must not overlap.
    clips.sort((a, b) => a.startUs - b.startUs);
    for (let j = 1; j < clips.length; j++) {
      if (clips[j]!.startUs < clipEndUs(clips[j - 1]!)) fail(`${p}.clips`, `clips that do not overlap ("${clips[j]!.id}" starts inside "${clips[j - 1]!.id}")`);
    }
    return { id: str(t, "id", p), kind: kind as TrackKind, muted: t.muted === true, clips } satisfies Track;
  });

  return {
    $schema: typeof raw.$schema === "string" ? raw.$schema : CPF_SCHEMA_URL,
    version: CPF_VERSION,
    id: str(raw, "id", "$"),
    settings,
    assets,
    tracks,
    ...(isObj(raw.meta) ? { meta: raw.meta } : {}),
  };
}
