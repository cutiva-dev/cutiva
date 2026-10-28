import { createEditor, type Editor, type EditorOptions, type Project, type Us } from "@cutiva/core";
import { createWebEngine, type Preview, type PreviewOptions, type WebEngine } from "@cutiva/web";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/** Create an editor and its web engine once per component lifetime. */
export function useCutiva(options?: EditorOptions): { editor: Editor; engine: WebEngine } {
  const ref = useRef<{ editor: Editor; engine: WebEngine } | null>(null);
  if (!ref.current) {
    const editor = createEditor(options);
    ref.current = { editor, engine: createWebEngine(editor) };
  }
  return ref.current;
}

/** Re-render whenever the project changes. */
export function useProject(editor: Editor): Project {
  return useSyncExternalStore(
    (cb) => editor.subscribe(cb),
    () => editor.project,
    () => editor.project,
  );
}

/** Attach a preview to a canvas and follow its playhead. */
export function usePreview(
  engine: WebEngine,
  canvas: HTMLCanvasElement | null,
  options?: PreviewOptions,
): { preview: Preview | null; timeUs: Us; playing: boolean } {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [timeUs, setTimeUs] = useState<Us>(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!canvas) return;
    const p = engine.createPreview(canvas, options);
    setPreview(p);
    const off = p.onTime((t) => {
      setTimeUs(t);
      setPlaying(p.playing);
    });
    return () => {
      off();
      p.destroy();
      setPreview(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, canvas]);
  useEffect(() => {
    if (!preview) return;
    const id = setInterval(() => setPlaying(preview.playing), 200);
    return () => clearInterval(id);
  }, [preview]);
  return { preview, timeUs, playing };
}
