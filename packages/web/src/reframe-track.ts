import {
  CutivaError,
  editReframeTrack,
  findClip,
  planReframe,
  reframeTrack,
  type Asset,
  type Clip,
  type Editor,
  type ReframeEdit,
  type ReframePlanResult,
} from "@cutiva/core";
import type { MediaRegistry } from "./media.js";
import { analyzeAsset, type AnalyzeOptions, type ReframeAnalysis } from "./reframe.js";

export interface ReframeOptions extends Omit<AnalyzeOptions, "sourceInUs" | "sourceOutUs" | "detector"> {
  /** Needed only when the clip's part of the source hasn't been analysed yet (or with `reanalyze`). */
  detector?: AnalyzeOptions["detector"];
  /** Analyse again even when a cached analysis covers the clip. */
  reanalyze?: boolean;
}

export interface ReframeClipResult extends ReframePlanResult {
  analysis: ReframeAnalysis;
}

const DB_NAME = "cutiva";
const STORE = "reframe-analysis";

/**
 * Analyses kept so that edits can re-plan without decoding again (ADR 0006: observations stay out
 * of the project). In memory by asset id, and in IndexedDB by the asset's fingerprint so they
 * survive a reload. IndexedDB failures (private mode, blocked storage) only cost a re-analysis.
 */
export class AnalysisCache {
  private readonly memory = new Map<string, ReframeAnalysis>();
  private db: Promise<IDBDatabase | null> | null = null;

  /** An analysis of `asset` that covers `[fromUs, toUs)`, or null. */
  async get(asset: Asset, fromUs: number, toUs: number): Promise<ReframeAnalysis | null> {
    const covers = (a: ReframeAnalysis | null | undefined): a is ReframeAnalysis => !!a && a.fromUs <= fromUs && a.toUs >= toUs;
    const inMemory = this.memory.get(asset.id);
    if (covers(inMemory)) return inMemory;
    const key = this.key(asset);
    if (!key) return null;
    const stored = await this.read(key);
    if (!covers(stored)) return null;
    const analysis = { ...stored, assetId: asset.id };
    this.memory.set(asset.id, analysis);
    return analysis;
  }

  /** The analysis in memory, without waiting for IndexedDB. */
  peek(assetId: string): ReframeAnalysis | null {
    return this.memory.get(assetId) ?? null;
  }

  async put(asset: Asset, analysis: ReframeAnalysis): Promise<void> {
    this.memory.set(asset.id, analysis);
    const key = this.key(asset);
    if (key) await this.write(key, analysis);
  }

  private key(asset: Asset): string | null {
    const f = asset.fingerprint;
    return f?.sha256Head ? `${f.size}:${f.sha256Head}` : null;
  }

