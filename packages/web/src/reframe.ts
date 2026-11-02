import {
  autoReframe,
  CutivaError,
  detectCuts,
  findClip,
  type AutoReframeResult,
  type Editor,
  type FaceObservation,
  type FrameHistogram,
  type FrameObservation,
  type Us,
} from "@cutiva/core";
import { CanvasSink } from "mediabunny";
import type { MediaRegistry } from "./media.js";

/** Finds faces in one frame. `@cutiva/web/mediapipe` has one built on MediaPipe; any other works. */
export interface FaceDetector {
  /** Faces in `frame`, in the frame's own pixels, with how open each mouth is (0 to 1). */
  detect(frame: HTMLCanvasElement | OffscreenCanvas): FaceObservation[] | Promise<FaceObservation[]>;
}

export interface AnalyzeOptions {
  detector: FaceDetector;
  /** Frames analysed per second of source. Default 5. */
  fps?: number;
  /** Frames are scaled to this width for detection. Default 640. */
  width?: number;
  /** Part of the source to analyse. Defaults to all of it. */
  sourceInUs?: Us;
  sourceOutUs?: Us;
  onProgress?: (ratio: number) => void;
  signal?: AbortSignal;
}

/** What the analysis saw: the input `autoReframe` needs, kept so it can be re-run with other settings. */
export interface ReframeAnalysis {
  assetId: string;
  durationUs: Us;
  frames: FrameObservation[];
  cuts: Us[];
}

const HIST_W = 32;
const HIST_H = 18;
const HIST_BINS = 16;
/** Speech loudness is measured over this many seconds on each side of a frame. */
const VOICE_WINDOW_S = 0.1;

function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  return typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
}

/** 16 bins each for red, green and blue, from a 32x18 thumbnail. */
function histogram(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, frame: CanvasImageSource): number[] {
  ctx.drawImage(frame, 0, 0, HIST_W, HIST_H);
  const { data } = ctx.getImageData(0, 0, HIST_W, HIST_H);
  const bins = new Array<number>(HIST_BINS * 3).fill(0);
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) bins[c * HIST_BINS + ((data[i + c]! * HIST_BINS) >> 8)]!++;
  }
  return bins;
}

/** Loudness around each time, relative to the 90th percentile of the clip, from 0 to 1. */
function voiceLevels(buffer: AudioBuffer, timesUs: Us[]): number[] {
  const data = buffer.getChannelData(0);
  const half = Math.round(VOICE_WINDOW_S * buffer.sampleRate);
  const rms = timesUs.map((t) => {
    const mid = Math.round((t / 1e6) * buffer.sampleRate);
    const from = Math.max(0, mid - half);
    const to = Math.min(data.length, mid + half);
    let sum = 0;
    for (let i = from; i < to; i++) sum += data[i]! * data[i]!;
    return to > from ? Math.sqrt(sum / (to - from)) : 0;
  });
  const sorted = [...rms].sort((a, b) => a - b);
  const ref = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
  return rms.map((r) => (ref > 0 ? Math.min(1, r / ref) : 0));
}

/**
 * Decode a video asset at a few frames per second and record faces, mouth movement, speech
 * loudness and camera cuts. This is the slow part of auto-reframe; the result can be kept and fed
 * to `autoReframe` again with other settings.
 */
