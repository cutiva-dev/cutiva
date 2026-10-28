import { CutivaError, type Asset, type Editor, randomId, type IdFactory } from "@cutiva/core";
import {
  ALL_FORMATS,
  BlobSource,
  CanvasSink,
  Input,
  type InputAudioTrack,
  type InputVideoTrack,
} from "mediabunny";

export interface MediaEntry {
  asset: Asset;
  blob: Blob;
  input: Input;
  video: InputVideoTrack | null;
  audio: InputAudioTrack | null;
  /** Lazily created, one per asset, for preview frames. */
  previewSink?: CanvasSink;
  /** Lazily decoded full audio, for preview playback and export mixing. */
  audioBuffer?: Promise<AudioBuffer | null>;
}

const HEAD_BYTES = 64 * 1024;

async function sha256Head(blob: Blob): Promise<string | undefined> {
  if (typeof crypto === "undefined" || !crypto.subtle) return undefined;
  const bytes = await blob.slice(0, HEAD_BYTES).arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Keeps the actual media (Blobs) that the project's assets point to. */
export class MediaRegistry {
  private entries = new Map<string, MediaEntry>();
  constructor(private ids: IdFactory = randomId) {}

  get(assetId: string): MediaEntry | undefined {
    return this.entries.get(assetId);
  }

  /** Assets in the project that have no media loaded (e.g. after opening a saved project). */
  missing(assets: readonly Asset[]): Asset[] {
    return assets.filter((a) => !this.entries.has(a.id));
  }

  /** Read a local file: duration, size, audio presence, fingerprint. Does not touch the project. */
  async probe(file: File | Blob, name = file instanceof File ? file.name : "media"): Promise<MediaEntry> {
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
    let video: InputVideoTrack | null;
    let audio: InputAudioTrack | null;
    let duration: number;
    try {
      [video, audio] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()]);
      duration = await input.computeDuration();
    } catch (err) {
      throw new CutivaError("UNSUPPORTED_CODEC", `Cannot read "${name}": ${(err as Error).message}`);
    }
    if (!video && !audio) throw new CutivaError("UNSUPPORTED_CODEC", `"${name}" has no video or audio track.`);
    if (video && !(await video.canDecode())) {
      throw new CutivaError("UNSUPPORTED_CODEC", `This browser cannot decode the video in "${name}".`);
    }
    const asset: Asset = {
      id: this.ids("ast"),
      kind: video ? "video" : "audio",
      name,
      uri: `file://${encodeURIComponent(name)}`,
      durationUs: Math.max(1, Math.round(duration * 1_000_000)),
      ...(video ? { width: video.displayWidth, height: video.displayHeight, hasAudio: audio !== null } : {}),
      fingerprint: { size: file.size, ...(await sha256Head(file).then((h) => (h ? { sha256Head: h } : {}))) },
    };
    return { asset, blob: file, input, video, audio };
  }

  register(entry: MediaEntry): void {
    this.entries.set(entry.asset.id, entry);
  }

  /**
   * Attach a local file to an existing asset of an opened project, matching by fingerprint.
   * Returns the asset id it was linked to, or null when no asset matches.
   */
  async relink(file: File | Blob, assets: readonly Asset[]): Promise<string | null> {
    const head = await sha256Head(file);
    const match = assets.find(
      (a) =>
        !this.entries.has(a.id) &&
        a.fingerprint?.size === file.size &&
        (a.fingerprint.sha256Head === undefined || a.fingerprint.sha256Head === head),
    );
    if (!match) return null;
    const probed = await this.probe(file, match.name);
    this.register({ ...probed, asset: match });
    return match.id;
  }

  previewSink(entry: MediaEntry, maxWidth: number): CanvasSink | null {
    if (!entry.video) return null;
    if (!entry.previewSink) {
      const width = Math.min(maxWidth, entry.video.displayWidth);
      entry.previewSink = new CanvasSink(entry.video, { width, poolSize: 2 });
    }
    return entry.previewSink;
  }

  /** Decode an asset's whole audio once. Null when it has none or the browser can't decode it. */
  audioBuffer(entry: MediaEntry, ctx: BaseAudioContext): Promise<AudioBuffer | null> {
    if (!entry.audio) return Promise.resolve(null);
    entry.audioBuffer ??= entry.blob
      .arrayBuffer()
      .then((bytes) => ctx.decodeAudioData(bytes))
      .catch(() => null);
    return entry.audioBuffer;
  }
}

/** Import a file into the editor: probe it, keep its media, add the asset and a clip at the end of its track. */
export async function importFile(
  editor: Editor,
  media: MediaRegistry,
  file: File | Blob,
  options: { addClip?: boolean } = {},
): Promise<{ assetId: string; clipId?: string }> {
  const entry = await media.probe(file);
  media.register(entry);
  if (options.addClip === false) {
    editor.dispatch({ type: "asset.add", asset: entry.asset });
    return { assetId: entry.asset.id };
  }
  const clipId = randomId("clip");
  // One undo step: the asset and its clip arrive together.
  editor.batch([
    { type: "asset.add", asset: entry.asset },
    { type: "clip.add", assetId: entry.asset.id, trackId: "auto", clipId },
  ]);
  return { assetId: entry.asset.id, clipId };
}
