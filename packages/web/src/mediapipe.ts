import type { FaceObservation } from "@cutiva/core";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import type { FaceDetector } from "./reframe.js";

/** The `@mediapipe/tasks-vision` version this adapter is built and tested against. */
export const MEDIAPIPE_VERSION = "1.1.1";

const DEFAULT_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const DEFAULT_MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

export interface MediaPipeFaceDetectorOptions {
  /** Folder with MediaPipe's WASM files. Defaults to jsDelivr; host them yourself to avoid the CDN. */
  wasmBaseUrl?: string;
  /** URL of `face_landmarker.task`. Defaults to Google's model storage. */
  modelAssetPath?: string;
  /** Most faces to find per frame. Default 6. */
  maxFaces?: number;
}

export interface MediaPipeFaceDetector extends FaceDetector {
  close(): void;
}

/**
 * A face detector on MediaPipe Face Landmarker (Apache-2.0). Install `@mediapipe/tasks-vision`
 * yourself; it is an optional peer dependency. The model and WASM files download on first use
 * (about 4 MB); video frames never leave the device. Mouth openness is the `jawOpen` blendshape.
 */
export async function createMediaPipeFaceDetector(options: MediaPipeFaceDetectorOptions = {}): Promise<MediaPipeFaceDetector> {
  const fileset = await FilesetResolver.forVisionTasks(options.wasmBaseUrl ?? DEFAULT_WASM);
  const create = (delegate: "GPU" | "CPU") =>
    FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: options.modelAssetPath ?? DEFAULT_MODEL, delegate },
      runningMode: "IMAGE",
      numFaces: options.maxFaces ?? 6,
      outputFaceBlendshapes: true,
    });
  const landmarker = await create("GPU").catch(() => create("CPU"));
  return {
    detect(frame) {
      const result = landmarker.detect(frame);
      return result.faceLandmarks.map((points, i): FaceObservation => {
        let minX = 1;
        let minY = 1;
        let maxX = 0;
        let maxY = 0;
        for (const p of points) {
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x);
          maxY = Math.max(maxY, p.y);
        }
        const jaw = result.faceBlendshapes[i]?.categories.find((c) => c.categoryName === "jawOpen")?.score ?? 0;
        return { x: minX * frame.width, y: minY * frame.height, w: (maxX - minX) * frame.width, h: (maxY - minY) * frame.height, mouth: jaw };
      });
    },
    close: () => landmarker.close(),
  };
}
