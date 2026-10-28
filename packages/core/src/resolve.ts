import { clipEndUs, sourceTimeAt } from "./time.js";
import type { Asset, Clip, Project, Track, Us } from "./types.js";

export interface ActiveVideoLayer {
  track: Track;
  clip: Clip;
  asset: Asset;
  /** Source time to show from the asset at this instant. */
  sourceTimeUs: Us;
}

/**
 * What is visible at timeline time `t`. Bottom layer first.
 * Every engine (web, native) draws exactly this list, so preview and export never disagree.
 */
export function resolveVideoAt(project: Project, t: Us): ActiveVideoLayer[] {
  const layers: ActiveVideoLayer[] = [];
  for (const track of project.tracks) {
    if (track.kind !== "video") continue;
    const clip = track.clips.find((c) => t >= c.startUs && t < clipEndUs(c));
    if (!clip) continue;
    const asset = project.assets.find((a) => a.id === clip.assetId);
    if (!asset) continue;
    layers.push({ track, clip, asset, sourceTimeUs: sourceTimeAt(clip, t) });
  }
  return layers;
}

export interface AudioSegment {
  clipId: string;
  assetId: string;
  /** Timeline position where this segment starts playing. */
  startUs: Us;
  sourceInUs: Us;
  sourceOutUs: Us;
  speed: number;
  volume: number;
  fadeInUs: Us;
  fadeOutUs: Us;
}

/** Every piece of sound in the project: audio tracks plus the audio of video clips. */
export function audioSegments(project: Project): AudioSegment[] {
  const out: AudioSegment[] = [];
  for (const track of project.tracks) {
    if (track.muted) continue;
    for (const clip of track.clips) {
      const asset = project.assets.find((a) => a.id === clip.assetId);
      if (!asset) continue;
      if (asset.kind === "video" && asset.hasAudio === false) continue;
      if (clip.volume === 0) continue;
      const fade = clip.effects.find((e) => e.type === "core/fade");
      const fadeIn = typeof fade?.params.inUs === "number" ? fade.params.inUs : 0;
      const fadeOut = typeof fade?.params.outUs === "number" ? fade.params.outUs : 0;
      out.push({
        clipId: clip.id,
        assetId: asset.id,
        startUs: clip.startUs,
        sourceInUs: clip.sourceInUs,
        sourceOutUs: clip.sourceOutUs,
        speed: clip.speed,
        volume: clip.volume,
        fadeInUs: fadeIn,
        fadeOutUs: fadeOut,
      });
    }
  }
  return out;
}
