import { CutivaError } from "./errors.js";
import type { IdFactory } from "./ids.js";
import { findClip, findTrack } from "./project.js";
import { clipDurationUs, clipEndUs } from "./time.js";
import type { Asset, Clip, Id, Project, Track, TrackKind, Us } from "./types.js";

/** Every edit is a plain, serializable object. */
export type Command =
  | { type: "asset.add"; asset: Asset }
  | { type: "track.add"; kind: TrackKind; trackId?: Id }
  | { type: "track.setMuted"; trackId: Id; muted: boolean }
  | {
      type: "clip.add";
      assetId: Id;
      /** "auto" picks the first track of the matching kind, creating it if needed. */
      trackId?: Id | "auto";
      /** Defaults to the end of the track. */
      startUs?: Us;
      sourceInUs?: Us;
      sourceOutUs?: Us;
      clipId?: Id;
    }
  | { type: "clip.remove"; clipId: Id; ripple?: boolean }
  | { type: "clip.split"; clipId: Id; atUs: Us }
  | { type: "clip.trim"; clipId: Id; sourceInUs?: Us; sourceOutUs?: Us }
  | { type: "clip.move"; clipId: Id; startUs: Us; trackId?: Id }
  | { type: "clip.reorder"; clipId: Id; index: number }
  | { type: "clip.setVolume"; clipId: Id; volume: number }
  | { type: "clip.setSpeed"; clipId: Id; speed: number }
  | { type: "clip.setFade"; clipId: Id; inUs: Us; outUs: Us };

export type CommandType = Command["type"];

export type CommandResult =
  | { type: "asset.add"; assetId: Id }
  | { type: "track.add"; trackId: Id }
  | { type: "clip.add"; clipId: Id; trackId: Id }
  | { type: "clip.split"; leftId: Id; rightId: Id }
  | { type: Exclude<CommandType, "asset.add" | "track.add" | "clip.add" | "clip.split"> };

const MIN_CLIP_US = 1_000; // 1 ms

function assertNoOverlap(track: Track, ignoreId?: Id): void {
  const clips = track.clips.filter((c) => c.id !== ignoreId).slice().sort((a, b) => a.startUs - b.startUs);
  for (let i = 1; i < clips.length; i++) {
    const prev = clips[i - 1]!;
    const cur = clips[i]!;
    if (cur.startUs < clipEndUs(prev)) {
      throw new CutivaError("OVERLAP", `Clip "${cur.id}" overlaps clip "${prev.id}" on track "${track.id}".`);
    }
  }
}

function sortTrack(track: Track): void {
  track.clips.sort((a, b) => a.startUs - b.startUs);
}

function findAsset(project: Project, assetId: Id): Asset {
  const asset = project.assets.find((a) => a.id === assetId);
  if (!asset) throw new CutivaError("ASSET_NOT_FOUND", `Asset "${assetId}" does not exist.`);
  return asset;
}

function trackEndUs(track: Track): Us {
  return track.clips.reduce((end, c) => Math.max(end, clipEndUs(c)), 0);
}

function checkRange(asset: Asset, sourceInUs: Us, sourceOutUs: Us): void {
  if (!Number.isInteger(sourceInUs) || !Number.isInteger(sourceOutUs)) {
    throw new CutivaError("INVALID_RANGE", "Source times must be integer microseconds.");
  }
  if (sourceInUs < 0 || sourceOutUs > asset.durationUs || sourceOutUs - sourceInUs < MIN_CLIP_US) {
    throw new CutivaError(
      "INVALID_RANGE",
      `Range ${sourceInUs}..${sourceOutUs} is outside asset "${asset.id}" (0..${asset.durationUs}) or too short.`,
    );
  }
}

/** Repack a track's clips back to back, starting at 0, in their current array order. */
function pack(track: Track): void {
  let cursor = 0;
  for (const clip of track.clips) {
    clip.startUs = cursor;
    cursor += clipDurationUs(clip);
  }
}

/**
 * Apply one command to a project **in place**. Callers pass a draft copy;
 * if this throws, the draft is discarded and the real state is untouched.
 */
