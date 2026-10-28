import { audioSegments, resolveVideoAt, type Editor, type Us } from "@cutiva/core";
import { drawContain } from "./draw.js";
import type { MediaRegistry } from "./media.js";
import { scheduleSegments } from "./audio.js";

export interface Preview {
  readonly timeUs: Us;
  readonly playing: boolean;
  seek(timeUs: Us): void;
  play(): Promise<void>;
  pause(): void;
  /** Called on every time change (seek or playback tick). */
  onTime(listener: (timeUs: Us) => void): () => void;
  destroy(): void;
}

export interface PreviewOptions {
  /** Max decode width for preview frames. Default 960. */
  maxWidth?: number;
  background?: string;
}

/**
 * Real-time preview on a canvas. The audio clock is the master clock;
 * video frames follow it, so sound never drifts.
 */
export function createPreview(
  editor: Editor,
  media: MediaRegistry,
  canvas: HTMLCanvasElement,
  options: PreviewOptions = {},
): Preview {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context is not available.");
  const maxWidth = options.maxWidth ?? 960;
  const background = options.background ?? "#000";
  const listeners = new Set<(t: Us) => void>();

  let timeUs: Us = 0;
  let playing = false;
  let audioCtx: AudioContext | null = null;
  let stopAudio: (() => void) | null = null;
  let raf = 0;
  let clockStartCtx = 0;
  let clockStartUs: Us = 0;

  // Serialize frame draws: if a draw is running, remember only the latest requested time.
  let drawing = false;
  let pendingT: Us | null = null;

  const fitCanvas = () => {
    const { width, height } = editor.project.settings;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  };

  async function drawAt(t: Us): Promise<void> {
    if (drawing) {
      pendingT = t;
      return;
    }
    drawing = true;
    try {
      fitCanvas();
      const frames: (HTMLCanvasElement | OffscreenCanvas)[] = [];
      for (const layer of resolveVideoAt(editor.project, t)) {
        const entry = media.get(layer.asset.id);
        const sink = entry && media.previewSink(entry, maxWidth);
        if (!sink) continue;
        const wrapped = await sink.getCanvas(layer.sourceTimeUs / 1_000_000);
        if (wrapped) frames.push(wrapped.canvas);
      }
      ctx!.fillStyle = background;
      ctx!.fillRect(0, 0, canvas.width, canvas.height);
      for (const f of frames) drawContain(ctx!, f, canvas.width, canvas.height);
    } finally {
      drawing = false;
      if (pendingT !== null) {
        const next = pendingT;
        pendingT = null;
        void drawAt(next);
      }
    }
  }

  const setTime = (t: Us) => {
    timeUs = Math.max(0, Math.min(t, editor.durationUs));
    for (const l of listeners) l(timeUs);
  };

  const tick = () => {
    if (!playing || !audioCtx) return;
    const t = clockStartUs + Math.round((audioCtx.currentTime - clockStartCtx) * 1_000_000);
    if (t >= editor.durationUs) {
      pause();
      setTime(editor.durationUs);
      return;
    }
    setTime(t);
    void drawAt(t);
    raf = requestAnimationFrame(tick);
  };

  function pause(): void {
    if (!playing) return;
    playing = false;
    cancelAnimationFrame(raf);
    stopAudio?.();
    stopAudio = null;
  }

  const unsubscribe = editor.subscribe(() => {
    if (playing) pause();
    setTime(timeUs);
    void drawAt(timeUs);
  });

  void drawAt(0);

  return {
    get timeUs() {
      return timeUs;
    },
    get playing() {
      return playing;
    },
    seek(t) {
      const wasPlaying = playing;
      pause();
      setTime(t);
      void drawAt(timeUs);
      if (wasPlaying) void this.play();
    },
    async play() {
      if (playing) return;
      if (timeUs >= editor.durationUs) setTime(0);
      audioCtx ??= new AudioContext({ sampleRate: editor.project.settings.sampleRate });
      if (audioCtx.state === "suspended") await audioCtx.resume();
      const segments = audioSegments(editor.project);
      const buffers = new Map<string, AudioBuffer>();
      await Promise.all(
        segments.map(async (s) => {
          const entry = media.get(s.assetId);
          const buf = entry ? await media.audioBuffer(entry, audioCtx!) : null;
          if (buf) buffers.set(s.assetId, buf);
        }),
      );
      const lead = 0.05; // seconds, so the first sample isn't clipped
      clockStartCtx = audioCtx.currentTime + lead;
      clockStartUs = timeUs;
      stopAudio = scheduleSegments(audioCtx, audioCtx.destination, segments, buffers, timeUs, clockStartCtx);
      playing = true;
      raf = requestAnimationFrame(tick);
    },
    pause,
    onTime(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      pause();
      unsubscribe();
      listeners.clear();
      void audioCtx?.close();
    },
  };
}
