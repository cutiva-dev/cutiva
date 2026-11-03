import { describe, expect, it } from "vitest";
import { faceTiles, mergeFaces } from "../src/face-tiles.js";

describe("faceTiles", () => {
  it("covers a 16:9 frame with 4 x 2 squares two thirds of its height, edge to edge", () => {
    const tiles = faceTiles(640, 360);
    expect(tiles.map((t) => [t.x, t.y])).toEqual([
      [0, 0], [133, 0], [267, 0], [400, 0],
      [0, 120], [133, 120], [267, 120], [400, 120],
    ]);
    expect(new Set(tiles.map((t) => t.size))).toEqual(new Set([240]));
  });

  it("overlaps neighbours by at least a third of a tile, so a face up to that size fits whole in one", () => {
    for (const [w, h] of [[1280, 720], [1080, 1920], [1440, 1080], [3840, 2160]] as const) {
      const tiles = faceTiles(w, h);
      const size = tiles[0]!.size;
      const xs = [...new Set(tiles.map((t) => t.x))];
      const ys = [...new Set(tiles.map((t) => t.y))];
      for (const list of [xs, ys]) for (let i = 1; i < list.length; i++) expect(list[i]! - list[i - 1]!).toBeLessThanOrEqual(Math.ceil((size * 2) / 3));
      expect(Math.max(...xs) + size).toBe(w);
      expect(Math.max(...ys) + size).toBe(h);
    }
  });

  it("uses one row or column when the frame is square", () => {
    expect(faceTiles(900, 900).map((t) => [t.x, t.y])).toEqual([
      [0, 0], [300, 0], [0, 300], [300, 300],
    ]);
  });
});

describe("mergeFaces", () => {
  const box = (x: number, y: number, w: number, h: number, mouth = 0) => ({ x, y, w, h, mouth });

  it("keeps one box per face, the largest, when tiles see it twice or cut it", () => {
    const whole = box(100, 100, 50, 60, 0.1);
    const cut = box(100, 100, 30, 60, 0.2); // the same face cut by a tile's edge
    const shifted = box(102, 99, 49, 61); // the same face from an overlapping tile
    const other = box(300, 100, 50, 60);
    expect(mergeFaces([cut, other, shifted, whole]).sort((a, b) => a.x - b.x)).toEqual([whole, other]);
  });

  it("keeps faces that only touch", () => {
    expect(mergeFaces([box(0, 0, 10, 10), box(9, 0, 10, 10)])).toHaveLength(2);
  });
});
