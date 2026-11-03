// A stand-in face detector for fixtures/talk.mp4 (see reframe-editor.spec.ts): it reads the two
// coloured "faces" and their flickering white "mouths" from the pixels, so analysis is deterministic.
// Pass it to page.addInitScript; the playground uses window.__cutivaFaceDetector instead of MediaPipe.

/** The playground uses `window.__cutivaFaceDetector` instead of MediaPipe when it is set. */
export function installFakeDetector() {
  const faces = [
    { x: 390, mouthX: 540 },
    { x: 1230, mouthX: 1380 },
  ];
  (window as unknown as { __cutivaFaceDetector: unknown }).__cutivaFaceDetector = {
    detect(frame: HTMLCanvasElement | OffscreenCanvas) {
      const s = frame.width / 1920;
      const copy = new OffscreenCanvas(frame.width, frame.height);
      const ctx = copy.getContext("2d")!;
      ctx.drawImage(frame, 0, 0);
      return faces.map((f) => {
        const px = ctx.getImageData(Math.round(f.mouthX * s), Math.round(532 * s), 1, 1).data;
        return { x: f.x * s, y: 300 * s, w: 300 * s, h: 300 * s, mouth: px[1]! > 200 ? 0.4 : 0.1 };
      });
    },
  };
}

