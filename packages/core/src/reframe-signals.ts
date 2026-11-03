import { CutivaError } from "./errors.js";
import type { CropRect, Us } from "./types.js";

/** A greyscale picture: `luma[y * width + x]`, 0 (black) to 255. */
export interface LumaImage {
  width: number;
  height: number;
  luma: ArrayLike<number>;
}

/** A pixel this dark or darker counts as black (video black is 16; compression adds noise). */
const BAR_LUMA = 32;
/** A row or column is a bar when this share of its pixels (in percent) is black. */
const BAR_SHARE_PCT = 95;
/** Bars thinner than this share of the side (in percent) are ignored: edges, not bars. */
const BAR_MIN_PCT = 2;
/** With bars removed, at least this share of each side (in percent) must remain, else it is a dark scene. */
const AREA_MIN_PCT = 50;

const ceilDiv = (a: number, b: number): number => Math.floor((a + b - 1) / b);

/**
 * Find burned-in black bars. `peak` holds, for each pixel, the brightest luma it had across the
 * sampled frames (so a dark shot doesn't look like a bar), at any size with the source's aspect.
 * Returns the picture inside the bars in source pixels, rounded inwards, or null when there are no
 * bars. Rows and columns are bars only from the edges inwards; a bar under 2% of a side is ignored;
 * if less than half of a side would remain, the frame is treated as a dark scene and null returned.
 */
export function detectActiveArea(peak: LumaImage, sourceWidth: number, sourceHeight: number): CropRect | null {
  const { width: w, height: h, luma } = peak;
  for (const v of [w, h, sourceWidth, sourceHeight]) {
    if (!Number.isInteger(v) || v < 1) throw new CutivaError("INVALID_RANGE", "Sizes must be positive integers.");
  }
  if (luma.length !== w * h) throw new CutivaError("INVALID_RANGE", "luma must hold width × height values.");
  const darkRow = (y: number): boolean => {
    let n = 0;
    for (let x = 0; x < w; x++) if (luma[y * w + x]! <= BAR_LUMA) n++;
    return n * 100 >= BAR_SHARE_PCT * w;
  };
  const darkCol = (x: number): boolean => {
    let n = 0;
    for (let y = 0; y < h; y++) if (luma[y * w + x]! <= BAR_LUMA) n++;
    return n * 100 >= BAR_SHARE_PCT * h;
  };
  const run = (len: number, dark: (i: number) => boolean, reverse: boolean): number => {
    let n = 0;
    while (n < len && dark(reverse ? len - 1 - n : n)) n++;
    return n * 100 >= BAR_MIN_PCT * len ? n : 0;
  };
  const top = run(h, darkRow, false);
  const bottom = run(h, darkRow, true);
  const left = run(w, darkCol, false);
  const right = run(w, darkCol, true);
  if (top + bottom + left + right === 0) return null;
  if ((w - left - right) * 100 < AREA_MIN_PCT * w || (h - top - bottom) * 100 < AREA_MIN_PCT * h) return null;
  const x0 = ceilDiv(left * sourceWidth, w);
  const x1 = Math.floor(((w - right) * sourceWidth) / w);
  const y0 = ceilDiv(top * sourceHeight, h);
  const y1 = Math.floor(((h - bottom) * sourceHeight) / h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Left and right are treated as one channel when their difference holds less than this share of the energy. */
const MONO_ENERGY = 1e-3;
/** Pan is measured over this long on each side of a time. */
const PAN_HALF_WINDOW_US = 100_000;

/** Nearest sample to `us` microseconds, halves up. Exact while `us × sampleRate` stays under 2^53. */
const sampleAt = (us: number, sampleRate: number): number => Math.floor((us * sampleRate + 500_000) / 1_000_000);

/**
 * Where the sound comes from in the stereo field at each time, -1 (left) to 1 (right):
 * `(R − L) / (R + L)` of the energy within 100 ms on each side. Null when the two channels carry the
 * same signal (mono saved as stereo), where pan says nothing about who talks. Silence gives 0.
 */
export function stereoPan(left: ArrayLike<number>, right: ArrayLike<number>, sampleRate: number, timesUs: readonly Us[]): number[] | null {
  if (!Number.isInteger(sampleRate) || sampleRate < 1) throw new CutivaError("INVALID_RANGE", "sampleRate must be a positive integer.");
  if (left.length !== right.length) throw new CutivaError("INVALID_RANGE", "Both channels must have the same length.");
  let diff = 0;
  let total = 0;
  for (let i = 0; i < left.length; i++) {
    const l = left[i]!;
    const r = right[i]!;
    diff += (l - r) * (l - r);
    total += l * l + r * r;
  }
  if (total === 0 || diff <= MONO_ENERGY * total) return null;
  const half = sampleAt(PAN_HALF_WINDOW_US, sampleRate);
  return timesUs.map((t) => {
    if (!Number.isInteger(t) || t < 0) throw new CutivaError("INVALID_RANGE", "Times must be non-negative integers.");
    const mid = sampleAt(t, sampleRate);
    const from = Math.max(0, mid - half);
    const to = Math.min(left.length, mid + half);
    let l = 0;
    let r = 0;
    for (let i = from; i < to; i++) {
      l += left[i]! * left[i]!;
      r += right[i]! * right[i]!;
    }
    return l + r > 0 ? (r - l) / (r + l) : 0;
  });
}
