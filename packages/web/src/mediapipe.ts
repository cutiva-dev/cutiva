import { CutivaError, type PlanFace } from "@cutiva/core";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { faceTiles, mergeFaces, type Box } from "./face-tiles.js";
import type { FaceDetector } from "./reframe.js";

/** The `@mediapipe/tasks-vision` version this adapter is built and tested against. */
export const MEDIAPIPE_VERSION = "1.1.1";

const DEFAULT_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const DEFAULT_MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
/** SHA-256 of `face_landmarker.task` (float16, version 1, 3,758,596 bytes, Apache-2.0). */
export const MEDIAPIPE_MODEL_SHA256 = "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff";
/** Downloaded models are kept in this Cache Storage bucket, checked against their hash on every load. */
const CACHE_NAME = "cutiva-models";

export interface MediaPipeFaceDetectorOptions {
  /** Folder with MediaPipe's WASM files. Defaults to jsDelivr; host them yourself to avoid the CDN. */
  wasmBaseUrl?: string;
  /** URL of `face_landmarker.task`. Defaults to Google's model storage. */
  modelAssetPath?: string;
  /** Hex SHA-256 the model must have. Defaults to the pinned `MEDIAPIPE_MODEL_SHA256`; set it when you host another model. */
  modelSha256?: string;
  /** Most faces to find per frame. Default 6. */
  maxFaces?: number;
  /** Model download progress, 0 to 1. Not called when the model comes from the cache. */
  onProgress?: (ratio: number) => void;
  /**
   * Also look for faces in overlapping square tiles, each two thirds of the frame's shorter side.
   * MediaPipe shrinks every image to 192 px before finding faces, so in a wide shot (a table of
   * three, faces about a tenth of the height) it finds none in the whole frame. Default true.
   */
  tiles?: boolean;
}


export interface MediaPipeFaceDetector extends FaceDetector {
  close(): void;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function openCache(): Promise<Cache | null> {
  try {
    return typeof caches !== "undefined" ? await caches.open(CACHE_NAME) : null;
  } catch {
    // Cache Storage needs a secure context and can be blocked; download every time then.
    return null;
  }
}

async function download(url: string, onProgress?: (ratio: number) => void): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const total = Number(response.headers.get("content-length")) || 0;
  if (!response.body || !onProgress || !total) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(Math.min(1, received / total));
  }
  const bytes = new Uint8Array(received);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  return bytes;
}

/**
 * The model's bytes, from the cache when a copy there still has the expected hash, else downloaded
 * and checked. Throws MODEL_LOAD_FAILED when the download fails or the hash doesn't match.
 */
export async function loadModel(url: string, expectedSha256: string, onProgress?: (ratio: number) => void): Promise<Uint8Array> {
  const expected = expectedSha256.toLowerCase();
  const cache = await openCache();
  const cached = await cache?.match(url).catch(() => undefined);
  if (cached) {
    const bytes = new Uint8Array(await cached.arrayBuffer());
    if ((await sha256(bytes)) === expected) return bytes;
    await cache!.delete(url).catch(() => false);
  }
  let bytes: Uint8Array;
  try {
    bytes = await download(url, onProgress);
  } catch (e) {
    throw new CutivaError("MODEL_LOAD_FAILED", `Couldn't download the face model from ${url}: ${(e as Error).message}`);
  }
  const got = await sha256(bytes);
  if (got !== expected) throw new CutivaError("MODEL_LOAD_FAILED", `The face model from ${url} has SHA-256 ${got}, expected ${expected}.`);
  await cache?.put(url, new Response(bytes.slice())).catch(() => undefined);
  return bytes;
}

/**
 * A face detector on MediaPipe Face Landmarker (Apache-2.0). Install `@mediapipe/tasks-vision`
 * yourself; it is an optional peer dependency. The model (about 3.7 MB) downloads on first use, is
 * checked against a pinned SHA-256 and kept in Cache Storage; video frames never leave the device.
 * Mouth openness is the gap between the inner lips over the face's height (0 closed, about 0.3
 * wide open); MediaPipe gives no per-face confidence. Throws
 * MODEL_LOAD_FAILED when the model or the WASM runtime can't be loaded.
 */
export async function createMediaPipeFaceDetector(options: MediaPipeFaceDetectorOptions = {}): Promise<MediaPipeFaceDetector> {
  const model = await loadModel(options.modelAssetPath ?? DEFAULT_MODEL, options.modelSha256 ?? MEDIAPIPE_MODEL_SHA256, options.onProgress);
  let landmarker: FaceLandmarker;
  try {
    const fileset = await FilesetResolver.forVisionTasks(options.wasmBaseUrl ?? DEFAULT_WASM);
    const create = (delegate: "GPU" | "CPU") =>
      FaceLandmarker.createFromOptions(fileset, {
        // MediaPipe may take ownership of the buffer, so each attempt gets its own copy.
        baseOptions: { modelAssetBuffer: model.slice(), delegate },
        runningMode: "IMAGE",
        numFaces: options.maxFaces ?? 6,
        outputFaceBlendshapes: false,
      });
    landmarker = await create("GPU").catch(() => create("CPU"));
  } catch (e) {
    throw new CutivaError("MODEL_LOAD_FAILED", `MediaPipe didn't start: ${(e as Error).message}`);
  }
  /** Faces in one image, placed at (ox, oy) in the frame. */
  const facesIn = (image: HTMLCanvasElement | OffscreenCanvas, ox: number, oy: number): Box[] => {
    const result = landmarker.detect(image);
    return result.faceLandmarks.map((points) => {
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
      const h = (maxY - minY) * image.height;
      // Inner lips: landmark 13 (upper) and 14 (lower). Their distance over the face's height moves
      // clearly with speech even on small faces, where the jawOpen blendshape stays near zero.
      const upper = points[13];
      const lower = points[14];
      const gap = upper && lower ? Math.hypot((upper.x - lower.x) * image.width, (upper.y - lower.y) * image.height) : 0;
      return { x: ox + minX * image.width, y: oy + minY * image.height, w: (maxX - minX) * image.width, h, mouth: h > 0 ? Math.min(1, gap / h) : 0 };
    });
  };
  let tile: OffscreenCanvas | HTMLCanvasElement | null = null;
  return {
    detect(frame) {
      const boxes = facesIn(frame, 0, 0);
      if (options.tiles !== false) {
        for (const t of faceTiles(frame.width, frame.height)) {
          tile ??= typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(t.size, t.size) : Object.assign(document.createElement("canvas"), { width: t.size, height: t.size });
          if (tile.width !== t.size) Object.assign(tile, { width: t.size, height: t.size });
          const ctx = tile.getContext("2d") as CanvasRenderingContext2D | null;
          if (!ctx) break;
          ctx.drawImage(frame, t.x, t.y, t.size, t.size, 0, 0, t.size, t.size);
          boxes.push(...facesIn(tile, t.x, t.y));
        }
      }
      return mergeFaces(boxes).map((b): PlanFace => ({ ...b }));
    },
    close: () => landmarker.close(),
  };
}
