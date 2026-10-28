import {
  audioSegments,
  clipEndUs,
  CutivaError,
  projectDurationUs,
  resolveVideoAt,
  type Clip,
  type Project,
  type Us,
} from "@cutiva/core";
import {
  AudioBufferSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  canEncodeAudio,
  canEncodeVideo,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  type WrappedCanvas,
} from "mediabunny";
import { scheduleSegments } from "./audio.js";
import { drawContain } from "./draw.js";
import type { MediaRegistry } from "./media.js";

export type Resolution = "480p" | "720p" | "1080p" | "source";

export interface ExportOptions {
  container?: "mp4";
  resolution?: Resolution;
  /** Frames per second. Defaults to the project's fps. */
  fps?: number;
  /** Video bitrate in bits per second. Defaults to Mediabunny's QUALITY_HIGH. */
  videoBitrate?: number;
}

export interface ExportProgress {
  /** 0..1 */
  ratio: number;
  frame: number;
  totalFrames: number;
  phase: "audio" | "video" | "finalizing";
}

export interface ExportJob {
  readonly done: Promise<Blob>;
  on(event: "progress", listener: (p: ExportProgress) => void): () => void;
  cancel(): void;
}

const SHORT_SIDE: Record<Exclude<Resolution, "source">, number> = { "480p": 480, "720p": 720, "1080p": 1080 };

/** Even output size that keeps the project's aspect ratio. */
export function outputSize(project: Project, resolution: Resolution = "source"): { width: number; height: number } {
  const { width, height } = project.settings;
  if (resolution === "source") return { width: width - (width % 2), height: height - (height % 2) };
  const short = SHORT_SIDE[resolution];
  const scale = short / Math.min(width, height);
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return { width: even(width * scale), height: even(height * scale) };
}

export interface Capabilities {
  webCodecs: boolean;
  exportMp4: boolean;
  h264: boolean;
  aac: boolean;
}

/** What this browser can actually do, so the app can decide before failing. */
export async function capabilities(): Promise<Capabilities> {
  const webCodecs = typeof VideoEncoder !== "undefined" && typeof VideoDecoder !== "undefined";
  if (!webCodecs) return { webCodecs, exportMp4: false, h264: false, aac: false };
  const [h264, aac] = await Promise.all([canEncodeVideo("avc").catch(() => false), canEncodeAudio("aac").catch(() => false)]);
  return { webCodecs, exportMp4: h264, h264, aac };
}

