import type { CropRect } from "@cutiva/core";

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Source = CanvasImageSource & { width: number; height: number };

/** Draw a source into the frame, letterboxed ("contain"), centered. */
export function drawContain(ctx: Ctx2D, source: Source, frameW: number, frameH: number): void {
  const scale = Math.min(frameW / source.width, frameH / source.height);
  const w = source.width * scale;
  const h = source.height * scale;
  ctx.drawImage(source, (frameW - w) / 2, (frameH - h) / 2, w, h);
}

/**
 * Draw one resolved video layer. With a crop (in the asset's pixels, `assetW` wide), that part of
 * the source fills the frame; without one, the whole source is letterboxed. Preview and export both
 * draw through this, so they always agree.
 */
export function drawLayer(ctx: Ctx2D, source: Source, frameW: number, frameH: number, crop: CropRect | undefined, assetW: number | undefined, assetH: number | undefined): void {
  if (!crop || !assetW || !assetH) return drawContain(ctx, source, frameW, frameH);
  const sx = source.width / assetW;
  const sy = source.height / assetH;
  ctx.drawImage(source, crop.x * sx, crop.y * sy, crop.w * sx, crop.h * sy, 0, 0, frameW, frameH);
}
