import { clipDurationUs, clipEndUs, CutivaError, formatTimecode, reframeKeys, reframeTrack, type Clip, type Editor, type Track, type Us } from "@cutiva/core";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useProject } from "./hooks.js";
import { personColor, placedSegments, segmentCaption } from "./reframe-lanes.js";

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
  /**
   * Under each video track with a reframed clip (one with a Reframe Track), show a Speakers lane
   * (who talks, coloured by person) and a Camera lane (what each segment frames). Default true.
   */
  reframeLanes?: boolean;
  /** The highlighted reframe segment. */
  selectedSegment?: { clipId: string; segmentId: string } | null;
  /** Called when a segment of a lane is clicked; the playhead also moves to its middle. */
  onSelectSegment?: (clipId: string, segmentId: string) => void;
}

type Drag =
  | { kind: "move"; clipId: string; trackKind: "video" | "audio"; startX: number; startUs: Us; dx: number }
  | { kind: "trim-in"; clipId: string; startX: number; dx: number }
  | { kind: "trim-out"; clipId: string; startX: number; dx: number };

const TRACK_LABEL = { video: "Video", audio: "Audio" } as const;

export function Timeline({ editor, timeUs, onSeek, selectedClipId, onSelect, pxPerSecond = 60, onError, thumbnail, reframeLanes = true, selectedSegment, onSelectSegment }: TimelineProps) {
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

  const hasLanes = (t: Track) => reframeLanes && t.kind === "video" && t.clips.some((c) => (reframeTrack(c)?.segments.length ?? 0) > 0);

  const lanes = (track: Track) =>
    (["speakers", "camera"] as const).map((lane) => (
      <div key={`${track.id}:${lane}`} className={`cutiva-timeline__lane cutiva-timeline__lane--${lane}`} role="group" aria-label={lane === "speakers" ? "Speakers" : "Camera"}>
        {track.clips.flatMap((clip) => {
          const rt = reframeTrack(clip);
          if (!rt) return [];
          return placedSegments(clip).map(({ segment, startUs, endUs }) => {
            const selected = selectedSegment?.clipId === clip.id && selectedSegment.segmentId === segment.id;
            const speakers = segment.speakers.filter((id) => rt.people.some((p) => p.id === id));
            const caption = lane === "speakers" ? (speakers.length ? speakers.map((id) => rt.people.find((p) => p.id === id)!.label).join(" + ") : "Silence") : segmentCaption(rt, segment);
            const stripes = speakers.map((id) => personColor(rt, id));
            // Two voices at once: the first colour fills, the second underlines (no gradients in the theme).
            const voices = lane === "speakers" && stripes.length > 0 ? { background: stripes[0], ...(stripes[1] ? { borderBottom: `4px solid ${stripes[1]}` } : {}) } : {};
            const focus = segment.resolved === "single" ? (segment.focus[0] ?? segment.speakers[0]) : undefined;
            return (
              <button
                key={`${clip.id}:${segment.id}`}
                type="button"
                className={`cutiva-segment cutiva-segment--${lane === "camera" ? segment.resolved : speakers.length ? "voice" : "silence"}${selected ? " is-selected" : ""}${lane === "camera" && segment.locked ? " is-locked" : ""}`}
                style={{ left: startUs * pxPerUs, width: Math.max(2, (endUs - startUs) * pxPerUs), ...voices, ...(lane === "camera" && focus ? { borderColor: personColor(rt, focus) } : {}) }}
                aria-pressed={selected}
                aria-label={`${lane === "speakers" ? "Speakers" : "Camera"}: ${caption}${lane === "camera" && segment.locked ? " (locked)" : ""}, ${formatTimecode(startUs)} to ${formatTimecode(endUs)}`}
                title={`${caption}${segment.locked ? " · locked" : ""} · ${segment.reason}`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => {
                  onSelectSegment?.(clip.id, segment.id);
                  onSeek(startUs + Math.floor((endUs - startUs) / 2));
                }}
              >
                <span className="cutiva-segment__name">{caption}</span>
              </button>
            );
          });
        })}
      </div>
    ));

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
        )).flatMap((label, i) => {
          const t = project.tracks[i]!;
          return hasLanes(t)
            ? [
                label,
                <div key={`${t.id}:speakers`} className="cutiva-timeline__label cutiva-timeline__label--lane">Speakers</div>,
                <div key={`${t.id}:camera`} className="cutiva-timeline__label cutiva-timeline__label--lane">Camera</div>,
              ]
            : [label];
        })}
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
          {project.tracks.map((track) => [
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
                    {track.kind === "video" &&
                      reframeCuts(clip).map((atUs) => (
                        <button
                          key={atUs}
                          type="button"
                          className="cutiva-clip__reframe"
                          style={{ left: (atUs - clip.startUs) * pxPerUs }}
                          aria-label={`Framing change at ${formatTimecode(atUs)}`}
                          title={`Framing change at ${formatTimecode(atUs)}`}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={() => onSeek(atUs)}
                        />
                      ))}
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
            </div>,
            ...(hasLanes(track) ? lanes(track) : []),
          ])}
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

/** Timeline times inside the clip where its framing jumps (reframe cuts). */
function reframeCuts(clip: Clip): Us[] {
  const keys = reframeKeys(clip);
  if (!keys) return [];
  const end = clipEndUs(clip);
  const out: Us[] = [];
  for (const k of keys) {
    if (!k.cut || k.atUs < clip.sourceInUs) continue;
    const t = clip.startUs + Math.round((k.atUs - clip.sourceInUs) / clip.speed);
    if (t > clip.startUs && t < end) out.push(t);
  }
  return out;
}
