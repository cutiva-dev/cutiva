import type { CropLayout, CropRect } from "@cutiva/core";

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Source = CanvasImageSource & { width: number; height: number };

/** Width the wide layout's background is shrunk to before it is stretched back: the blur. */
const BLUR_W = 32;
/** How much the wide layout's background is darkened, so the picture on top stands out. */
const BLUR_DIM = 0.35;

/** Draw a source into the frame, letterboxed ("contain"), centered. */
export function drawContain(ctx: Ctx2D, source: Source, frameW: number, frameH: number): void {
  const scale = Math.min(frameW / source.width, frameH / source.height);
  const w = source.width * scale;
  const h = source.height * scale;
  ctx.drawImage(source, (frameW - w) / 2, (frameH - h) / 2, w, h);
}

const blurCanvases = new WeakMap<Ctx2D, { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: Ctx2D }>();

function smallCanvas(ctx: Ctx2D, w: number, h: number): { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: Ctx2D } | null {
  let entry = blurCanvases.get(ctx);
  if (!entry) {
    const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
    const c = canvas.getContext("2d") as Ctx2D | null;
    if (!c) return null;
    entry = { canvas, ctx: c };
    blurCanvases.set(ctx, entry);
  }
  if (entry.canvas.width !== w || entry.canvas.height !== h) Object.assign(entry.canvas, { width: w, height: h });
  return entry;
}

/**
 * The wide layout: `area` (in source pixels, already scaled by `sx`, `sy`) fitted whole inside the
 * frame, over a blurred, darkened copy of it that covers the frame. The blur shrinks the picture to
 * 32 px wide and stretches it back, which looks the same in every browser (no canvas `filter`).
 */
function drawWide(ctx: Ctx2D, source: Source, frameW: number, frameH: number, area: CropRect, sx: number, sy: number): void {
  const ax = area.x * sx;
  const ay = area.y * sy;
  const aw = area.w * sx;
  const ah = area.h * sy;
  // Background: the part of the area with the frame's aspect, centred ("cover").
  const frameAspect = frameW / frameH;
  const cw = aw / ah > frameAspect ? ah * frameAspect : aw;
  const ch = aw / ah > frameAspect ? ah : aw / frameAspect;
  const bw = BLUR_W;
  const bh = Math.max(1, Math.round((BLUR_W * frameH) / frameW));
  const small = smallCanvas(ctx, bw, bh);
  if (small) {
    small.ctx.imageSmoothingEnabled = true;
    small.ctx.imageSmoothingQuality = "high";
    small.ctx.drawImage(source, ax + (aw - cw) / 2, ay + (ah - ch) / 2, cw, ch, 0, 0, bw, bh);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(small.canvas, 0, 0, bw, bh, 0, 0, frameW, frameH);
    ctx.fillStyle = `rgba(0, 0, 0, ${BLUR_DIM})`;
    ctx.fillRect(0, 0, frameW, frameH);
    ctx.restore();
  }
  // Foreground: the whole area, letterboxed.
  const scale = Math.min(frameW / aw, frameH / ah);
  const w = aw * scale;
  const h = ah * scale;
  ctx.drawImage(source, ax, ay, aw, ah, (frameW - w) / 2, (frameH - h) / 2, w, h);
}

/**
 * Draw one resolved video layer. With a crop (in the asset's pixels, `assetW` wide), that part of
 * the source fills the frame; with a `split` layout, its two regions fill the top and bottom halves;
 * with a `wide` layout, its area is fitted whole over a blurred copy. Without a crop, the whole
 * source is letterboxed. Preview and export both draw through this, so they always agree.
 */
export function drawLayer(
  ctx: Ctx2D,
  source: Source,
  frameW: number,
  frameH: number,
  crop: CropRect | undefined,
  assetW: number | undefined,
  assetH: number | undefined,
  layout?: CropLayout,
): void {
  if (!crop || !assetW || !assetH) return drawContain(ctx, source, frameW, frameH);
  const sx = source.width / assetW;
  const sy = source.height / assetH;
  if (layout?.kind === "wide") return drawWide(ctx, source, frameW, frameH, layout.area, sx, sy);
  if (layout?.kind === "split") {
    const topH = Math.round(frameH / 2);
    const [top, bottom] = layout.regions;
    ctx.drawImage(source, top.x * sx, top.y * sy, top.w * sx, top.h * sy, 0, 0, frameW, topH);
    ctx.drawImage(source, bottom.x * sx, bottom.y * sy, bottom.w * sx, bottom.h * sy, 0, topH, frameW, frameH - topH);
    return;
  }
  ctx.drawImage(source, crop.x * sx, crop.y * sy, crop.w * sx, crop.h * sy, 0, 0, frameW, frameH);
}