export async function analyzeAsset(media: MediaRegistry, assetId: string, options: AnalyzeOptions): Promise<ReframeAnalysis> {
  const entry = media.get(assetId);
  if (!entry?.video) throw new CutivaError("ASSET_NOT_FOUND", `Video for asset "${assetId}" is not loaded.`);
  const video = entry.video;
  const durationUs = entry.asset.durationUs;
  const fps = options.fps ?? 5;
  const from = options.sourceInUs ?? 0;
  const to = Math.min(options.sourceOutUs ?? durationUs, durationUs);
  const stepUs = Math.round(1e6 / fps);
  const timesUs: Us[] = [];
  for (let t = from; t < to; t += stepUs) timesUs.push(t);

  const width = Math.min(options.width ?? 640, video.displayWidth);
  const height = Math.max(1, Math.round((width * video.displayHeight) / video.displayWidth));
  const scale = video.displayWidth / width;
  const sink = new CanvasSink(video, { width, height, fit: "fill", poolSize: 1 });
  const thumb = makeCanvas(HIST_W, HIST_H);
  const thumbCtx = thumb.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!thumbCtx) throw new Error("Canvas 2D context is not available.");

  const frames: FrameObservation[] = [];
  const histograms: FrameHistogram[] = [];
  let i = 0;
  const iterator = sink.canvasesAtTimestamps(timesUs.map((t) => t / 1e6));
  try {
    for await (const wrapped of iterator) {
      if (options.signal?.aborted) throw new CutivaError("ANALYSIS_CANCELLED", "Analysis was cancelled.");
      const atUs = timesUs[i++]!;
      if (!wrapped) continue;
      const faces = await options.detector.detect(wrapped.canvas);
      frames.push({
        atUs,
        faces: faces.map((f) => ({ x: f.x * scale, y: f.y * scale, w: f.w * scale, h: f.h * scale, mouth: f.mouth })),
      });
      histograms.push({ atUs, bins: histogram(thumbCtx, wrapped.canvas) });
      options.onProgress?.(i / timesUs.length);
    }
  } finally {
    await iterator.return(undefined);
  }

  if (entry.audio && typeof OfflineAudioContext !== "undefined") {
    const buffer = await media.audioBuffer(entry, new OfflineAudioContext(1, 1, 48_000));
    if (buffer) {
      const levels = voiceLevels(buffer, frames.map((f) => f.atUs));
      frames.forEach((f, k) => (f.voice = levels[k]));
    }
  }
  return { assetId, durationUs, frames, cuts: detectCuts(histograms) };
}

export interface AutoReframeOptions extends Omit<AnalyzeOptions, "sourceInUs" | "sourceOutUs"> {
  /** Reuse an earlier analysis of the clip's asset instead of decoding again. */
  analysis?: ReframeAnalysis;
  /** 1 (default) uses the full source height; 2 shows half of it. */
  zoom?: number;
  /** Shortest time on one speaker before switching. Default 1.5 s. */
  minHoldUs?: Us;
}

export interface AutoReframeClipResult extends AutoReframeResult {
  analysis: ReframeAnalysis;
}

/**
 * Frame a video clip on whoever is talking, for the project's aspect ratio (set 1080x1920 for 9:16
 * first). Analyses the clip's part of the source, plans the crop keys with `autoReframe`, and
 * applies them as one undoable `clip.setReframe`.
 */
export async function autoReframeClip(editor: Editor, media: MediaRegistry, clipId: string, options: AutoReframeOptions): Promise<AutoReframeClipResult> {
  const { clip } = findClip(editor.project, clipId);
  const asset = editor.project.assets.find((a) => a.id === clip.assetId);
  if (!asset?.width || !asset.height) throw new CutivaError("ASSET_SIZE_UNKNOWN", `Clip "${clipId}" has no video size to reframe.`);
  const analysis =
    options.analysis?.assetId === asset.id
      ? options.analysis
      : await analyzeAsset(media, asset.id, { ...options, sourceInUs: clip.sourceInUs, sourceOutUs: clip.sourceOutUs });
  const { width, height } = editor.project.settings;
  const result = autoReframe({
    sourceWidth: asset.width,
    sourceHeight: asset.height,
    outputWidth: width,
    outputHeight: height,
    durationUs: analysis.durationUs,
    frames: analysis.frames,
    cuts: analysis.cuts,
    ...(options.zoom !== undefined ? { zoom: options.zoom } : {}),
    ...(options.minHoldUs !== undefined ? { minHoldUs: options.minHoldUs } : {}),
  });
  editor.dispatch({ type: "clip.setReframe", clipId, keys: result.keys });
  return { ...result, analysis };
}