export function applyCommand(project: Project, cmd: Command, ids: IdFactory): CommandResult {
  switch (cmd.type) {
    case "asset.add": {
      if (project.assets.some((a) => a.id === cmd.asset.id)) return { type: cmd.type, assetId: cmd.asset.id };
      project.assets.push({ ...cmd.asset });
      return { type: cmd.type, assetId: cmd.asset.id };
    }
    case "track.add": {
      const trackId = cmd.trackId ?? ids("trk");
      project.tracks.push({ id: trackId, kind: cmd.kind, muted: false, clips: [] });
      return { type: cmd.type, trackId };
    }
    case "track.setMuted": {
      findTrack(project, cmd.trackId).muted = cmd.muted;
      return { type: cmd.type };
    }
    case "clip.add": {
      const asset = findAsset(project, cmd.assetId);
      let track: Track;
      if (cmd.trackId === undefined || cmd.trackId === "auto") {
        const existing = project.tracks.find((t) => t.kind === asset.kind);
        if (existing) track = existing;
        else {
          track = { id: ids("trk"), kind: asset.kind, muted: false, clips: [] };
          project.tracks.push(track);
        }
      } else {
        track = findTrack(project, cmd.trackId);
      }
      if (asset.kind === "video" && track.kind !== "video") {
        throw new CutivaError("TRACK_KIND_MISMATCH", `Video asset "${asset.id}" needs a video track.`);
      }
      const sourceInUs = cmd.sourceInUs ?? 0;
      const sourceOutUs = cmd.sourceOutUs ?? asset.durationUs;
      checkRange(asset, sourceInUs, sourceOutUs);
      const clip: Clip = {
        id: cmd.clipId ?? ids("clip"),
        assetId: asset.id,
        startUs: cmd.startUs ?? trackEndUs(track),
        sourceInUs,
        sourceOutUs,
        speed: 1,
        volume: 1,
        effects: [],
      };
      if (clip.startUs < 0) throw new CutivaError("INVALID_RANGE", "startUs must be >= 0.");
      track.clips.push(clip);
      assertNoOverlap(track);
      sortTrack(track);
      return { type: cmd.type, clipId: clip.id, trackId: track.id };
    }
    case "clip.remove": {
      const { track, index, clip } = findClip(project, cmd.clipId);
      track.clips.splice(index, 1);
      if (cmd.ripple) {
        const gap = clipDurationUs(clip);
        for (const c of track.clips) if (c.startUs >= clipEndUs(clip)) c.startUs -= gap;
      }
      return { type: cmd.type };
    }
    case "clip.split": {
      const { track, clip, index } = findClip(project, cmd.clipId);
      const offsetUs = cmd.atUs - clip.startUs;
      if (offsetUs < MIN_CLIP_US || cmd.atUs > clipEndUs(clip) - MIN_CLIP_US) {
        throw new CutivaError("INVALID_RANGE", `Split point ${cmd.atUs} is not inside clip "${clip.id}".`);
      }
      const cutSourceUs = clip.sourceInUs + Math.round(offsetUs * clip.speed);
      const right: Clip = {
        ...clip,
        id: ids("clip"),
        startUs: cmd.atUs,
        sourceInUs: cutSourceUs,
        effects: clip.effects.map((e) => ({ ...e, params: { ...e.params } })),
      };
      clip.sourceOutUs = cutSourceUs;
      track.clips.splice(index + 1, 0, right);
      return { type: cmd.type, leftId: clip.id, rightId: right.id };
    }
    case "clip.trim": {
      const { track, clip } = findClip(project, cmd.clipId);
      const asset = findAsset(project, clip.assetId);
      const newIn = cmd.sourceInUs ?? clip.sourceInUs;
      const newOut = cmd.sourceOutUs ?? clip.sourceOutUs;
      checkRange(asset, newIn, newOut);
      // Trimming the head keeps the clip's right edge in place.
      const shift = Math.round((newIn - clip.sourceInUs) / clip.speed);
      clip.startUs += shift;
      if (clip.startUs < 0) throw new CutivaError("INVALID_RANGE", "Trim would move the clip before 0.");
      clip.sourceInUs = newIn;
      clip.sourceOutUs = newOut;
      assertNoOverlap(track);
      return { type: cmd.type };
    }
    case "clip.move": {
      const { track, clip, index } = findClip(project, cmd.clipId);
      if (cmd.startUs < 0 || !Number.isInteger(cmd.startUs)) {
        throw new CutivaError("INVALID_RANGE", "startUs must be a non-negative integer.");
      }
      let target = track;
      if (cmd.trackId && cmd.trackId !== track.id) {
        target = findTrack(project, cmd.trackId);
        const asset = findAsset(project, clip.assetId);
        if (asset.kind === "video" && target.kind !== "video") {
          throw new CutivaError("TRACK_KIND_MISMATCH", `Video clip "${clip.id}" needs a video track.`);
        }
        track.clips.splice(index, 1);
        target.clips.push(clip);
      }
      clip.startUs = cmd.startUs;
      assertNoOverlap(target);
      sortTrack(target);
      return { type: cmd.type };
    }
    case "clip.reorder": {
      // Magnetic reorder: move the clip to `index` and pack the track with no gaps.
      const { track, clip, index } = findClip(project, cmd.clipId);
      const to = Math.max(0, Math.min(track.clips.length - 1, Math.trunc(cmd.index)));
      track.clips.splice(index, 1);
      track.clips.splice(to, 0, clip);
      pack(track);
      return { type: cmd.type };
    }
    case "clip.setVolume": {
      if (!(cmd.volume >= 0 && cmd.volume <= 4)) throw new CutivaError("INVALID_RANGE", "volume must be between 0 and 4.");
      findClip(project, cmd.clipId).clip.volume = cmd.volume;
      return { type: cmd.type };
    }
    case "clip.setSpeed": {
      if (!(cmd.speed >= 0.1 && cmd.speed <= 16)) throw new CutivaError("INVALID_RANGE", "speed must be between 0.1 and 16.");
      const { track, clip } = findClip(project, cmd.clipId);
      clip.speed = cmd.speed;
      assertNoOverlap(track);
      return { type: cmd.type };
    }
    case "clip.setFade": {
      const { clip } = findClip(project, cmd.clipId);
      const len = clipDurationUs(clip);
      if (cmd.inUs < 0 || cmd.outUs < 0 || cmd.inUs + cmd.outUs > len) {
        throw new CutivaError("INVALID_RANGE", "Fades must be non-negative and fit inside the clip.");
      }
      clip.effects = clip.effects.filter((e) => e.type !== "core/fade");
      if (cmd.inUs > 0 || cmd.outUs > 0) clip.effects.push({ type: "core/fade", params: { inUs: cmd.inUs, outUs: cmd.outUs } });
      return { type: cmd.type };
    }
    default: {
      const exhaustive: never = cmd;
      throw new Error(`Unknown command ${JSON.stringify(exhaustive)}`);
    }
  }
}
