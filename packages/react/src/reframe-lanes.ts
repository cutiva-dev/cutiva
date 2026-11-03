import { clipEndUs, reframeTrack, type Clip, type ReframeTrack, type TrackSegment, type Us } from "@cutiva/core";

/** Person colours, in the order people appear in the track. Distinct from the clip and audio colours. */
export const PERSON_COLORS = ["#60a5fa", "#fbbf24", "#c084fc", "#f472b6", "#2dd4bf", "#a3e635"] as const;

/** The colour of a person of a Reframe Track (by their place in `track.people`). */
export function personColor(track: ReframeTrack, personId: string): string {
  const i = track.people.findIndex((p) => p.id === personId);
  return i < 0 ? "var(--cutiva-muted)" : PERSON_COLORS[i % PERSON_COLORS.length]!;
}

/** A track segment placed on the timeline: the part of it the clip shows, in timeline time. */
export interface PlacedSegment {
  segment: TrackSegment;
  startUs: Us;
  endUs: Us;
}

/** The segments of a reframed clip that the clip shows, in timeline time. Empty without a track. */
export function placedSegments(clip: Clip): PlacedSegment[] {
  const track = reframeTrack(clip);
  if (!track) return [];
  const toTimeline = (sourceUs: Us) => clip.startUs + Math.round((sourceUs - clip.sourceInUs) / clip.speed);
  const end = clipEndUs(clip);
  const out: PlacedSegment[] = [];
  for (const segment of track.segments) {
    const from = Math.max(segment.startUs, clip.sourceInUs);
    const to = Math.min(segment.endUs, clip.sourceOutUs);
    if (to <= from) continue;
    out.push({ segment, startUs: toTimeline(from), endUs: Math.min(end, toTimeline(to)) });
  }
  return out;
}

/** What a segment's camera shows, for labels: "Speaker A", "Split", "Wide". */
export function segmentCaption(track: ReframeTrack, segment: TrackSegment): string {
  const name = (id: string) => track.people.find((p) => p.id === id)?.label ?? id;
  if (segment.resolved === "wide") return "Wide";
  if (segment.resolved === "split") return `Split · ${(segment.focus.length ? segment.focus : segment.speakers).map(name).join(" + ")}`;
  const who = segment.focus[0] ?? segment.speakers[0];
  return who ? name(who) : "Centre";
}
