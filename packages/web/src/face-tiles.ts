// Tiling for face detectors that shrink the whole image (MediaPipe: 192 px), so small faces in a wide
// shot are found; and merging the same face seen in two tiles.

/** A face box in frame pixels with its mouth openness. */
export type Box = { x: number; y: number; w: number; h: number; mouth: number };

const iou = (a: Box, b: Box): number => {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  return inter / (a.w * a.h + b.w * b.h - inter);
};

/** Share of the smaller box that lies inside the larger one. */
const covered = (a: Box, b: Box): number => {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return (ix * iy) / Math.min(a.w * a.h, b.w * b.h);
};

/**
 * One face per person: boxes that overlap (IoU 0.3, or the smaller half inside the larger) are the
 * same face seen in two tiles; the largest box wins, since a face cut by a tile's edge is smaller.
 */
export function mergeFaces(boxes: Box[]): Box[] {
  const out: Box[] = [];
  for (const b of [...boxes].sort((p, q) => q.w * q.h - p.w * p.h)) {
    if (!out.some((o) => iou(o, b) >= 0.3 || covered(o, b) >= 0.5)) out.push(b);
  }
  return out;
}

/**
 * Overlapping square tiles over a frame: side two thirds of the shorter side, spread evenly from
 * edge to edge at most two thirds of a side apart, so any face up to a third of a tile fits whole
 * in one of them. A 16:9 frame gets 4 × 2 tiles.
 */
export function faceTiles(width: number, height: number): { x: number; y: number; size: number }[] {
  const size = Math.round((Math.min(width, height) * 2) / 3);
  const starts = (len: number) => {
    const span = Math.max(0, len - size);
    const count = Math.ceil(span / ((size * 2) / 3)) + 1;
    return Array.from({ length: count }, (_, i) => (count === 1 ? 0 : Math.round((i * span) / (count - 1))));
  };
  return starts(height).flatMap((y) => starts(width).map((x) => ({ x, y, size })));
}
