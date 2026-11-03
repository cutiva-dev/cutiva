import { clipEndUs, cropAt, cropRect, CutivaError, findClip, reframeKeys, sourceTimeAt, type Editor, type ReframeKey, type ReframeWindow, type Us } from "@cutiva/core";
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useProject } from "./hooks.js";

export interface ReframeBoxProps {
  editor: Editor;
  /** The reframed video clip. */
  clipId: string;
  /** Timeline time; the box shows the crop window at this instant. */
  timeUs: Us;
  /** Called when an edit is refused. */
  onError?: (error: CutivaError) => void;
  /**
   * When set, a drag doesn't rewrite the keys: it calls this with the dropped window (centre and
   * height, source pixels) and the source time it was dropped at. Use it for clips with a Reframe
   * Track, where a drag locks the segment (`engine.editReframe` with a `segment` edit and `window`).
   */
  onWindow?: (window: ReframeWindow, sourceUs: Us) => void;
  /** Faces to draw over the source, in source pixels; clicking one calls `onFaceClick` with its id. */
  faces?: ReframeBoxFace[];
  onFaceClick?: (id: string) => void;
}

export interface ReframeBoxFace {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** CSS colour of the box. */
  color?: string;
  /** The person the current segment frames. */
  focused?: boolean;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/**
 * The crop window of a reframed clip, drawn over the whole source frame. Place it inside an element
 * that shows the clip's uncropped source at the source's aspect ratio (for example a canvas with
 * `engine.sourceFrame`); it fills that element. Dragging the box moves the framing in effect at
 * `timeUs` (the last key at or before it) as one undo step. A clip with no reframe gets one key
 * that frames the whole clip.
 */
export function ReframeBox({ editor, clipId, timeUs, onError, onWindow, faces, onFaceClick }: ReframeBoxProps) {
  const project = useProject(editor);
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ startX: number; startY: number; dx: number; dy: number } | null>(null);

  let found: ReturnType<typeof findClip> | null = null;
  try {
    found = findClip(project, clipId);
  } catch {
    return null;
  }
  const { clip } = found;
  const asset = project.assets.find((a) => a.id === clip.assetId);
  if (!asset?.width || !asset.height) return null;
  const srcW = asset.width;
  const srcH = asset.height;
  const sourceUs = sourceTimeAt(clip, Math.min(Math.max(timeUs, clip.startUs), clipEndUs(clip) - 1));
  const keys = reframeKeys(clip) ?? [];
  const fallback: ReframeKey = { atUs: clip.sourceInUs, x: Math.floor(srcW / 2), y: Math.floor(srcH / 2), h: srcH };
  const effective = keys.length ? keys : [fallback];
  const { width, height } = project.settings;
  const rect = cropAt(
    effective.map((k) => ({ atUs: k.atUs, rect: cropRect(k, srcW, srcH, width, height), cut: k.cut === true })),
    sourceUs,
  );
  const d = gcd(width, height);

  const toSource = (dxPx: number, dyPx: number) => {
    const box = ref.current?.getBoundingClientRect();
    return box && box.width > 0 ? { x: (dxPx * srcW) / box.width, y: (dyPx * srcH) / box.height } : { x: 0, y: 0 };
  };
  const moved = drag ? toSource(drag.dx, drag.dy) : { x: 0, y: 0 };
  const left = Math.min(Math.max(rect.x + moved.x, 0), srcW - rect.w);
  const top = Math.min(Math.max(rect.y + moved.y, 0), srcH - rect.h);

  const onPointerUp = () => {
    if (!drag) return;
    setDrag(null);
    const delta = toSource(drag.dx, drag.dy);
    if (delta.x === 0 && delta.y === 0) return;
    const dropped = {
      x: Math.max(0, Math.round(Math.min(Math.max(rect.x + delta.x, 0), srcW - rect.w) + rect.w / 2)),
      y: Math.max(0, Math.round(Math.min(Math.max(rect.y + delta.y, 0), srcH - rect.h) + rect.h / 2)),
    };
    if (onWindow) return onWindow({ ...dropped, h: rect.h }, sourceUs);
    let index = 0;
    while (index + 1 < effective.length && effective[index + 1]!.atUs <= sourceUs) index++;
    const next = effective.map((k, i) => (i === index ? { ...k, ...dropped } : k));
    try {
      editor.dispatch({ type: "clip.setReframe", clipId, keys: next });
    } catch (e) {
      if (e instanceof CutivaError) onError?.(e);
      else throw e;
    }
  };

  return (
    <div ref={ref} className="cutiva-reframe">
      <div
        className={`cutiva-reframe__box${drag ? " is-dragging" : ""}`}
        role="slider"
        aria-label="Framing window"
        aria-valuemin={0}
        aria-valuemax={srcW - rect.w}
        aria-valuenow={Math.round(left)}
        tabIndex={0}
        style={{ left: `${(left / srcW) * 100}%`, top: `${(top / srcH) * 100}%`, width: `${(rect.w / srcW) * 100}%`, height: `${(rect.h / srcH) * 100}%` }}
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture?.(e.pointerId);
          setDrag({ startX: e.clientX, startY: e.clientY, dx: 0, dy: 0 });
        }}
        onPointerMove={(e: ReactPointerEvent) => drag && setDrag({ ...drag, dx: e.clientX - drag.startX, dy: e.clientY - drag.startY })}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(null)}
      >
        <span className="cutiva-reframe__label">
          {width / d}:{height / d}
        </span>
      </div>
      {faces?.map((f) => (
        <button
          key={f.id}
          type="button"
          className={`cutiva-reframe__face${f.focused ? " is-focused" : ""}`}
          aria-label={`Frame ${f.label}`}
          aria-pressed={f.focused === true}
          style={{
            left: `${(f.x / srcW) * 100}%`,
            top: `${(f.y / srcH) * 100}%`,
            width: `${(f.w / srcW) * 100}%`,
            height: `${(f.h / srcH) * 100}%`,
            ...(f.color ? ({ "--cutiva-face": f.color } as Record<string, string>) : {}),
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onFaceClick?.(f.id)}
        >
          <span className="cutiva-reframe__face-name">{f.label}</span>
        </button>
      ))}
    </div>
  );
}
