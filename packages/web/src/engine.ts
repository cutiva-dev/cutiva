import type { Editor, Us } from "@cutiva/core";
import { capabilities, exportProject, type ExportJob, type ExportOptions } from "./export.js";
import { importFile, MediaRegistry } from "./media.js";
import { createPreview, type Preview, type PreviewOptions } from "./preview.js";
import { analyzeAsset, autoReframeClip, type AnalyzeOptions, type AutoReframeClipResult, type AutoReframeOptions, type ReframeAnalysis } from "./reframe.js";
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
  /** Frame a clip on whoever is talking, for the project's aspect ratio. One undo step. */
  autoReframe(clipId: string, options: AutoReframeOptions): Promise<AutoReframeClipResult>;
  export(options?: ExportOptions): ExportJob;
  capabilities: typeof capabilities;
}

export function createWebEngine(editor: Editor): WebEngine {
  const media = new MediaRegistry();
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
    export: (options) => exportProject(editor.project, media, options),
    capabilities,
  };
}
