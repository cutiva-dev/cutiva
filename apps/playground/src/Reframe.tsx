import {
  clipEndUs,
  CutivaError,
  reframeKeys,
  reframeStyle,
  reframeTrack,
  sourceTimeAt,
  type Clip,
  type Editor,
  type PlanSighting,
  type Project,
  type ReframeEdit,
  type ReframeKey,
  type ReframeTrack,
  type TrackSegment,
  type Us,
} from "@cutiva/core";
import { personColor, ReframeBox, segmentCaption, type ReframeBoxFace } from "@cutiva/react";
import type { AnalyzeStage, FaceDetector, ReframeClipResult, WebEngine } from "@cutiva/web";
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

/** "16:9 landscape" for a size in FORMATS, else "1920×1080". */
const formatName = (width: number, height: number) => FORMATS.find((f) => f.width === width && f.height === height)?.label ?? `${width}×${height}`;

/** The source time the playhead shows in a clip (clamped inside it). */
export const clipSourceUs = (clip: Clip, timeUs: Us): Us => sourceTimeAt(clip, Math.min(Math.max(timeUs, clip.startUs), clipEndUs(clip) - 1));

/** The track segment at a source time. */
export const segmentAt = (track: ReframeTrack | null, sourceUs: Us): TrackSegment | null =>
  track?.segments.find((s) => s.startUs <= sourceUs && sourceUs < s.endUs) ?? null;

/** Who a segment frames: one person for single, two for split, nobody for wide. */
function framed(segment: TrackSegment | null): string[] {
  if (!segment || segment.resolved === "wide") return [];
  const who = segment.focus.length ? segment.focus : segment.speakers;
  return segment.resolved === "split" ? who.slice(0, 2) : who.slice(0, 1);
}

/**
 * The selected clip's reframe plan from the cached analysis (faces, avatars), kept in step with the
 * clip's Reframe Track. `missing` means the clip has a track but its analysis isn't on this device.
 */
export function useReframePlan(engine: WebEngine, clip: Clip | null): { plan: ReframeClipResult | null; missing: boolean; setPlan: (p: ReframeClipResult) => void } {
  const [state, setState] = useState<{ clipId: string; trackJson: string; plan: ReframeClipResult | null } | null>(null);
  const track = clip ? reframeTrack(clip) : null;
  const trackJson = track ? JSON.stringify(track) : "";
  const fresh = !!clip && state?.clipId === clip.id && state.trackJson === trackJson;
  useEffect(() => {
    if (!clip || !track || fresh) return;
    let live = true;
    void engine
      .reframePlan(clip.id)
      .catch(() => null)
      .then((plan) => live && setState({ clipId: clip.id, trackJson, plan }));
    return () => {
      live = false;
    };
  }, [engine, clip?.id, trackJson, fresh]);
  if (!clip || !track) return { plan: null, missing: false, setPlan: () => undefined };
  const plan = fresh ? state!.plan : state?.clipId === clip.id ? state.plan : null;
  return {
    plan,
    missing: fresh && state!.plan === null,
    // After an edit the engine returns the new plan; keep it so nothing is planned twice.
    setPlan: (p) => setState({ clipId: clip.id, trackJson: JSON.stringify(p.track), plan: p }),
  };
}

/** Faces of each person near a source time (within one analysis step). */
function facesAt(sightings: PlanSighting[], sourceUs: Us, stepUs: Us): PlanSighting[] {
  const best = new Map<string, PlanSighting>();
  for (const s of sightings) {
    const d = Math.abs(s.atUs - sourceUs);
    if (d > stepUs) continue;
    const cur = best.get(s.personId);
    if (!cur || d < Math.abs(cur.atUs - sourceUs) || (d === Math.abs(cur.atUs - sourceUs) && s.w * s.h > cur.w * cur.h)) best.set(s.personId, s);
  }
  return [...best.values()];
}

interface SourceMonitorProps {
  engine: WebEngine;
  editor: Editor;
  clip: Clip;
  project: Project;
  timeUs: Us;
  plan: ReframeClipResult | null;
  onEdit: (edit: ReframeEdit) => void;
}

