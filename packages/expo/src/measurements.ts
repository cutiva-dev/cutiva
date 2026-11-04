import { detectActiveArea, detectCuts, type CropRect, type PlanFrame, type Us } from "@cutiva/core";

/** What the native analyzer returns (`ReframeMeasurements.toJson` in the Android engine). */
export interface NativeMeasurements {
  durationUs: Us;
  /** Display size of the source: the pixels faces are in. */
  width: number;
  height: number;
  fromUs: Us;
  toUs: Us;
  fps: number;
  hasAudio: boolean;
  frames: { atUs: Us; faces: { x: number; y: number; w: number; h: number; mouth: number }[]; voice?: number; pan?: number }[];
  /** 48 colour bins per frame. */
  histograms: number[][];
  /** The brightest luma of each pixel across the frames, base64. */
  peak: { width: number; height: number; luma: string };
}

/**
 * What the analysis saw, as `ReframeAnalysis` in `@cutiva/web`: the input `planReframe` needs, kept
 * so the video can be planned again with other settings or corrections without decoding it again.
 * Numbers only: no images or audio.
 */
export interface ReframeAnalysis {
  durationUs: Us;
  width: number;
  height: number;
  hasAudio: boolean;
  fromUs: Us;
  toUs: Us;
  fps: number;
  frames: PlanFrame[];
  cuts: Us[];
  activeArea?: CropRect;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Base64 to bytes, without relying on `atob` or `Buffer`. */
export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let n = 0;
  for (const ch of clean) {
    value = (value << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[n++] = (value >> bits) & 0xff;
    }
  }
  return out.subarray(0, n);
}

/** Turns the native measurements into an analysis: camera cuts and burned-in bars found by `@cutiva/core`. */
export function toAnalysis(m: NativeMeasurements): ReframeAnalysis {
  const luma = fromBase64(m.peak.luma);
  const activeArea = m.frames.length ? detectActiveArea({ width: m.peak.width, height: m.peak.height, luma }, m.width, m.height) : null;
  return {
    durationUs: m.durationUs,
    width: m.width,
    height: m.height,
    hasAudio: m.hasAudio,
    fromUs: m.fromUs,
    toUs: m.toUs,
    fps: m.fps,
    frames: m.frames.map((f) => ({
      atUs: f.atUs,
      faces: f.faces.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h, mouth: b.mouth })),
      ...(f.voice !== undefined ? { voice: f.voice } : {}),
      ...(f.pan !== undefined ? { pan: f.pan } : {}),
    })),
    cuts: detectCuts(m.frames.map((f, i) => ({ atUs: f.atUs, bins: m.histograms[i]! }))),
    ...(activeArea ? { activeArea } : {}),
  };
}
