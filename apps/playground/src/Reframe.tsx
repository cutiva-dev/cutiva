import { clipEndUs, reframeKeys, sourceTimeAt, type Clip, type Editor, type Project, type ReframeKey, type Us } from "@cutiva/core";
import { ReframeBox } from "@cutiva/react";
import type { AutoReframeClipResult, FaceDetector, WebEngine } from "@cutiva/web";
import { useEffect, useRef, useState } from "react";
import { ReframeFeedback } from "./ReframeFeedback";

export const FORMATS = [
  { label: "16:9 landscape", width: 1920, height: 1080 },
  { label: "9:16 vertical", width: 1080, height: 1920 },
  { label: "1:1 square", width: 1080, height: 1080 },
  { label: "4:5 portrait", width: 1080, height: 1350 },
] as const;

export function FormatPicker({ editor, project }: { editor: Editor; project: Project }) {
  const { width, height } = project.settings;
  const current = FORMATS.findIndex((f) => f.width === width && f.height === height);
  return (
    <label className="format">
      <span className="muted">Format</span>
      <select
        aria-label="Format"
        value={current}
        onChange={(e) => {
          const f = FORMATS[Number(e.target.value)];
          if (f) editor.dispatch({ type: "project.setSize", width: f.width, height: f.height });
        }}
      >
        {current < 0 && <option value={-1}>{width}×{height}</option>}
        {FORMATS.map((f, i) => (
          <option key={f.label} value={i}>{f.label}</option>
        ))}
      </select>
    </label>
  );
}

/** The selected clip's whole source frame with its draggable crop window on top. */
export function SourceMonitor({ engine, editor, clip, project, timeUs }: { engine: WebEngine; editor: Editor; clip: Clip; project: Project; timeUs: Us }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const asset = project.assets.find((a) => a.id === clip.assetId);
  const inside = Math.min(Math.max(timeUs, clip.startUs), clipEndUs(clip) - 1);
  const sourceUs = sourceTimeAt(clip, inside);
  useEffect(() => {
    let current = true;
    void engine.sourceFrame(clip.assetId, sourceUs).then((frame) => {
      const c = canvas.current;
      if (!current || !frame || !c) return;
      if (c.width !== frame.width || c.height !== frame.height) Object.assign(c, { width: frame.width, height: frame.height });
      c.getContext("2d")?.drawImage(frame, 0, 0);
    });
    return () => {
      current = false;
    };
  }, [engine, clip.assetId, sourceUs]);
  if (!asset?.width || !asset.height) return null;
  return (
    <figure className="source">
      {/* Exactly the source's shape, so the window's percentages line up with the picture. */}
      <div className="screen screen--source" style={{ aspectRatio: `${asset.width} / ${asset.height}`, width: `min(100%, calc(46vh * ${asset.width / asset.height}))` }}>
        <canvas ref={canvas} aria-label="Source frame" />
        <ReframeBox editor={editor} clipId={clip.id} timeUs={inside} />
      </div>
      <figcaption className="muted">Drag the window to move the framing at the playhead.</figcaption>
    </figure>
  );
}

let detector: Promise<FaceDetector> | null = null;
/** MediaPipe loads only when someone asks for auto-reframe (its model is a few MB). */
const getDetector = () => (detector ??= import("@cutiva/web/mediapipe").then((m) => m.createMediaPipeFaceDetector()).catch((e: unknown) => {
  detector = null;
  throw e;
}));

/** Cut a face out of a source frame for an avatar. */
async function avatar(engine: WebEngine, assetId: string, assetW: number, face: { atUs: Us; x: number; y: number; w: number; h: number }): Promise<string | null> {
  const frame = await engine.sourceFrame(assetId, face.atUs);
  if (!frame) return null;
  const s = frame.width / assetW;
  const size = Math.max(face.w, face.h) * 1.4;
  const out = Object.assign(document.createElement("canvas"), { width: 64, height: 64 });
  out.getContext("2d")?.drawImage(frame, (face.x + face.w / 2 - size / 2) * s, (face.y + face.h / 2 - size / 2) * s, size * s, size * s, 0, 0, 64, 64);
  return out.toDataURL("image/jpeg", 0.8);
}

interface Props {
  engine: WebEngine;
  editor: Editor;
  project: Project;
  clip: Clip;
  onSeek: (t: Us) => void;
  onError: (e: unknown) => void;
}