/** The selected clip's whole source frame with its draggable crop window and clickable faces on top. */
export function SourceMonitor({ engine, editor, clip, project, timeUs, plan, onEdit }: SourceMonitorProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const asset = project.assets.find((a) => a.id === clip.assetId);
  const sourceUs = clipSourceUs(clip, timeUs);
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
  const track = reframeTrack(clip);
  const segment = segmentAt(track, sourceUs);
  const focused = framed(segment);
  const faces: ReframeBoxFace[] =
    track && plan
      ? facesAt(plan.sightings, sourceUs, Math.round(1e6 / plan.analysis.fps)).flatMap((s) => {
          const person = track.people.find((p) => p.id === s.personId);
          return person ? [{ id: s.personId, label: person.label, x: s.x, y: s.y, w: s.w, h: s.h, color: personColor(track, s.personId), focused: focused.includes(s.personId) }] : [];
        })
      : [];
  return (
    <figure className="source">
      {/* Exactly the source's shape, so the window's percentages line up with the picture. */}
      <div className="screen screen--source" style={{ aspectRatio: `${asset.width} / ${asset.height}`, width: `min(100%, calc(46vh * ${asset.width / asset.height}))` }}>
        <canvas ref={canvas} aria-label="Source frame" />
        <ReframeBox
          editor={editor}
          clipId={clip.id}
          timeUs={timeUs}
          faces={faces}
          onFaceClick={(id) => segment && onEdit({ type: "segment", segmentId: segment.id, focus: [id], layout: "single" })}
          {...(track && segment ? { onWindow: (window: { x: number; y: number; h: number }) => onEdit({ type: "segment", segmentId: segment.id, window }) } : {})}
        />
      </div>
      <figcaption className="muted">
        {track ? "Click a face to frame that person here, or drag the window. Either locks this segment." : "Drag the window to move the framing at the playhead."}
      </figcaption>
    </figure>
  );
}

type TestWindow = Window & { __cutivaFaceDetector?: FaceDetector };
let detector: Promise<FaceDetector> | null = null;
/** MediaPipe loads only when someone asks for auto-reframe (its model is a few MB). E2E tests may provide a detector instead. */
const getDetector = () =>
  (detector ??= (async () => {
    const test = (window as TestWindow).__cutivaFaceDetector;
    if (test) return test;
    const m = await import("@cutiva/web/mediapipe");
    return m.createMediaPipeFaceDetector();
  })().catch((e: unknown) => {
    detector = null;
    throw e;
  }));

/** Cut a face out of a source frame for an avatar. */
async function avatar(engine: WebEngine, assetId: string, assetW: number, face: PlanSighting): Promise<string | null> {
  const frame = await engine.sourceFrame(assetId, face.atUs);
  if (!frame) return null;
  const s = frame.width / assetW;
  const size = Math.max(face.w, face.h) * 1.4;
  const out = Object.assign(document.createElement("canvas"), { width: 64, height: 64 });
  out.getContext("2d")?.drawImage(frame, (face.x + face.w / 2 - size / 2) * s, (face.y + face.h / 2 - size / 2) * s, size * s, size * s, 0, 0, 64, 64);
  return out.toDataURL("image/jpeg", 0.8);
}

const STAGE = { video: "Finding faces", audio: "Reading the audio" } as const;
const STYLES = [
  { value: 0, label: "Calm" },
  { value: 50, label: "Balanced" },
  { value: 100, label: "Dynamic" },
] as const;
const REASON: Record<TrackSegment["reason"], string> = {
  "lips+voice": "the person talking",
  overlap: "two people talking at once",
  "no-face": "no faces",
  "voice-only": "a voice with no face on screen",
  "never-focus": "only someone marked Never focus is talking",
  "low-quality": "a crop would need too much upscaling",
  user: "your choice",
};

interface Props {
  engine: WebEngine;
  editor: Editor;
  project: Project;
  clip: Clip;
  timeUs: Us;
  plan: ReframeClipResult | null;
  missing: boolean;
  onPlan: (plan: ReframeClipResult) => void;
  onEdit: (edit: ReframeEdit | ReframeEdit[]) => void;
  onSeek: (t: Us) => void;
  onError: (e: unknown) => void;
}