  private open(): Promise<IDBDatabase | null> {
    this.db ??= new Promise((resolve) => {
      try {
        if (typeof indexedDB === "undefined") return resolve(null);
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return this.db;
  }

  private async read(key: string): Promise<ReframeAnalysis | null> {
    const db = await this.open();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
        req.onsuccess = () => resolve((req.result as ReframeAnalysis | undefined) ?? null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  private async write(key: string, analysis: ReframeAnalysis): Promise<void> {
    const db = await this.open();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(analysis, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  }
}

function videoAsset(editor: Editor, clipId: string): { clip: Clip; asset: Asset & { width: number; height: number } } {
  const { clip } = findClip(editor.project, clipId);
  const asset = editor.project.assets.find((a) => a.id === clip.assetId);
  if (!asset) throw new CutivaError("ASSET_NOT_FOUND", `Clip "${clipId}" refers to a missing asset.`);
  if (asset.kind !== "video") throw new CutivaError("TRACK_KIND_MISMATCH", `Only video clips can be reframed ("${clipId}" is audio).`);
  if (!asset.width || !asset.height) throw new CutivaError("ASSET_SIZE_UNKNOWN", `Clip "${clipId}" has no video size to reframe.`);
  return { clip, asset: asset as Asset & { width: number; height: number } };
}

/** Plan a clip from an analysis and its current Reframe Track, for the project's format. Pure: touches nothing. */
function plan(editor: Editor, clip: Clip, asset: Asset & { width: number; height: number }, analysis: ReframeAnalysis, track = reframeTrack(clip)): ReframeClipResult {
  const inClip = (t: number) => t >= clip.sourceInUs && t < clip.sourceOutUs;
  const { width, height } = editor.project.settings;
  const result = planReframe({
    sourceWidth: asset.width,
    sourceHeight: asset.height,
    outputWidth: width,
    outputHeight: height,
    durationUs: analysis.durationUs,
    frames: analysis.frames.filter((f) => inClip(f.atUs)),
    cuts: analysis.cuts.filter(inClip),
    ...(analysis.activeArea ? { activeArea: analysis.activeArea } : {}),
    ...(track ? { track } : {}),
  });
  return { ...result, analysis };
}

async function cachedAnalysis(cache: AnalysisCache, clip: Clip, asset: Asset): Promise<ReframeAnalysis> {
  const analysis = await cache.get(asset, clip.sourceInUs, clip.sourceOutUs);
  if (!analysis) throw new CutivaError("ANALYSIS_NEEDED", `Clip "${clip.id}" has to be analysed again before its framing can be re-planned.`);
  return analysis;
}

/**
 * Frame a clip with the reframe planner: analyse its part of the source (or reuse the cached
 * analysis), plan segments, people and layouts with the clip's current Reframe Track (so names,
 * flags and locked segments carry over), and apply keys and track as one undoable `clip.setReframe`.
 * Throws ANALYSIS_NEEDED when there is no cached analysis and no `detector`.
 */
export async function reframeClip(editor: Editor, media: MediaRegistry, cache: AnalysisCache, clipId: string, options: ReframeOptions = {}): Promise<ReframeClipResult> {
  const { clip, asset } = videoAsset(editor, clipId);
  let analysis = options.reanalyze ? null : await cache.get(asset, clip.sourceInUs, clip.sourceOutUs);
  if (!analysis) {
    const { detector, reanalyze: _, ...rest } = options;
    if (!detector) throw new CutivaError("ANALYSIS_NEEDED", `Clip "${clipId}" hasn't been analysed yet; pass a detector.`);
    analysis = await analyzeAsset(media, asset.id, { ...rest, detector, sourceInUs: clip.sourceInUs, sourceOutUs: clip.sourceOutUs });
    await cache.put(asset, analysis);
  }
  // The clip may have changed while the analysis ran.
  const current = videoAsset(editor, clipId);
  const result = plan(editor, current.clip, current.asset, analysis);
  editor.dispatch({ type: "clip.setReframe", clipId, keys: result.keys, track: result.track });
  return result;
}

/**
 * Apply edits to a clip's Reframe Track (a segment's layout or focus, a person's flags, a merge,
 * camera style) and re-plan, as one undoable `clip.setReframe`. Needs the cached analysis: throws
 * ANALYSIS_NEEDED without it, and SEGMENT_NOT_FOUND, PERSON_NOT_FOUND or INVALID_RANGE for a bad edit.
 */
export async function editClipReframe(editor: Editor, cache: AnalysisCache, clipId: string, edits: ReframeEdit | ReframeEdit[]): Promise<ReframeClipResult> {
  const { clip, asset } = videoAsset(editor, clipId);
  const track = reframeTrack(clip);
  if (!track) throw new CutivaError("ANALYSIS_NEEDED", `Clip "${clipId}" has no Reframe Track; reframe it first.`);
  const analysis = await cachedAnalysis(cache, clip, asset);
  const next = (Array.isArray(edits) ? edits : [edits]).reduce(editReframeTrack, track);
  const current = videoAsset(editor, clipId);
  const result = plan(editor, current.clip, current.asset, analysis, next);
  editor.dispatch({ type: "clip.setReframe", clipId, keys: result.keys, track: result.track });
  return result;
}

/**
 * The plan of a reframed clip from the cached analysis, without changing the project: for faces and
 * avatars (`sightings`), or, with `edits`, to preview edits or apply several clips' plans in one
 * `editor.batch`. Null without a track or a cached analysis.
 */
export async function clipReframePlan(editor: Editor, cache: AnalysisCache, clipId: string, edits: ReframeEdit | ReframeEdit[] = []): Promise<ReframeClipResult | null> {
  const { clip, asset } = videoAsset(editor, clipId);
  const track = reframeTrack(clip);
  if (!track) return null;
  const analysis = await cache.get(asset, clip.sourceInUs, clip.sourceOutUs);
  if (!analysis) return null;
  const current = videoAsset(editor, clipId);
  return plan(editor, current.clip, current.asset, analysis, (Array.isArray(edits) ? edits : [edits]).reduce(editReframeTrack, track));
}
