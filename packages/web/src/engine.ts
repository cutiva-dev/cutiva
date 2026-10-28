import type { Editor } from "@cutiva/core";
import { capabilities, exportProject, type ExportJob, type ExportOptions } from "./export.js";
import { importFile, MediaRegistry } from "./media.js";
import { createPreview, type Preview, type PreviewOptions } from "./preview.js";

export interface WebEngine {
  readonly media: MediaRegistry;
  /** Import a local file and append it to its track, as one undo step. */
  importFile(file: File | Blob, options?: { addClip?: boolean }): Promise<{ assetId: string; clipId?: string }>;
  /** After opening a saved project, attach local files to its assets by fingerprint. */
  relink(file: File | Blob): Promise<string | null>;
  createPreview(canvas: HTMLCanvasElement, options?: PreviewOptions): Preview;
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
    export: (options) => exportProject(editor.project, media, options),
    capabilities,
  };
}
