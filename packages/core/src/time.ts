import type { Clip, Project, Us } from "./types.js";

export const US_PER_SECOND = 1_000_000;

export const secondsToUs = (s: number): Us => Math.round(s * US_PER_SECOND);
export const usToSeconds = (us: Us): number => us / US_PER_SECOND;

/** Length of a clip on the timeline, after speed. */
export function clipDurationUs(clip: Clip): Us {
  return Math.round((clip.sourceOutUs - clip.sourceInUs) / clip.speed);
}

export function clipEndUs(clip: Clip): Us {
  return clip.startUs + clipDurationUs(clip);
}

export function projectDurationUs(project: Project): Us {
  let end = 0;
  for (const track of project.tracks) {
    for (const clip of track.clips) end = Math.max(end, clipEndUs(clip));
  }
  return end;
}

/** Map a timeline time inside a clip to the source time it shows. */
export function sourceTimeAt(clip: Clip, timelineUs: Us): Us {
  return clip.sourceInUs + Math.round((timelineUs - clip.startUs) * clip.speed);
}

/** "00:01:02.500" */
export function formatTimecode(us: Us): string {
  const totalMs = Math.max(0, Math.round(us / 1000));
  const ms = totalMs % 1000;
  const s = Math.floor(totalMs / 1000) % 60;
  const m = Math.floor(totalMs / 60_000) % 60;
  const h = Math.floor(totalMs / 3_600_000);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)}.${p(ms, 3)}`;
}
