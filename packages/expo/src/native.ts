import { requireNativeModule } from "expo";

/** Progress of a native job: the face model download, the video and audio stages, or the export. */
export interface NativeProgress {
  job: string;
  ratio: number;
  stage: "model" | "video" | "audio" | "export";
}

/** The Kotlin module (`android/src/main/java/dev/cutiva/expo/CutivaModule.kt`). */
export interface CutivaNative {
  analyze(uri: string, options: { fps?: number; width?: number; fromUs?: number; toUs?: number }, job: string): Promise<string>;
  export(planJson: string, outputPath: string | null, job: string): Promise<{ uri: string; durationMs: number; fileSizeBytes: number }>;
  cancel(job: string): void;
  addListener(event: "onProgress", listener: (e: NativeProgress) => void): { remove(): void };
}

let native: CutivaNative | null = null;

/** The native module, loaded on first use so that importing the package never throws. */
export function cutivaNative(): CutivaNative {
  native ??= requireNativeModule<CutivaNative>("Cutiva");
  return native;
}
