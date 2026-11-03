import { describe, expect, it } from "vitest";
import { CutivaError, detectActiveArea, stereoPan, type LumaImage } from "../src/index.js";

/** A w×h image filled with `fill`, then `paint(x, y)` decides each pixel when it returns a number. */
const image = (w: number, h: number, fill: number, paint?: (x: number, y: number) => number | undefined): LumaImage => {
  const luma: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) luma.push(paint?.(x, y) ?? fill);
  return { width: w, height: h, luma };
};

const code = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return e instanceof CutivaError ? e.code : "not a CutivaError";
  }
  return undefined;
};

describe("detectActiveArea", () => {
  it("returns null when nothing is black at the edges", () => {
    expect(detectActiveArea(image(16, 9, 120), 1920, 1080)).toBeNull();
  });

  it("finds a letterbox (top and bottom bars) and scales it to source pixels", () => {
    // 2.39:1 inside 16:9 at 64x36: bars of 5 rows each.
    const peak = image(64, 36, 180, (_, y) => (y < 5 || y >= 31 ? 16 : undefined));
    expect(detectActiveArea(peak, 1920, 1080)).toEqual({ x: 0, y: 150, w: 1920, h: 780 });
  });

  it("finds pillarbox bars (left and right)", () => {
    const peak = image(64, 36, 180, (x) => (x < 8 || x >= 56 ? 20 : undefined));
    expect(detectActiveArea(peak, 1920, 1080)).toEqual({ x: 240, y: 0, w: 1440, h: 1080 });
  });

  it("ignores a bar under 2% of the side", () => {
    // One dark row out of 100 is 1%: an edge, not a bar.
    const peak = image(100, 100, 180, (_, y) => (y === 0 ? 0 : undefined));
    expect(detectActiveArea(peak, 1000, 1000)).toBeNull();
    // Two out of 100 is 2%: a bar.
    const two = image(100, 100, 180, (_, y) => (y <= 1 ? 0 : undefined));
    expect(detectActiveArea(two, 1000, 1000)).toEqual({ x: 0, y: 20, w: 1000, h: 980 });
  });

  it("counts a row as a bar only when 95% of it is black", () => {
    // 95 of 100 black: a bar. 94 of 100: not.
    const at95 = image(100, 10, 180, (x, y) => (y === 0 && x < 95 ? 0 : undefined));
    expect(detectActiveArea(at95, 100, 10)).toEqual({ x: 0, y: 1, w: 100, h: 9 });
    const at94 = image(100, 10, 180, (x, y) => (y === 0 && x < 94 ? 0 : undefined));
    expect(detectActiveArea(at94, 100, 10)).toBeNull();
  });

  it("treats luma up to 32 as black and 33 as picture", () => {
    expect(detectActiveArea(image(10, 10, 180, (_, y) => (y === 0 ? 32 : undefined)), 10, 10)).toEqual({ x: 0, y: 1, w: 10, h: 9 });
    expect(detectActiveArea(image(10, 10, 180, (_, y) => (y === 0 ? 33 : undefined)), 10, 10)).toBeNull();
  });

  it("returns null for a dark scene, where less than half of a side would remain", () => {
    expect(detectActiveArea(image(8, 8, 0), 800, 800)).toBeNull();
    const spot = image(10, 10, 0, (x, y) => (x >= 2 && x < 8 && y >= 3 && y < 7 ? 200 : undefined));
    // Columns keep 6 of 10, rows only 4 of 10.
    expect(detectActiveArea(spot, 1000, 1000)).toBeNull();
  });

  it("rounds inwards so the area never includes bar pixels", () => {
    const peak = image(3, 3, 200, (_, y) => (y === 0 ? 0 : undefined));
    // Top edge at 1/3 of 100 = 33.3, rounded up to 34.
    expect(detectActiveArea(peak, 100, 100)).toEqual({ x: 0, y: 34, w: 100, h: 66 });
  });

  it("rejects bad sizes", () => {
    expect(code(() => detectActiveArea({ width: 0, height: 1, luma: [] }, 10, 10))).toBe("INVALID_RANGE");
    expect(code(() => detectActiveArea({ width: 2, height: 2, luma: [0] }, 10, 10))).toBe("INVALID_RANGE");
    expect(code(() => detectActiveArea(image(2, 2, 0), 10.5, 10))).toBe("INVALID_RANGE");
  });
});

describe("stereoPan", () => {
  const sr = 1000;
  const constant = (n: number, v: number) => new Array<number>(n).fill(v);

  it("returns null for mono saved as stereo", () => {
    const s = Array.from({ length: 1000 }, (_, i) => Math.sin(i / 10));
    expect(stereoPan(s, s, sr, [500_000])).toBeNull();
    // A tiny difference (under 0.1% of the energy) still counts as mono.
    expect(stereoPan(s, s.map((v) => v * 0.99), sr, [500_000])).toBeNull();
  });

  it("returns null when both channels are silent", () => {
    expect(stereoPan(constant(100, 0), constant(100, 0), sr, [0])).toBeNull();
  });

  it("gives -1 for sound only on the left and 1 only on the right", () => {
    const left = [...constant(500, 0.5), ...constant(500, 0)];
    const right = [...constant(500, 0), ...constant(500, 0.5)];
    expect(stereoPan(left, right, sr, [200_000, 800_000])).toEqual([-1, 1]);
  });

  it("weighs the energy of each side", () => {
    // Left at amplitude 0.6 (energy 0.36), right at 0.8 (energy 0.64): (0.64 - 0.36) / 1.
    const pan = stereoPan(constant(1000, 0.6), constant(1000, 0.8), sr, [500_000])!;
    expect(pan[0]).toBeCloseTo(0.28, 12);
  });

  it("reads 100 ms on each side of the time and gives 0 for silence", () => {
    // Right speaks from 0.5 s; at 0.45 s the window [0.35, 0.55) holds 50 ms of it.
    const left = constant(1000, 0);
    const right = [...constant(500, 0), ...constant(500, 0.5)];
    left[0] = 0.5; // not mono
    expect(stereoPan(left, right, sr, [200_000, 450_000])).toEqual([0, 1]);
  });

  it("clips the window at both ends of the audio", () => {
    const left = constant(100, 0.5);
    const right = constant(100, 0);
    expect(stereoPan(left, right, sr, [0, 100_000, 5_000_000])).toEqual([-1, -1, 0]);
  });

  it("rejects bad input", () => {
    expect(code(() => stereoPan([1], [1, 2], sr, []))).toBe("INVALID_RANGE");
    expect(code(() => stereoPan([1], [0], 0, []))).toBe("INVALID_RANGE");
    expect(code(() => stereoPan([1], [0], sr, [1.5]))).toBe("INVALID_RANGE");
    expect(code(() => stereoPan([1], [0], sr, [-1]))).toBe("INVALID_RANGE");
  });
});
