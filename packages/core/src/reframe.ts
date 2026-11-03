import { CutivaError } from "./errors.js";
import type { Asset, Clip, CropRect, ProjectSettings, ReframeKey, ReframeTrack, ReframeWindow, TrackPerson, TrackSegment, Us } from "./types.js";

/** Effect type that holds a video clip's crop keys: `{ type: "core/reframe", params: { keys } }`. */
export const REFRAME_EFFECT = "core/reframe";

/**
 * How a key fills the frame besides its single `rect`. `split`: two rectangles of the source, each
 * filling half the output (the first the top half, the second the bottom). `wide`: the whole
 * `area` (the active area, or the whole frame) fitted inside the output, over a blurred copy of it
 * that covers the output.
 */
export type CropLayout = { kind: "split"; regions: [CropRect, CropRect] } | { kind: "wide"; area: CropRect };

/** A reframe key turned into a crop rectangle for one source size and one output aspect. */
export interface CropKey {
  /** Source time of the asset. */
  atUs: Us;
  /** The single window; renderers that don't draw layouts show it. */
  rect: CropRect;
  /** Hold the previous rectangle until `atUs`, then jump here. */
  cut: boolean;
  /** Absent: one window. Layouts never glide: they hold from their key to the next. */
  layout?: CropLayout;
}

