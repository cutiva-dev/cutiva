import { clipDurationUs, clipEndUs, CutivaError, formatTimecode, type Editor, type Us } from "@cutiva/core";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useProject } from "./hooks.js";

/** An image the timeline can draw, such as a canvas or ImageBitmap. */
export type ThumbnailSource = CanvasImageSource & { width: number; height: number };

export interface TimelineProps {
  editor: Editor;
  timeUs: Us;
  onSeek: (timeUs: Us) => void;
  selectedClipId?: string | null;
  onSelect?: (clipId: string | null) => void;
  /** Zoom. Default 60 px per second. */
  pxPerSecond?: number;
  /** Called when an edit is refused (overlap, invalid range). */
  onError?: (error: CutivaError) => void;
  /**
   * Frame of a video asset near a source time. When set, video clips show a strip of thumbnails.
   * With `@cutiva/web`, pass `engine.thumbnail`.
   */
  thumbnail?: (assetId: string, sourceUs: Us) => Promise<ThumbnailSource | null>;
}

type Drag =
  | { kind: "move"; clipId: string; trackKind: "video" | "audio"; startX: number; startUs: Us; dx: number }
  | { kind: "trim-in"; clipId: string; startX: number; dx: number }
  | { kind: "trim-out"; clipId: string; startX: number; dx: number };

const TRACK_LABEL = { video: "Video", audio: "Audio" } as const;

