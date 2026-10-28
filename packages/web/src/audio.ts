import type { AudioSegment, Us } from "@cutiva/core";

/**
 * Schedule every audio segment that is still audible after `fromUs` on a Web Audio graph.
 * Works the same on a live AudioContext (preview) and an OfflineAudioContext (export).
 * Returns a function that stops everything that was scheduled.
 */
export function scheduleSegments(
  ctx: BaseAudioContext,
  destination: AudioNode,
  segments: AudioSegment[],
  buffers: Map<string, AudioBuffer>,
  fromUs: Us,
  atCtxTime: number,
): () => void {
  const nodes: AudioBufferSourceNode[] = [];
  for (const s of segments) {
    const buffer = buffers.get(s.assetId);
    if (!buffer) continue;
    const timelineLenUs = (s.sourceOutUs - s.sourceInUs) / s.speed;
    const segEndUs = s.startUs + timelineLenUs;
    if (segEndUs <= fromUs) continue;

    const skipTimelineUs = Math.max(0, fromUs - s.startUs);
    const when = atCtxTime + Math.max(0, s.startUs - fromUs) / 1e6;
    const offsetSec = (s.sourceInUs + skipTimelineUs * s.speed) / 1e6;
    const durationSec = (s.sourceOutUs - s.sourceInUs - skipTimelineUs * s.speed) / 1e6;
    if (durationSec <= 0) continue;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = s.speed;
    const gain = ctx.createGain();
    // Volume envelope with fades, expressed in timeline time.
    const segStartCtx = atCtxTime + (s.startUs - fromUs) / 1e6;
    const segEndCtx = atCtxTime + (segEndUs - fromUs) / 1e6;
    const g = gain.gain;
    g.setValueAtTime(s.volume, when);
    if (s.fadeInUs > 0) {
      const fadeEnd = segStartCtx + s.fadeInUs / 1e6;
      if (fadeEnd > when) {
        const progress = Math.max(0, (when - segStartCtx) / (s.fadeInUs / 1e6));
        g.setValueAtTime(s.volume * progress, when);
        g.linearRampToValueAtTime(s.volume, fadeEnd);
      }
    }
    if (s.fadeOutUs > 0) {
      const fadeStart = Math.max(when, segEndCtx - s.fadeOutUs / 1e6);
      g.setValueAtTime(s.volume, fadeStart);
      g.linearRampToValueAtTime(0, segEndCtx);
    }
    src.connect(gain).connect(destination);
    src.start(when, offsetSec, durationSec);
    nodes.push(src);
  }
  return () => {
    for (const n of nodes) {
      try {
        n.stop();
      } catch {
        /* already stopped */
      }
      n.disconnect();
    }
  };
}
