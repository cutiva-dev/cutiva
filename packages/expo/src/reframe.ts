import type { ReframeEdit, ReframeKey, ReframeTrack, PlanSighting, Project } from "@cutiva/core";
import { toAnalysis, type NativeMeasurements, type ReframeAnalysis } from "./measurements.js";
import { cutivaNative, type NativeProgress } from "./native.js";
import { planVideo, reframedProject, type PlanOptions } from "./plan.js";

export type ReframeStage = NativeProgress["stage"];

export interface AnalyzeVideoOptions {
  /** Frames analysed per second. Default 5. */
  fps?: number;
  /** Part of the video to analyse, in microseconds. Defaults to all of it. */
  fromUs?: number;
  toUs?: number;
  /** Overall progress of this step, 0 to 1, and its stage: `model` (first run only), `video`, `audio`. */
  onProgress?: (ratio: number, stage: ReframeStage) => void;
  /** Aborting rejects with code `ANALYSIS_CANCELLED`. */
  signal?: AbortSignal;
}

export interface ReframeVideoOptions extends PlanOptions, Omit<AnalyzeVideoOptions, "onProgress"> {
  /** Reuse the analysis of an earlier result: re-plans and exports without analysing again. */
  analysis?: ReframeAnalysis;
  /** Where to write the MP4 (a file path or `file://` URI). Default: a new file in the app's cache. */
  outputUri?: string;
  /** Overall progress, 0 to 1: analysis (90%, when it runs) then export. */
  onProgress?: (ratio: number, stage: ReframeStage) => void;
}

export interface ReframeVideoResult {
  /** The vertical MP4, as a `file://` URI. */
  uri: string;
  /** Who speaks when and which shot each segment uses; pass it back with `edits` to correct it. */
  track: ReframeTrack;
  keys: ReframeKey[];
  /** Where each person's face was seen, for avatars or tap-to-focus (not stored). */
  sightings: PlanSighting[];
  /** The source already had the output's shape: the video is only re-encoded. */
  passthrough: boolean;
  /** Keep it to re-plan with `reframeVideo(uri, { analysis, track, edits })` in a second or two. */
  analysis: ReframeAnalysis;
  /** The one-clip Cutiva project (CPF) of the result. */
  project: Project;
}

let jobs = 0;
const nextJob = () => `job${++jobs}`;

/** Runs one native job with progress and cancel. */
async function run<T>(start: (job: string) => Promise<T>, onProgress?: (ratio: number, stage: ReframeStage) => void, signal?: AbortSignal): Promise<T> {
  const native = cutivaNative();
  const job = nextJob();
  const sub = onProgress ? native.addListener("onProgress", (e) => e.job === job && onProgress(e.ratio, e.stage)) : null;
  const abort = () => native.cancel(job);
  signal?.addEventListener("abort", abort);
  try {
    return await start(job);
  } finally {
    signal?.removeEventListener("abort", abort);
    sub?.remove();
  }
}

/**
 * Analyses a video on the device for auto-reframe: faces (MediaPipe; the model downloads once,
 * about 3.7 MB, checked against a pinned SHA-256), mouth movement, speech and camera cuts. Frames
 * and audio never leave the device; the result is numbers only. Slow (about real time or more):
 * keep the result to re-plan. Rejects with `NO_VIDEO_TRACK`, `ASSET_NOT_FOUND`, `MODEL_LOAD_FAILED`
 * or `ANALYSIS_CANCELLED`.
 */
export async function analyzeVideo(uri: string, options: AnalyzeVideoOptions = {}): Promise<ReframeAnalysis> {
  if (options.signal?.aborted) throw Object.assign(new Error("Analysis was cancelled."), { code: "ANALYSIS_CANCELLED" });
  const { fps, fromUs, toUs } = options;
  const json = await run((job) => cutivaNative().analyze(uri, { ...(fps ? { fps } : {}), ...(fromUs !== undefined ? { fromUs } : {}), ...(toUs !== undefined ? { toUs } : {}) }, job), options.onProgress, options.signal);
  return toAnalysis(JSON.parse(json) as NativeMeasurements);
}

/**
 * Turns a landscape video into a vertical one that follows whoever is talking: analyses it (or
 * reuses `analysis`), plans with `@cutiva/core`, and exports an MP4 with the device's encoders.
 * Pass `track` and `edits` from a result to correct a framing (focus a person, split, wide).
 */
export async function reframeVideo(uri: string, options: ReframeVideoOptions = {}): Promise<ReframeVideoResult> {
  const { onProgress, signal } = options;
  const analyzeShare = options.analysis ? 0 : 0.9;
  const analysis =
    options.analysis ??
    (await analyzeVideo(uri, { ...options, onProgress: onProgress && ((r, stage) => onProgress(r * analyzeShare, stage)) }));
  const planned = planVideo(analysis, options);
  const { project, plan } = reframedProject(uri, analysis, planned, options);
  if (signal?.aborted) throw Object.assign(new Error("Export was cancelled."), { code: "EXPORT_CANCELLED" });
  const out = await run(
    (job) => cutivaNative().export(JSON.stringify(plan), options.outputUri ?? null, job),
    onProgress && ((r) => onProgress(analyzeShare + r * (1 - analyzeShare), "export")),
    signal,
  );
  return { uri: out.uri, track: planned.track, keys: planned.keys, sightings: planned.sightings, passthrough: planned.passthrough, analysis, project };
}
