type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Draw a source into the frame, letterboxed ("contain"), centered. */
export function drawContain(
  ctx: Ctx2D,
  source: CanvasImageSource & { width: number; height: number },
  frameW: number,
  frameH: number,
): void {
  const scale = Math.min(frameW / source.width, frameH / source.height);
  const w = source.width * scale;
  const h = source.height * scale;
  ctx.drawImage(source, (frameW - w) / 2, (frameH - h) / 2, w, h);
}