export function AutoReframePanel({ engine, editor, project, clip, timeUs, plan, missing, onPlan, onEdit, onSeek, onError }: Props) {
  const [progress, setProgress] = useState<{ ratio: number; stage: AnalyzeStage } | null>(null);
  const [before, setBefore] = useState<{ clipId: string; keys: ReframeKey[] } | null>(null);
  const [avatars, setAvatars] = useState<Record<string, string>>({});
  const [style, setStyle] = useState<number | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  const asset = project.assets.find((a) => a.id === clip.assetId);
  const { width, height } = project.settings;
  const sameShape = asset?.width && asset.height ? Math.abs(asset.width / asset.height - width / height) < 0.01 : false;
  const track = reframeTrack(clip);
  const sourceUs = clipSourceUs(clip, timeUs);
  const segment = segmentAt(track, sourceUs);
  const faces = track?.people.filter((p) => p.kind === "face") ?? [];

  useEffect(() => {
    setStyle(null);
    setZoom(null);
  }, [clip.id, track?.style, track?.zoomPct]);

  // One avatar per person: their largest sighting.
  const avatarKey = plan ? `${clip.assetId}:${plan.track.people.map((p) => p.id).join(",")}:${plan.sightings.length}` : "";
  useEffect(() => {
    if (!plan || !asset?.width) return;
    let live = true;
    void (async () => {
      const largest = new Map<string, PlanSighting>();
      for (const s of plan.sightings) if ((largest.get(s.personId)?.w ?? 0) < s.w) largest.set(s.personId, s);
      const out: Record<string, string> = {};
      for (const [id, face] of largest) {
        const url = await avatar(engine, clip.assetId, asset.width!, face).catch(() => null);
        if (url) out[id] = url;
      }
      if (live) setAvatars(out);
    })();
    return () => {
      live = false;
    };
  }, [avatarKey]);

  async function analyze(reanalyze: boolean) {
    const controller = new AbortController();
    abort.current = controller;
    if (!track && before?.clipId !== clip.id) setBefore({ clipId: clip.id, keys: reframeKeys(clip) ?? [] });
    setProgress({ ratio: 0, stage: "video" });
    try {
      const d = await getDetector();
      const r = await engine.reframe(clip.id, { detector: d, reanalyze, signal: controller.signal, onProgress: (ratio, stage) => setProgress({ ratio, stage }) });
      onPlan(r);
    } catch (e) {
      if (!(e instanceof CutivaError && e.code === "ANALYSIS_CANCELLED")) onError(e);
    } finally {
      setProgress(null);
      abort.current = null;
    }
  }

  /** Apply the camera style and zoom of this clip to every other reframed clip, as one undo step. */
  async function applyToAll() {
    if (!track) return;
    const settings: ReframeEdit = { type: "settings", style: track.style, zoomPct: track.zoomPct };
    const others = project.tracks.flatMap((t) => t.clips).filter((c) => c.id !== clip.id && reframeTrack(c));
    try {
      const plans = await Promise.all(others.map(async (c) => ({ c, p: await engine.reframePlan(c.id, settings) })));
      const ready = plans.filter((x) => x.p);
      if (ready.length) editor.batch(ready.map(({ c, p }) => ({ type: "clip.setReframe" as const, clipId: c.id, keys: p!.keys, track: p!.track })));
      const skipped = plans.length - ready.length;
      if (skipped) onError(new Error(`${skipped} clip(s) need to be analysed again before they can take these settings.`));
    } catch (e) {
      onError(e);
    }
  }

  const styleNow = style ?? track?.style ?? 50;
  const zoomNow = zoom ?? track?.zoomPct ?? 100;
  const styleLabel = STYLES.reduce((a, b) => (Math.abs(b.value - styleNow) < Math.abs(a.value - styleNow) ? b : a)).label;
  const hold = reframeStyle(styleNow).holdUs / 1e6;
  const segIndex = segment && track ? track.segments.indexOf(segment) + 1 : 0;
  const lock = (edit: Omit<Extract<ReframeEdit, { type: "segment" }>, "type" | "segmentId">) => segment && onEdit({ type: "segment", segmentId: segment.id, ...edit });
  const area = track?.activeArea;

  return (
    <fieldset className="reframe">
      <legend>Auto-reframe</legend>
      <p className="muted small">Finds who is talking and frames them for the project's format. Detection runs on this device.</p>
      {sameShape && (
        <div className="notice small" role="note">
          <p>
            The project is {formatName(width, height)}, the same shape as this clip, so there is nothing to reframe. To make a{" "}
            {width >= height ? "vertical" : "landscape"} version, change the project's format.
          </p>
          <button type="button" className="primary" onClick={() => editor.dispatch({ type: "project.setSize", width: width >= height ? 1080 : 1920, height: width >= height ? 1920 : 1080 })}>
            {width >= height ? "Switch to 9:16 vertical" : "Switch to 16:9 landscape"}
          </button>
        </div>
      )}
      {progress !== null ? (
        <div role="status">
          <p className="small">
            {STAGE[progress.stage]}… {Math.round(progress.ratio * 100)}%
          </p>
          <progress max={1} value={progress.ratio} aria-label="Analysis progress" />
          <button type="button" onClick={() => abort.current?.abort()}>Cancel</button>
        </div>
      ) : !track ? (
        <button type="button" className="primary" disabled={sameShape || !asset?.width} onClick={() => void analyze(false)}>
          Analyze
        </button>
      ) : null}

      {track && progress === null && (
        <div className="reframe__result">
          <p className="small" role="status">
            {faces.length} {faces.length === 1 ? "person" : "people"} · {track.segments.length} {track.segments.length === 1 ? "segment" : "segments"}
          </p>
          {missing && (
            <div className="notice small" role="note">
              <p>This clip's analysis isn't on this device (it isn't saved in the project). Analyze again to change people or the camera style; locked segments stay as they are.</p>
              <button type="button" onClick={() => void analyze(true)}>Analyze again</button>
            </div>
          )}
          {area && asset?.width && asset.height && (area.w < asset.width || area.h < asset.height) && (
            <p className="notice small">
              Black bars removed: framing uses {area.w}×{area.h} of the {asset.width}×{asset.height} picture.
            </p>
          )}

          {segment && (
            <section className="segment" aria-label="Segment at the playhead">
              <h3>
                Segment {segIndex} <span className="muted">· {segment.locked ? "locked" : "automatic"}</span>
              </h3>
              <p className="small">
                {segment.resolved === "wide" ? "Wide (the whole picture)" : segmentCaption(track, segment)}
                <span className="muted"> · {REASON[segment.reason]}</span>
              </p>
              {segment.reason === "low-quality" && (
                <div className="notice small" role="note">
                  <p>Low quality crop: framing one person here would upscale the picture past {track.maxUpscalePct / 100}×, so it's wide.</p>
                  <button type="button" disabled={missing} onClick={() => lock({ layout: "single" })}>Keep crop</button>
                </div>
              )}
              {segment.reason === "no-face" && !segment.locked && (
                <div className="notice small" role="note">
                  <p>No faces here, so the whole picture shows (wide).</p>
                  <button type="button" disabled={missing || !asset?.width || !asset.height} onClick={() => lock({ window: { x: Math.floor(asset!.width! / 2), y: Math.floor(asset!.height! / 2), h: asset!.height! } })}>
                    Crop to center
                  </button>
                </div>
              )}
              <div className="segmented" role="radiogroup" aria-label="Layout">
                {(["auto", "single", "split", "wide"] as const).map((l) => {
                  const on = segment.locked ? segment.layout === l : l === "auto";
                  const needsTwo = l === "split" && faces.length < 2;
                  return (
                    <button
                      key={l}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      className={`chip${on ? " is-on" : ""}`}
                      disabled={missing || needsTwo || (l === "single" && faces.length === 0)}
                      onClick={() => {
                        if (l === "auto") onEdit({ type: "reset", segmentId: segment.id });
                        else if (l === "split") {
                          const two = [...new Set([...framed(segment), ...segment.speakers, ...faces.map((f) => f.id)])].filter((id) => faces.some((f) => f.id === id)).slice(0, 2);
                          lock({ layout: "split", focus: two });
                        } else if (l === "single") {
                          const one = framed(segment)[0] ?? segment.speakers.find((id) => faces.some((f) => f.id === id)) ?? faces[0]!.id;
                          lock({ layout: "single", focus: [one] });
                        } else lock({ layout: "wide", focus: [] });
                      }}
                    >
                      {l === "auto" ? "Auto" : l[0]!.toUpperCase() + l.slice(1)}
                    </button>
                  );
                })}
              </div>
              {faces.length > 0 && segment.resolved !== "wide" && (
                <div className="focus" role="group" aria-label="Focus on">
                  <span className="muted small">Focus on</span>
                  {faces.map((p) => {
                    const on = framed(segment).includes(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        className={`chip chip--person${on ? " is-on" : ""}`}
                        style={{ ["--person" as string]: personColor(track, p.id) }}
                        aria-pressed={on}
                        disabled={missing}
                        onClick={() => lock({ layout: "single", focus: [p.id] })}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              )}
              {segment.locked && (
                <button type="button" className="link" disabled={missing} onClick={() => onEdit({ type: "reset", segmentId: segment.id })}>
                  Reset to automatic
                </button>
              )}
            </section>
          )}

          <label>
            Camera style <span className="muted">{styleLabel} · holds {hold.toFixed(1)} s before switching</span>
            <input
              type="range"
              aria-label="Camera style"
              min={0}
              max={100}
              step={25}
              value={styleNow}
              disabled={missing}
              onChange={(e) => setStyle(Number(e.target.value))}
              onPointerUp={() => style !== null && style !== track.style && onEdit({ type: "settings", style })}
              onKeyUp={() => style !== null && style !== track.style && onEdit({ type: "settings", style })}
            />
            <span className="scale muted small" aria-hidden="true">
              <span>Calm</span>
              <span>Balanced</span>
              <span>Dynamic</span>
            </span>
          </label>
          <label>
            Zoom <span className="muted">{(zoomNow / 100).toFixed(1)}×</span>
            <input
              type="range"
              aria-label="Zoom"
              min={100}
              max={250}
              step={10}
              value={zoomNow}
              disabled={missing}
              onChange={(e) => setZoom(Number(e.target.value))}
              onPointerUp={() => zoom !== null && zoom !== track.zoomPct && onEdit({ type: "settings", zoomPct: zoom })}
              onKeyUp={() => zoom !== null && zoom !== track.zoomPct && onEdit({ type: "settings", zoomPct: zoom })}
            />
          </label>

          <fieldset className="people-panel">
            <legend>People</legend>
            {track.people.length === 0 && <p className="muted small">Nobody found in this clip.</p>}
            <ul className="people">
              {track.people.map((p) => (
                <li key={p.id} style={{ ["--person" as string]: personColor(track, p.id) }}>
                  {avatars[p.id] ? <img src={avatars[p.id]} alt="" width={32} height={32} /> : <span className="people__blank" />}
                  <div className="people__body">
                    <input
                      key={`${p.id}:${p.label}`}
                      aria-label={`Name of ${p.label}`}
                      defaultValue={p.label}
                      maxLength={60}
                      onBlur={(e) => {
                        const label = e.target.value.trim();
                        if (label && label !== p.label) onEdit({ type: "person", personId: p.id, label });
                        else e.target.value = p.label;
                      }}
                      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                    />
                    {p.kind === "face" ? (
                      <div className="people__flags">
                        <label className="check">
                          <input type="checkbox" checked={p.priority} disabled={missing} onChange={(e) => onEdit({ type: "person", personId: p.id, priority: e.target.checked })} />
                          Priority
                        </label>
                        <label className="check">
                          <input type="checkbox" checked={p.neverFocus} disabled={missing} onChange={(e) => onEdit({ type: "person", personId: p.id, neverFocus: e.target.checked })} />
                          Never focus
                        </label>
                        {faces.length > 1 && (
                          <select
                            aria-label={`${p.label} is the same person as`}
                            value=""
                            disabled={missing}
                            onChange={(e) => e.target.value && onEdit({ type: "merge", personId: p.id, intoId: e.target.value })}
                          >
                            <option value="">Same person as…</option>
                            {faces
                              .filter((o) => o.id !== p.id)
                              .map((o) => (
                                <option key={o.id} value={o.id}>{o.label}</option>
                              ))}
                          </select>
                        )}
                      </div>
                    ) : (
                      <span className="muted small">Voice with no face on screen</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </fieldset>

          <div className="row">
            <button type="button" disabled={missing} onClick={() => void applyToAll()}>Apply to every clip</button>
            <button type="button" onClick={() => void analyze(true)}>Analyze again</button>
            <button
              type="button"
              onClick={() => editor.dispatch({ type: "clip.setReframe", clipId: clip.id, keys: before?.clipId === clip.id ? before.keys : [], track: null })}
            >
              Remove auto-reframe
            </button>
          </div>
          {plan && <ReframeFeedback project={project} clip={clip} plan={plan} onSeek={onSeek} />}
        </div>
      )}
    </fieldset>
  );
}