export function AutoReframePanel({ engine, editor, project, clip, onSeek, onError }: Props) {
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<AutoReframeClipResult | null>(null);
  const [before, setBefore] = useState<ReframeKey[]>([]);
  const [avatars, setAvatars] = useState<Record<string, string>>({});
  const [zoom, setZoom] = useState(1);
  const abort = useRef<AbortController | null>(null);
  const asset = project.assets.find((a) => a.id === clip.assetId);
  const { width, height } = project.settings;
  const sameShape = asset?.width && asset.height ? Math.abs(asset.width / asset.height - width / height) < 0.01 : false;

  useEffect(() => {
    setResult(null);
    setAvatars({});
  }, [clip.id]);

  useEffect(() => {
    if (!result || !asset?.width) return;
    let current = true;
    void (async () => {
      const out: Record<string, string> = {};
      for (const p of result.people) {
        const url = await avatar(engine, clip.assetId, asset.width!, p.face).catch(() => null);
        if (url) out[p.id] = url;
      }
      if (current) setAvatars(out);
    })();
    return () => {
      current = false;
    };
  }, [result?.analysis, engine, clip.assetId, asset?.width]);

  async function run(nextZoom = zoom) {
    const controller = new AbortController();
    abort.current = controller;
    if (!result) setBefore(reframeKeys(clip) ?? []);
    setProgress(result ? null : 0);
    try {
      const d = await getDetector();
      const r = await engine.autoReframe(clip.id, {
        detector: d,
        zoom: nextZoom,
        signal: controller.signal,
        onProgress: setProgress,
        ...(result ? { analysis: result.analysis } : {}),
      });
      setResult(r);
    } catch (e) {
      onError(e);
    } finally {
      setProgress(null);
      abort.current = null;
    }
  }

  const changes = result ? result.keys.filter((k) => k.cut && k.atUs > clip.sourceInUs && k.atUs < clip.sourceOutUs) : [];
  const people = result ? [...result.people].sort((a, b) => b.speakingUs - a.speakingUs) : [];

  return (
    <fieldset className="reframe">
      <legend>Auto-reframe</legend>
      <p className="muted small">Finds who is talking and frames them for the project's format. Detection runs on this device.</p>
      {sameShape && (
        <p className="small">
          This clip already has the project's shape. Pick another format first.{" "}
          <button type="button" className="link" onClick={() => editor.dispatch({ type: "project.setSize", width: 1080, height: 1920 })}>
            Switch to 9:16
          </button>
        </p>
      )}
      {progress !== null ? (
        <>
          <p className="small">Watching the clip… {Math.round(progress * 100)}%</p>
          <progress max={1} value={progress} />
          <button type="button" onClick={() => abort.current?.abort()}>Cancel</button>
        </>
      ) : (
        <button type="button" className="primary" disabled={sameShape || !asset?.width} onClick={() => void run()}>
          {result ? "Auto-reframe again" : "Auto-reframe"}
        </button>
      )}
      {result && progress === null && (
        <div className="reframe__result" role="status">
          <p className="small">
            {people.length} {people.length === 1 ? "person" : "people"} · {changes.length} framing {changes.length === 1 ? "change" : "changes"}
            {result.shotStartsUs.length > 1 ? ` · ${result.shotStartsUs.length} shots` : ""}
          </p>
          <ul className="people">
            {people.map((p) => (
              <li key={p.id}>
                {avatars[p.id] ? <img src={avatars[p.id]} alt="" width={32} height={32} /> : <span className="people__blank" />}
                <span className={p.speakingUs ? "" : "muted"}>{p.speakingUs ? `${Math.round(p.speakingUs / 1e6)} s` : "not framed"}</span>
              </li>
            ))}
          </ul>
          <label>
            Zoom <span className="muted">{zoom.toFixed(1)}×</span>
            <input
              type="range"
              min={1}
              max={2.5}
              step={0.1}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              onPointerUp={() => void run(zoom)}
              onKeyUp={() => void run(zoom)}
            />
          </label>
          <div className="row">
            <button
              type="button"
              onClick={() => {
                editor.dispatch({ type: "clip.setReframe", clipId: clip.id, keys: before });
                setResult(null);
              }}
            >
              Restore
            </button>
          </div>
          <ReframeFeedback project={project} clip={clip} result={result} zoom={zoom} onSeek={onSeek} />
        </div>
      )}
    </fieldset>
  );
}
