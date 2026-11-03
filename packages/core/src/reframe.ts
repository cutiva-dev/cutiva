import { CutivaError } from "./errors.js";
import type { Asset, Clip, CropRect, ProjectSettings, ReframeKey, Us } from "./types.js";

/** Effect type that holds a video clip's crop keys: `{ type: "core/reframe", params: { keys } }`. */
export const REFRAME_EFFECT = "core/reframe";

/** A reframe key turned into a crop rectangle for one source size and one output aspect. */
export interface CropKey {
  /** Source time of the asset. */
  atUs: Us;
  rect: CropRect;
  /** Hold the previous rectangle until `atUs`, then jump here. */
  cut: boolean;
}

const isInt = (v: unknown, min: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min;

/**
 * Check and copy a list of reframe keys. Keys must be sorted by strictly increasing `atUs`; every
 * field is a non-negative integer and `h` is at least 1. Throws INVALID_RANGE.
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
    last = key.atUs;
    return { atUs: key.atUs, x: key.x, y: key.y, h: key.h, ...(key.cut ? { cut: true } : {}) };
  });
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
 */
export function cropRect(key: ReframeKey, srcW: number, srcH: number, outW: number, outH: number): CropRect {
  const maxH = Math.min(srcH, Math.floor((srcW * outH) / outW));
  const h = clamp(key.h, 1, Math.max(1, maxH));
  const w = clamp(divRound(h * outW, outH), 1, srcW);
  const x = clamp(Math.floor((2 * key.x - w + 1) / 2), 0, srcW - w);
  const y = clamp(Math.floor((2 * key.y - h + 1) / 2), 0, srcH - h);
  return { x, y, w, h };
}

/** Every key of a clip turned into rectangles, or null when the clip isn't reframed or the asset's size is unknown. */
export function clipCropKeys(clip: Clip, asset: Asset, settings: ProjectSettings): CropKey[] | null {
  const keys = reframeKeys(clip);
  if (!keys || !asset.width || !asset.height) return null;
  return keys.map((k) => ({ atUs: k.atUs, rect: cropRect(k, asset.width!, asset.height!, settings.width, settings.height), cut: k.cut === true }));
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
  return keys.slice(from, to + 1).map((k) => ({ atUs: k.atUs, rect: { ...k.rect }, cut: k.cut }));
}