export function Timeline({ editor, timeUs, onSeek, selectedClipId, onSelect, pxPerSecond = 60, onError, thumbnail }: TimelineProps) {
  const project = useProject(editor);
  const [drag, setDrag] = useState<Drag | null>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const pxPerUs = pxPerSecond / 1e6;
  const durationUs = Math.max(editor.durationUs, 10_000_000);
  const widthPx = Math.ceil(durationUs * pxPerUs) + 240;

  const run = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      if (e instanceof CutivaError) onError?.(e);
      else throw e;
    }
  };

  const timeFromEvent = (clientX: number): Us => {
    const rect = areaRef.current!.getBoundingClientRect();
    const x = clientX - rect.left + areaRef.current!.scrollLeft;
    return Math.max(0, Math.round(x / pxPerUs));
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (drag) setDrag({ ...drag, dx: e.clientX - drag.startX });
  };

  const onPointerUp = () => {
    if (!drag) return;
    const dUs = Math.round(drag.dx / pxPerUs);
    setDrag(null);
    if (Math.abs(drag.dx) < 3) return;
    const found = project.tracks.flatMap((t) => t.clips.map((c) => ({ t, c }))).find((x) => x.c.id === drag.clipId);
    if (!found) return;
    const { t: track, c: clip } = found;
    run(() => {
      if (drag.kind === "trim-in") {
        editor.dispatch({ type: "clip.trim", clipId: clip.id, sourceInUs: clip.sourceInUs + Math.round(dUs * clip.speed) });
      } else if (drag.kind === "trim-out") {
        editor.dispatch({ type: "clip.trim", clipId: clip.id, sourceOutUs: clip.sourceOutUs + Math.round(dUs * clip.speed) });
      } else if (drag.trackKind === "video") {
        // Video tracks are magnetic: dropping reorders and closes gaps.
        const dropMid = clip.startUs + dUs + clipDurationUs(clip) / 2;
        const others = track.clips.filter((c) => c.id !== clip.id);
        const index = others.filter((c) => c.startUs + clipDurationUs(c) / 2 < dropMid).length;
        editor.dispatch({ type: "clip.reorder", clipId: clip.id, index });
      } else {
        editor.dispatch({ type: "clip.move", clipId: clip.id, startUs: Math.max(0, drag.startUs + dUs) });
      }
    });
  };

  const ticks: number[] = [];
  const step = pxPerSecond >= 40 ? 1 : 5;
  for (let s = 0; s * 1e6 <= durationUs; s += step) ticks.push(s);

  return (
    <div className="cutiva-timeline" onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}>
      <div className="cutiva-timeline__labels">
        <div className="cutiva-timeline__ruler-spacer" />
        {project.tracks.map((t) => (
          <div key={t.id} className={`cutiva-timeline__label cutiva-timeline__label--${t.kind}`}>
            <span>{TRACK_LABEL[t.kind]}</span>
            <button
              type="button"
              className="cutiva-timeline__mute"
              aria-pressed={t.muted}
              aria-label={t.muted ? `Unmute ${TRACK_LABEL[t.kind]} track` : `Mute ${TRACK_LABEL[t.kind]} track`}
              onClick={() => run(() => editor.dispatch({ type: "track.setMuted", trackId: t.id, muted: !t.muted }))}
            >
              {t.muted ? "Muted" : "Mute"}
            </button>
          </div>
        ))}
      </div>
      <div className="cutiva-timeline__area" ref={areaRef}>
        <div style={{ width: widthPx, position: "relative" }}>
          <div
            className="cutiva-timeline__ruler"
            onPointerDown={(e) => onSeek(timeFromEvent(e.clientX))}
            role="slider"
            tabIndex={0}
            aria-label="Playhead"
            aria-valuemin={0}
            aria-valuemax={editor.durationUs}
            aria-valuenow={timeUs}
            aria-valuetext={formatTimecode(timeUs)}
            onKeyDown={(e) => {
              // One frame at the project's rate, in whole microseconds.
              const { num, den } = project.settings.fps;
              const frameUs = Math.round((1_000_000 * den) / num);
              if (e.key === "ArrowRight") onSeek(timeUs + frameUs);
              if (e.key === "ArrowLeft") onSeek(Math.max(0, timeUs - frameUs));
            }}
          >
            {ticks.map((s) => (
              <span key={s} className="cutiva-timeline__tick" style={{ left: s * pxPerSecond }}>
                {s % 60 === s ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`}
              </span>
            ))}
          </div>
          {project.tracks.map((track) => (
            <div
              key={track.id}
              className={`cutiva-timeline__track cutiva-timeline__track--${track.kind}${track.muted ? " is-muted" : ""}`}
              onPointerDown={(e) => {
                if (e.target === e.currentTarget) {
                  onSelect?.(null);
                  onSeek(timeFromEvent(e.clientX));
                }
              }}
            >
              {track.clips.map((clip) => {
                const asset = project.assets.find((a) => a.id === clip.assetId);
                const active = drag?.clipId === clip.id ? drag : null;
                let left = clip.startUs * pxPerUs;
                let width = clipDurationUs(clip) * pxPerUs;
                if (active?.kind === "move") left += active.dx;
                if (active?.kind === "trim-in") {
                  left += active.dx;
                  width -= active.dx;
                }
                if (active?.kind === "trim-out") width += active.dx;
                const selected = selectedClipId === clip.id;
                const thumbs = thumbnail && track.kind === "video" && asset?.kind === "video";
                // While trimming the start, the strip should show the source the new start would reveal.
                const shownSourceInUs = clip.sourceInUs + (active?.kind === "trim-in" ? Math.round((active.dx / pxPerUs) * clip.speed) : 0);
                return (
                  <div
                    key={clip.id}
                    className={`cutiva-clip cutiva-clip--${track.kind}${thumbs ? " cutiva-clip--thumbs" : ""}${selected ? " is-selected" : ""}${active ? " is-dragging" : ""}`}
                    style={{ left, width: Math.max(4, width) }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      onSelect?.(clip.id);
                      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                      setDrag({ kind: "move", clipId: clip.id, trackKind: track.kind, startX: e.clientX, startUs: clip.startUs, dx: 0 });
                    }}
                    title={`${asset?.name ?? clip.assetId} · ${formatTimecode(clip.startUs)} – ${formatTimecode(clipEndUs(clip))}`}
                  >
                    {thumbs && (
                      <ClipThumbnails
                        assetId={clip.assetId}
                        aspect={asset.width && asset.height ? asset.width / asset.height : 16 / 9}
                        sourceInUs={shownSourceInUs}
                        speed={clip.speed}
                        widthPx={Math.max(4, width)}
                        pxPerUs={pxPerUs}
                        thumbnail={thumbnail}
                      />
                    )}
                    <span
                      className="cutiva-clip__handle cutiva-clip__handle--in"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        onSelect?.(clip.id);
                        setDrag({ kind: "trim-in", clipId: clip.id, startX: e.clientX, dx: 0 });
                      }}
                    />
                    <span className="cutiva-clip__name">{asset?.name ?? clip.assetId}</span>
                    <span
                      className="cutiva-clip__handle cutiva-clip__handle--out"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        onSelect?.(clip.id);
                        setDrag({ kind: "trim-out", clipId: clip.id, startX: e.clientX, dx: 0 });
                      }}
                    />
                  </div>
                );
              })}
            </div>
          ))}
          <div className="cutiva-timeline__playhead" style={{ left: timeUs * pxPerUs }} />
        </div>
      </div>
    </div>
  );
}

interface ClipThumbnailsProps {
  assetId: string;
  /** Width / height of the video. */
  aspect: number;
  sourceInUs: Us;
  speed: number;
  widthPx: number;
  pxPerUs: number;
  thumbnail: NonNullable<TimelineProps["thumbnail"]>;
}

/** A strip of thumbnails behind a clip, one tile per video-aspect slot. */
function ClipThumbnails({ assetId, aspect, sourceInUs, speed, widthPx, pxPerUs, thumbnail }: ClipThumbnailsProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  // Keep the latest callback without redrawing when only its identity changes.
  const thumbnailRef = useRef(thumbnail);
  thumbnailRef.current = thumbnail;

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const height = canvas.clientHeight;
    const width = Math.ceil(widthPx);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const tileWidth = Math.max(16, height * aspect);
    let live = true;
    for (let x = 0; x < width; x += tileWidth) {
      const sourceUs = Math.round(sourceInUs + (x / pxPerUs) * speed);
      thumbnailRef
        .current(assetId, sourceUs)
        .then((image) => {
          if (live && image) ctx.drawImage(image, x, 0, tileWidth, height);
        })
        .catch(() => undefined);
    }
    return () => {
      live = false;
    };
  }, [assetId, aspect, sourceInUs, speed, widthPx, pxPerUs]);

  return <canvas ref={ref} className="cutiva-clip__thumbs" aria-hidden="true" />;
}
