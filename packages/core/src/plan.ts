import { audioSegments, type AudioSegment } from "./resolve.js";
import { clipEndUs, projectDurationUs } from "./time.js";
import type { Id, Project, ProjectSettings, Us } from "./types.js";

export interface VideoSegment {
  /** Position among the video tracks: 0 is the bottom, higher layers draw on top. */
  layer: number;
  trackId: Id;
  clipId: Id;
  assetId: Id;
  uri: string;
  /** Timeline range `[startUs, endUs)` where this segment is visible. */
  startUs: Us;
  endUs: Us;
  /** Source range that plays over it, at `speed`. */
  sourceInUs: Us;
  sourceOutUs: Us;
  speed: number;
}

export interface PlanAudioSegment extends AudioSegment {
  uri: string;
}

/**
 * A flat description of what plays where. Native engines (AVFoundation, Media3) build their
 * compositions from this and apply no edit rules of their own (ADR 0004).
 */
export interface RenderPlan {
  durationUs: Us;
  settings: ProjectSettings;
  /** Bottom layer first, then by start time. Muted video tracks are still visible. */
  video: VideoSegment[];
  /** The same segments as `audioSegments`, each with its asset's URI. */
  audio: PlanAudioSegment[];
}

export function renderPlan(project: Project): RenderPlan {
  const uris = new Map(project.assets.map((a) => [a.id, a.uri]));
  const video: VideoSegment[] = [];
  let layer = 0;
  for (const track of project.tracks) {
    if (track.kind !== "video") continue;
    for (const clip of track.clips) {
      const uri = uris.get(clip.assetId);
      if (uri === undefined) continue;
      video.push({
        layer,
        trackId: track.id,
        clipId: clip.id,
        assetId: clip.assetId,
        uri,
        startUs: clip.startUs,
        endUs: clipEndUs(clip),
        sourceInUs: clip.sourceInUs,
        sourceOutUs: clip.sourceOutUs,
        speed: clip.speed,
      });
    }
    layer++;
  }
  return {
    durationUs: projectDurationUs(project),
    settings: { ...project.settings, fps: { ...project.settings.fps } },
    video,
    audio: audioSegments(project).map((s) => ({ ...s, uri: uris.get(s.assetId)! })),
  };
}
