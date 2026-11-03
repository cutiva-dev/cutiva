import {
  autoReframe,
  CutivaError,
  detectActiveArea,
  detectCuts,
  findClip,
  stereoPan,
  type AutoReframeResult,
  type CropRect,
  type Editor,
  type FrameHistogram,
  type PlanFace,
  type PlanFrame,
  type Us,
} from "@cutiva/core";
import { CanvasSink } from "mediabunny";
import type { MediaRegistry } from "./media.js";

/** Finds faces in one frame. `@cutiva/web/mediapipe` has one built on MediaPipe; any other works. */
export interface FaceDetector {
  /**
   * Faces in `frame`, in the frame's own pixels, with how open each mouth is (0 to 1, or null when
   * it can't be seen) and, if the detector has one, a confidence (0 to 1).
   */
  detect(frame: HTMLCanvasElement | OffscreenCanvas): PlanFace[] | Promise<PlanFace[]>;
}

/** What `analyzeAsset` is doing: decoding frames and finding faces, then reading the audio. */
export type AnalyzeStage = "video" | "audio";

export interface AnalyzeOptions {
  detector: FaceDetector;
  /** Frames analysed per second of source. Default 5. */
  fps?: number;
  /** Frames are scaled to this width for detection. Default 640. */
  width?: number;
  /** Part of the source to analyse. Defaults to all of it. */
  sourceInUs?: Us;
  sourceOutUs?: Us;
  /** Overall progress from 0 to 1, and the stage it is in. */
  onProgress?: (ratio: number, stage: AnalyzeStage) => void;
  signal?: AbortSignal;
}

/**
 * What the analysis saw: the input `planReframe` (and the older `autoReframe`) needs, kept so it can
 * be re-run with other settings. Numbers only: no images or audio.
 */
export interface ReframeAnalysis {
  assetId: string;
  durationUs: Us;
  /** Faces in source pixels (display orientation, square pixels), speech level and stereo pan. */
  frames: PlanFrame[];
  cuts: Us[];
  /** The picture inside burned-in black bars, in source pixels. Absent when there are none. */
  activeArea?: CropRect;
}

const HIST_W = 32;
const HIST_H = 18;
const HIST_BINS = 16;
/** Speech loudness is measured over this many seconds on each side of a frame. */
const VOICE_WINDOW_S = 0.1;
/** Width of the picture black bars are looked for in; 6 px of a 1080p source per pixel. */
const BARS_W = 320;
/** Share of the progress bar the video stage takes when there is audio to read after it. */
const VIDEO_SHARE = 0.9;

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

/** Keep, for each pixel, the brightest luma (BT.601 weights) seen so far. */
function addPeak(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, frame: CanvasImageSource, peak: Uint8Array, w: number, h: number): void {
  ctx.drawImage(frame, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  for (let p = 0, i = 0; p < peak.length; p++, i += 4) {
    const y = (77 * data[i]! + 150 * data[i + 1]! + 29 * data[i + 2]!) >> 8;
    if (y > peak[p]!) peak[p] = y;
  }
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
 * loudness and stereo pan, camera cuts and burned-in black bars. This is the slow part of
 * auto-reframe; the result can be kept and planned again with other settings. Sizes come from the
 * track's display size, so rotation metadata and non-square pixels are already applied.
 * Throws ASSET_NOT_FOUND when the asset's media isn't loaded, NO_VIDEO_TRACK when it has no video,
 * ANALYSIS_CANCELLED when `signal` aborts.
 */
export async function analyzeAsset(media: MediaRegistry, assetId: string, options: AnalyzeOptions): Promise<ReframeAnalysis> {
  const entry = media.get(assetId);
  if (!entry) throw new CutivaError("ASSET_NOT_FOUND", `Media for asset "${assetId}" is not loaded.`);
  if (!entry.video) throw new CutivaError("NO_VIDEO_TRACK", `Asset "${assetId}" has no video track to analyse.`);
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
  const barsW = Math.min(BARS_W, width);
  const barsH = Math.max(1, Math.round((barsW * height) / width));
  const bars = makeCanvas(barsW, barsH);
  const barsCtx = bars.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!barsCtx) throw new Error("Canvas 2D context is not available.");
  const peak = new Uint8Array(barsW * barsH);
  const hasAudio = entry.audio !== null && typeof OfflineAudioContext !== "undefined";
  const videoShare = hasAudio ? VIDEO_SHARE : 1;
  const cancelled = () => new CutivaError("ANALYSIS_CANCELLED", "Analysis was cancelled.");

  const frames: PlanFrame[] = [];
  const histograms: FrameHistogram[] = [];
  let i = 0;
  const iterator = sink.canvasesAtTimestamps(timesUs.map((t) => t / 1e6));
  try {
    for await (const wrapped of iterator) {
      if (options.signal?.aborted) throw cancelled();
      const atUs = timesUs[i++]!;
      if (!wrapped) continue;
      const faces = await options.detector.detect(wrapped.canvas);
      frames.push({
        atUs,
        faces: faces.map((f) => ({
          x: f.x * scale,
          y: f.y * scale,
          w: f.w * scale,
          h: f.h * scale,
          mouth: f.mouth,
          ...(f.conf !== undefined ? { conf: f.conf } : {}),
        })),
      });
      histograms.push({ atUs, bins: histogram(thumbCtx, wrapped.canvas) });
      addPeak(barsCtx, wrapped.canvas, peak, barsW, barsH);
      options.onProgress?.((i / timesUs.length) * videoShare, "video");
    }
  } finally {
    await iterator.return(undefined);
  }

  if (hasAudio) {
    if (options.signal?.aborted) throw cancelled();
    options.onProgress?.(videoShare, "audio");
    const buffer = await media.audioBuffer(entry, new OfflineAudioContext(1, 1, 48_000));
    if (buffer) {
      const times = frames.map((f) => f.atUs);
      const levels = voiceLevels(buffer, times);
      // decodeAudioData keeps the file's channels; pan needs two that differ.
      const pan = buffer.numberOfChannels >= 2 ? stereoPan(buffer.getChannelData(0), buffer.getChannelData(1), buffer.sampleRate, times) : null;
      frames.forEach((f, k) => {
        f.voice = levels[k];
        if (pan) f.pan = pan[k];
      });
    }
    options.onProgress?.(1, "audio");
  }
  const activeArea = frames.length ? detectActiveArea({ width: barsW, height: barsH, luma: peak }, video.displayWidth, video.displayHeight) : null;
  return { assetId, durationUs, frames, cuts: detectCuts(histograms), ...(activeArea ? { activeArea } : {}) };
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
    // The older planner needs a mouth number on every face and knows nothing of pan or confidence.
    frames: analysis.frames.map((f) => ({
      atUs: f.atUs,
      faces: f.faces.map((face) => ({ x: face.x, y: face.y, w: face.w, h: face.h, mouth: face.mouth ?? 0 })),
      ...(f.voice !== undefined ? { voice: f.voice } : {}),
    })),
    cuts: analysis.cuts,
    ...(options.zoom !== undefined ? { zoom: options.zoom } : {}),
    ...(options.minHoldUs !== undefined ? { minHoldUs: options.minHoldUs } : {}),
  });
  editor.dispatch({ type: "clip.setReframe", clipId, keys: result.keys });
  return { ...result, analysis };
}
