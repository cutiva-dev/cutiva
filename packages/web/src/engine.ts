import type { Editor, ReframeEdit, Us } from "@cutiva/core";
import { capabilities, exportProject, type ExportJob, type ExportOptions } from "./export.js";
import { importFile, MediaRegistry } from "./media.js";
import { createPreview, type Preview, type PreviewOptions } from "./preview.js";
import { analyzeAsset, autoReframeClip, type AnalyzeOptions, type AutoReframeClipResult, type AutoReframeOptions, type ReframeAnalysis } from "./reframe.js";
import { AnalysisCache, clipReframePlan, editClipReframe, reframeClip, type ReframeClipResult, type ReframeOptions } from "./reframe-track.js";
import type { Thumbnail } from "./thumbnails.js";

export interface WebEngine {
  readonly media: MediaRegistry;
  /** Import a local file and append it to its track, as one undo step. */
  importFile(file: File | Blob, options?: { addClip?: boolean }): Promise<{ assetId: string; clipId?: string }>;
  /** After opening a saved project, attach local files to its assets by fingerprint. */
  relink(file: File | Blob): Promise<string | null>;
  createPreview(canvas: HTMLCanvasElement, options?: PreviewOptions): Preview;
  /**
   * A small frame of a video asset near `sourceUs` (the keyframe at or before it), for timeline
   * thumbnails. Null for audio, for media that isn't loaded, or when decoding fails.
   */
  thumbnail(assetId: string, sourceUs: Us): Promise<Thumbnail | null>;
  /**
   * The whole source frame of a video asset near `sourceUs`, uncropped, for showing where a reframe
   * window sits or cutting out a face. Null for audio or media that isn't loaded.
   */
  sourceFrame(assetId: string, sourceUs: Us): Promise<HTMLCanvasElement | OffscreenCanvas | null>;
  /** Record faces, speech and camera cuts of a video asset (see `autoReframe`). */
  analyze(assetId: string, options: AnalyzeOptions): Promise<ReframeAnalysis>;
  /** Frame a clip on whoever is talking with the older `autoReframe` planner (keys only, no Reframe Track). One undo step. */
  autoReframe(clipId: string, options: AutoReframeOptions): Promise<AutoReframeClipResult>;
  /**
   * Frame a clip with the reframe planner: segments, people, layouts and the Reframe Track. Analyses
   * the clip (or reuses the cached analysis) and applies the plan as one undo step.
   */
  reframe(clipId: string, options?: ReframeOptions): Promise<ReframeClipResult>;
  /** Apply edits to a reframed clip's track and re-plan from the cached analysis, as one undo step. */
  editReframe(clipId: string, edits: ReframeEdit | ReframeEdit[]): Promise<ReframeClipResult>;
  /**
   * The plan of a reframed clip (with `sightings`), optionally after `edits`, without changing the
   * project. Null when it has no track or no cached analysis.
   */
  reframePlan(clipId: string, edits?: ReframeEdit | ReframeEdit[]): Promise<ReframeClipResult | null>;
  export(options?: ExportOptions): ExportJob;
  capabilities: typeof capabilities;
}

export function createWebEngine(editor: Editor): WebEngine {
  const media = new MediaRegistry();
  const analyses = new AnalysisCache();
  return {
    media,
    importFile: (file, options) => importFile(editor, media, file, options),
    relink: (file) => media.relink(file, editor.project.assets),
    createPreview: (canvas, options) => createPreview(editor, media, canvas, options),
    thumbnail: async (assetId, sourceUs) => {
      const entry = media.get(assetId);
      const server = entry && media.thumbnails(entry);
      return server ? server.thumbnailAt(sourceUs / 1_000_000) : null;
    },
    sourceFrame: async (assetId, sourceUs) => {
      const entry = media.get(assetId);
      const server = entry && media.previewFrames(entry, 960);
      return server ? ((await server.frameAt(sourceUs / 1_000_000))?.canvas ?? null) : null;
    },
    analyze: (assetId, options) => analyzeAsset(media, assetId, options),
    autoReframe: (clipId, options) => autoReframeClip(editor, media, clipId, options),
    reframe: (clipId, options) => reframeClip(editor, media, analyses, clipId, options),
    editReframe: (clipId, edits) => editClipReframe(editor, analyses, clipId, edits),
    reframePlan: (clipId, edits) => clipReframePlan(editor, analyses, clipId, edits),
    export: (options) => exportProject(editor.project, media, options),
    capabilities,
  };
}