/** Render the whole project to an MP4 Blob on this device. */
export function exportProject(project: Project, media: MediaRegistry, options: ExportOptions = {}): ExportJob {
  const listeners = new Set<(p: ExportProgress) => void>();
  let cancelled = false;
  let output: Output | null = null;
  const emit = (p: ExportProgress) => listeners.forEach((l) => l(p));

  const done = (async (): Promise<Blob> => {
    const durationUs = projectDurationUs(project);
    if (durationUs <= 0) throw new CutivaError("NOTHING_TO_EXPORT", "The project is empty.");
    const missing = media.missing(project.assets);
    if (missing.length) {
      throw new CutivaError("ASSET_NOT_FOUND", `Media is not loaded for: ${missing.map((a) => a.name).join(", ")}.`);
    }
    if (!(await canEncodeVideo("avc").catch(() => false))) {
      throw new CutivaError("UNSUPPORTED_CODEC", "This browser cannot encode H.264 video. Try a Chromium-based browser.");
    }

    const fps = options.fps ?? project.settings.fps.num / project.settings.fps.den;
    const { width, height } = outputSize(project, options.resolution);
    const totalFrames = Math.max(1, Math.ceil((durationUs / 1e6) * fps));
    const frameUs = (i: number): Us => Math.round((i * 1e6) / fps);

    // ---- Audio: mix the whole timeline offline with the same scheduler the preview uses.
    emit({ ratio: 0, frame: 0, totalFrames, phase: "audio" });
    const sampleRate = project.settings.sampleRate;
    const segments = audioSegments(project);
    let mixed: AudioBuffer | null = null;
    const canAac = await canEncodeAudio("aac").catch(() => false);
    if (segments.length && canAac) {
      const offline = new OfflineAudioContext(2, Math.ceil((durationUs / 1e6) * sampleRate), sampleRate);
      const buffers = new Map<string, AudioBuffer>();
      for (const s of segments) {
        if (buffers.has(s.assetId)) continue;
        const entry = media.get(s.assetId);
        const buf = entry ? await media.audioBuffer(entry, offline) : null;
        if (buf) buffers.set(s.assetId, buf);
      }
      if (buffers.size) {
        scheduleSegments(offline, offline.destination, segments, buffers, 0, 0);
        mixed = await offline.startRendering();
      }
    }
    if (cancelled) throw new CutivaError("EXPORT_CANCELLED", "Export was cancelled.");

    // ---- Output
    const canvas =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(width, height)
        : Object.assign(document.createElement("canvas"), { width, height });
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new Error("Canvas 2D context is not available.");

    const target = new BufferTarget();
    output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target });
    const videoSource = new CanvasSource(canvas, { codec: "avc", bitrate: options.videoBitrate ?? QUALITY_HIGH });
    output.addVideoTrack(videoSource, { frameRate: fps });
    const audioSource = mixed ? new AudioBufferSource({ codec: "aac", bitrate: QUALITY_HIGH }) : null;
    if (audioSource) output.addAudioTrack(audioSource);
    await output.start();

    if (audioSource && mixed) await audioSource.add(mixed);

    // ---- Video: one decoding iterator per clip, fed the exact source times of its frames.
    const iterators = new Map<string, AsyncGenerator<WrappedCanvas | null>>();
    const sinks = new Map<string, CanvasSink>();
    const iteratorFor = (clip: Clip, assetId: string): AsyncGenerator<WrappedCanvas | null> | null => {
      const existing = iterators.get(clip.id);
      if (existing) return existing;
      const entry = media.get(assetId);
      if (!entry?.video) return null;
      let sink = sinks.get(assetId);
      if (!sink) {
        sink = new CanvasSink(entry.video, { width, height, fit: "contain", poolSize: 1 });
        sinks.set(assetId, sink);
      }
      const times: number[] = [];
      for (let i = 0; i < totalFrames; i++) {
        const t = frameUs(i);
        if (t >= clip.startUs && t < clipEndUs(clip)) {
          times.push((clip.sourceInUs + (t - clip.startUs) * clip.speed) / 1e6);
        }
      }
      const it = sink.canvasesAtTimestamps(times);
      iterators.set(clip.id, it);
      return it;
    };

    for (let i = 0; i < totalFrames; i++) {
      if (cancelled) {
        await output.cancel();
        throw new CutivaError("EXPORT_CANCELLED", "Export was cancelled.");
      }
      const t = frameUs(i);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, width, height);
      for (const layer of resolveVideoAt(project, t)) {
        const it = iteratorFor(layer.clip, layer.asset.id);
        if (!it) continue;
        const next = await it.next();
        if (!next.done && next.value) drawContain(ctx, next.value.canvas, width, height);
      }
      await videoSource.add(t / 1e6, 1 / fps);
      if (i % 5 === 0 || i === totalFrames - 1) {
        emit({ ratio: (i + 1) / totalFrames, frame: i + 1, totalFrames, phase: "video" });
      }
    }

    emit({ ratio: 1, frame: totalFrames, totalFrames, phase: "finalizing" });
    await output.finalize();
    for (const it of iterators.values()) await it.return(undefined);
    if (!target.buffer) throw new Error("Export produced no data.");
    return new Blob([target.buffer], { type: "video/mp4" });
  })();

  return {
    done,
    on(_event, listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    cancel() {
      cancelled = true;
    },
  };
}