const isInt = (v: unknown, min: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min;

function normalizeWindow(input: unknown, what: string): ReframeWindow {
  const w = input as Partial<ReframeWindow> | null;
  if (typeof w !== "object" || w === null || !isInt(w.x, 0) || !isInt(w.y, 0) || !isInt(w.h, 1)) {
    throw new CutivaError("INVALID_RANGE", `${what} needs integer x, y >= 0 and h >= 1.`);
  }
  return { x: w.x, y: w.y, h: w.h };
}

/**
 * Check and copy a list of reframe keys. Keys must be sorted by strictly increasing `atUs`; every
 * field is a non-negative integer and `h` is at least 1. A `split` key needs exactly two regions;
 * no other key may have any. Throws INVALID_RANGE.
 */
export function normalizeReframeKeys(input: unknown): ReframeKey[] {
  if (!Array.isArray(input)) throw new CutivaError("INVALID_RANGE", "Reframe keys must be an array.");
  let last = -1;
  return input.map((k: unknown, i) => {
    const key = k as Partial<ReframeKey> | null;
    if (typeof key !== "object" || key === null) throw new CutivaError("INVALID_RANGE", `Reframe key ${i} must be an object.`);
    if (!isInt(key.atUs, 0) || !isInt(key.x, 0) || !isInt(key.y, 0) || !isInt(key.h, 1)) {
      throw new CutivaError("INVALID_RANGE", `Reframe key ${i} needs integer atUs, x, y >= 0 and h >= 1.`);
    }
    if (key.atUs <= last) throw new CutivaError("INVALID_RANGE", `Reframe key ${i} must come after the previous key.`);
    if (key.cut !== undefined && typeof key.cut !== "boolean") throw new CutivaError("INVALID_RANGE", `Reframe key ${i}: cut must be a boolean.`);
    if (key.layout !== undefined && key.layout !== "split" && key.layout !== "wide") {
      throw new CutivaError("INVALID_RANGE", `Reframe key ${i}: layout must be "split" or "wide".`);
    }
    const split = key.layout === "split";
    if (split !== (key.regions !== undefined)) throw new CutivaError("INVALID_RANGE", `Reframe key ${i}: regions go with the split layout, and only with it.`);
    if (split && (!Array.isArray(key.regions) || key.regions.length !== 2)) throw new CutivaError("INVALID_RANGE", `Reframe key ${i}: a split needs two regions.`);
    last = key.atUs;
    return {
      atUs: key.atUs,
      x: key.x,
      y: key.y,
      h: key.h,
      ...(key.cut ? { cut: true } : {}),
      ...(key.layout ? { layout: key.layout } : {}),
      ...(split ? { regions: [normalizeWindow(key.regions![0], `Reframe key ${i} region 0`), normalizeWindow(key.regions![1], `Reframe key ${i} region 1`)] as [ReframeWindow, ReframeWindow] } : {}),
    };
  });
}

const PERSON_ID = /^p[0-9]+$/;
const SEGMENT_ID = /^s[0-9]+$/;
const LAYOUTS = ["auto", "single", "split", "wide"];
const RESOLVED = ["single", "split", "wide"];
const REASONS = ["lips+voice", "overlap", "no-face", "voice-only", "never-focus", "low-quality", "user"];

/**
 * Check and copy a Reframe Track (ADR 0006, `spec/reframe-track.schema.json`), plus the rules a
 * schema can't express: unique ids, segments sorted and not overlapping, every person a segment or
 * a merge names exists, `window` only on locked segments. Throws INVALID_RANGE.
 */
export function normalizeReframeTrack(input: unknown): ReframeTrack {
  const bad = (what: string): never => {
    throw new CutivaError("INVALID_RANGE", `Reframe track: ${what}.`);
  };
  const t = input as Record<string, unknown> | null;
  if (typeof t !== "object" || t === null || Array.isArray(t)) bad("must be an object");
  if (t!.version !== 1) bad("version must be 1");
  if (!isInt(t!.style, 0) || (t!.style as number) > 100) bad("style must be an integer from 0 to 100");
  if (!isInt(t!.maxUpscalePct, 100)) bad("maxUpscalePct must be an integer of at least 100");
  if (!isInt(t!.zoomPct, 100) || (t!.zoomPct as number) > 1000) bad("zoomPct must be an integer from 100 to 1000");
  if (t!.safeZone !== "none") bad('safeZone must be "none"');
  let activeArea: CropRect | undefined;
  if (t!.activeArea !== undefined) {
    const a = t!.activeArea as Partial<CropRect> | null;
    if (typeof a !== "object" || a === null || !isInt(a.x, 0) || !isInt(a.y, 0) || !isInt(a.w, 1) || !isInt(a.h, 1)) bad("activeArea needs integer x, y >= 0 and w, h >= 1");
    activeArea = { x: a!.x!, y: a!.y!, w: a!.w!, h: a!.h! };
  }
  if (!Array.isArray(t!.people)) bad("people must be an array");
  if (!Array.isArray(t!.segments)) bad("segments must be an array");

  const ids = new Set<string>();
  const people: TrackPerson[] = (t!.people as unknown[]).map((raw, i) => {
    const p = raw as Partial<TrackPerson> | null;
    if (typeof p !== "object" || p === null) return bad(`person ${i} must be an object`);
    if (typeof p.id !== "string" || !PERSON_ID.test(p.id) || ids.has(p.id)) bad(`person ${i} needs a unique id like "p1"`);
    if (typeof p.label !== "string" || p.label.length < 1 || p.label.length > 60) bad(`person ${i} needs a label of 1 to 60 characters`);
    if (p.kind !== "face" && p.kind !== "voice") bad(`person ${i}: kind must be "face" or "voice"`);
    if (typeof p.priority !== "boolean" || typeof p.neverFocus !== "boolean") bad(`person ${i} needs boolean priority and neverFocus`);
    ids.add(p.id!);
    return { id: p.id!, label: p.label!, kind: p.kind!, priority: p.priority!, neverFocus: p.neverFocus!, ...(p.merged !== undefined ? { merged: p.merged } : {}) };
  });
  for (const [i, p] of people.entries()) {
    if (p.merged === undefined) continue;
    if (!Array.isArray(p.merged) || p.merged.some((m) => typeof m !== "string" || !PERSON_ID.test(m) || ids.has(m))) bad(`person ${i}: merged must list ids of people no longer in the track`);
    p.merged = [...p.merged];
  }
  const merged = people.flatMap((p) => p.merged ?? []);
  if (new Set(merged).size !== merged.length) bad("a person can be merged only once");

  const known = (list: unknown, what: string): string[] => {
    if (!Array.isArray(list) || list.some((x) => typeof x !== "string" || !ids.has(x)) || new Set(list).size !== list.length) bad(`${what} must list distinct people of the track`);
    return [...(list as string[])];
  };
  const segIds = new Set<string>();
  let end = 0;
  const segments: TrackSegment[] = (t!.segments as unknown[]).map((raw, i) => {
    const s = raw as Partial<TrackSegment> | null;
    if (typeof s !== "object" || s === null) return bad(`segment ${i} must be an object`);
    if (typeof s.id !== "string" || !SEGMENT_ID.test(s.id) || segIds.has(s.id)) bad(`segment ${i} needs a unique id like "s1"`);
    if (!isInt(s.startUs, 0) || !isInt(s.endUs, 1) || s.endUs! <= s.startUs!) bad(`segment ${i} needs integer startUs < endUs`);
    if (s.startUs! < end) bad(`segment ${i} must start after the previous one ends`);
    if (!LAYOUTS.includes(s.layout as string)) bad(`segment ${i}: unknown layout`);
    if (!RESOLVED.includes(s.resolved as string)) bad(`segment ${i}: unknown resolved layout`);
    if (!REASONS.includes(s.reason as string)) bad(`segment ${i}: unknown reason`);
    if (typeof s.locked !== "boolean") bad(`segment ${i}: locked must be a boolean`);
    const focus = known(s.focus, `segment ${i} focus`);
    if (focus.length > 2) bad(`segment ${i}: focus names at most two people`);
    if (s.window !== undefined && !s.locked) bad(`segment ${i}: only locked segments have a window`);
    segIds.add(s.id!);
    end = s.endUs!;
    return {
      id: s.id!,
      startUs: s.startUs!,
      endUs: s.endUs!,
      speakers: known(s.speakers, `segment ${i} speakers`),
      layout: s.layout!,
      focus,
      resolved: s.resolved!,
      locked: s.locked!,
      reason: s.reason!,
      ...(s.window !== undefined ? { window: normalizeWindow(s.window, `Reframe track segment ${i} window`) } : {}),
    };
  });
  return {
    version: 1,
    style: t!.style as number,
    maxUpscalePct: t!.maxUpscalePct as number,
    zoomPct: t!.zoomPct as number,
    safeZone: "none",
    ...(activeArea ? { activeArea } : {}),
    people,
    segments,
  };
}

/**
 * Check and copy the params of a `core/reframe` effect: `keys`, and `track` when present. With the
 * asset's size, the track's active area must lie inside the frame. Throws INVALID_RANGE.
 */
export function normalizeReframeParams(params: Record<string, unknown>, asset?: Pick<Asset, "width" | "height">): { keys: ReframeKey[]; track?: ReframeTrack } {
  const keys = normalizeReframeKeys(params.keys);
  if (params.track === undefined) return { keys };
  const track = normalizeReframeTrack(params.track);
  const a = track.activeArea;
  if (a && asset?.width && asset.height && (a.x + a.w > asset.width || a.y + a.h > asset.height)) {
    throw new CutivaError("INVALID_RANGE", "Reframe track: activeArea must lie inside the source frame.");
  }
  return { keys, track };
}

/** The clip's Reframe Track, or null when it is framed by hand only. */
export function reframeTrack(clip: Clip): ReframeTrack | null {
  const track = clip.effects.find((e) => e.type === REFRAME_EFFECT)?.params.track;
  return track ? (track as ReframeTrack) : null;
}

/** The clip's reframe keys, or null when it has none. */
export function reframeKeys(clip: Clip): ReframeKey[] | null {
  const keys = clip.effects.find((e) => e.type === REFRAME_EFFECT)?.params.keys;
  return Array.isArray(keys) && keys.length > 0 ? (keys as ReframeKey[]) : null;
}

/** floor((2n + d) / 2d): n / d rounded half up, for integers with d > 0. */
const divRound = (n: number, d: number): number => Math.floor((2 * n + d) / (2 * d));
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * The crop rectangle of one key. Its aspect is the output's (`outW:outH`); it is as tall as `key.h`
 * allows while fitting inside the source, and centred on `(x, y)` but pushed back inside the frame.
 * With an `area` (the active area, inside burned-in bars), it fits and stays inside that instead.
 */
export function cropRect(key: ReframeWindow, srcW: number, srcH: number, outW: number, outH: number, area?: CropRect): CropRect {
  const a = area ?? { x: 0, y: 0, w: srcW, h: srcH };
  const maxH = Math.min(a.h, Math.floor((a.w * outH) / outW));
  const h = clamp(key.h, 1, Math.max(1, maxH));
  const w = clamp(divRound(h * outW, outH), 1, a.w);
  const x = clamp(Math.floor((2 * key.x - w + 1) / 2), a.x, a.x + a.w - w);
  const y = clamp(Math.floor((2 * key.y - h + 1) / 2), a.y, a.y + a.h - h);
  return { x, y, w, h };
}

/** Every key of a clip turned into rectangles, or null when the clip isn't reframed or the asset's size is unknown. */
export function clipCropKeys(clip: Clip, asset: Asset, settings: ProjectSettings): CropKey[] | null {
  const keys = reframeKeys(clip);
  if (!keys || !asset.width || !asset.height) return null;
  const srcW = asset.width;
  const srcH = asset.height;
  const area = reframeTrack(clip)?.activeArea;
  const { width: outW, height: outH } = settings;
  const layout = (k: ReframeKey): CropLayout | undefined =>
    k.layout === "split"
      ? // Each region fills half the output, so its aspect is outW : outH / 2, that is 2·outW : outH.
        { kind: "split", regions: [cropRect(k.regions![0], srcW, srcH, 2 * outW, outH, area), cropRect(k.regions![1], srcW, srcH, 2 * outW, outH, area)] }
      : k.layout === "wide"
        ? { kind: "wide", area: area ? { ...area } : { x: 0, y: 0, w: srcW, h: srcH } }
        : undefined;
  return keys.map((k) => {
    const l = layout(k);
    return { atUs: k.atUs, rect: cropRect(k, srcW, srcH, outW, outH, area), cut: k.cut === true, ...(l ? { layout: l } : {}) };
  });
}

const copyLayout = (l: CropLayout): CropLayout =>
  l.kind === "split" ? { kind: "split", regions: [{ ...l.regions[0] }, { ...l.regions[1] }] } : { kind: "wide", area: { ...l.area } };

/** The layout at a source time: the one of the key in effect (the last at or before it; before the first key, the first). Null for a single window. */
export function layoutAt(keys: readonly CropKey[], sourceUs: Us): CropLayout | null {
  let i = 0;
  while (i + 1 < keys.length && keys[i + 1]!.atUs <= sourceUs) i++;
  const l = keys[i]?.layout;
  return l ? copyLayout(l) : null;
}

/**
 * The crop rectangle at a source time. Before the first key it is the first key's; after the last,
 * the last key's. Between two keys the edges glide linearly (rounded half up), unless the later key
 * is a cut: then the earlier rectangle holds until the cut.
 */
export function cropAt(keys: readonly CropKey[], sourceUs: Us): CropRect {
  let i = -1;
  while (i + 1 < keys.length && keys[i + 1]!.atUs <= sourceUs) i++;
  if (i < 0) return { ...keys[0]!.rect };
  const a = keys[i]!;
  const b = keys[i + 1];
  if (!b || b.cut) return { ...a.rect };
  const dt = b.atUs - a.atUs;
  const u = sourceUs - a.atUs;
  const v = b.atUs - sourceUs;
  const lerp = (p: number, q: number) => Math.floor((2 * (p * v + q * u) + dt) / (2 * dt));
  const x = lerp(a.rect.x, b.rect.x);
  const y = lerp(a.rect.y, b.rect.y);
  return { x, y, w: lerp(a.rect.x + a.rect.w, b.rect.x + b.rect.w) - x, h: lerp(a.rect.y + a.rect.h, b.rect.y + b.rect.h) - y };
}

/** The keys that matter for source times in `[sourceInUs, sourceOutUs)`, so `cropAt` gives the same result there. */
export function cropKeysInRange(keys: readonly CropKey[], sourceInUs: Us, sourceOutUs: Us): CropKey[] {
  let from = 0;
  while (from + 1 < keys.length && keys[from + 1]!.atUs <= sourceInUs) from++;
  let to = from;
  while (to + 1 < keys.length && keys[to]!.atUs < sourceOutUs) to++;
  return keys.slice(from, to + 1).map((k) => ({ atUs: k.atUs, rect: { ...k.rect }, cut: k.cut, ...(k.layout ? { layout: copyLayout(k.layout) } : {}) }));
}
