import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  audioSegments,
  autoReframe,
  cropAt,
  layoutAt,
  detectActiveArea,
  detectCuts,
  parseProject,
  planReframe,
  projectDurationUs,
  renderPlan,
  resolveVideoAt,
  stereoPan,
  type AutoReframeInput,
  type CropKey,
  type CropLayout,
  type CropRect,
  type FrameHistogram,
  type LumaImage,
  type ReframePlanInput,
} from "../src/index.js";

interface Expected {
  durationUs: number;
  videoAt: { tUs: number; layers: { clipId: string; sourceTimeUs: number; crop?: CropRect; layout?: CropLayout }[] }[];
  audioSegments: number;
  /** Optional: every audio segment in order, field by field. */
  audio?: { clipId: string; startUs: number; sourceInUs: number; sourceOutUs: number; speed: number; volume: number; fadeInUs: number; fadeOutUs: number }[];
  /** The render plan's video segments, bottom layer first. */
  videoSegments: { layer: number; clipId: string; startUs: number; endUs: number; sourceInUs: number; sourceOutUs: number; speed: number; crop?: CropKey[] }[];
}

const dir = join(__dirname, "../../../conformance/fixtures");

describe("conformance fixtures", () => {
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".cpf.json"))) {
    it(file, () => {
      const project = parseProject(readFileSync(join(dir, file), "utf8"));
      const expected = JSON.parse(readFileSync(join(dir, file.replace(".cpf.json", ".expected.json")), "utf8")) as Expected;
      expect(projectDurationUs(project)).toBe(expected.durationUs);
      for (const sample of expected.videoAt) {
        const got = resolveVideoAt(project, sample.tUs).map((l) => ({ clipId: l.clip.id, sourceTimeUs: l.sourceTimeUs, ...(l.crop ? { crop: l.crop } : {}), ...(l.layout ? { layout: l.layout } : {}) }));
        expect(got, `t=${sample.tUs}`).toEqual(sample.layers);
      }
      const audio = audioSegments(project);
      expect(audio).toHaveLength(expected.audioSegments);
      if (expected.audio) {
        expect(audio.map(({ assetId: _, ...segment }) => segment)).toEqual(expected.audio);
      }

      const plan = renderPlan(project);
      expect(plan.durationUs).toBe(expected.durationUs);
      expect(
        plan.video.map(({ layer, clipId, startUs, endUs, sourceInUs, sourceOutUs, speed, crop }) => ({
          layer,
          clipId,
          startUs,
          endUs,
          sourceInUs,
          sourceOutUs,
          speed,
          ...(crop ? { crop } : {}),
        })),
      ).toEqual(
        expected.videoSegments,
      );
      expect(plan.audio.map(({ uri: _, endUs: __, ...segment }) => segment)).toEqual(audio);
      for (const a of plan.audio) expect(a.endUs).toBe(a.startUs + Math.round((a.sourceOutUs - a.sourceInUs) / a.speed));
      // An engine that only reads the plan shows the same frames as resolveVideoAt.
      for (const sample of expected.videoAt) {
        const shown = plan.video
          .filter((v) => sample.tUs >= v.startUs && sample.tUs < v.endUs)
          .map((v) => {
            const sourceTimeUs = v.sourceInUs + Math.round((sample.tUs - v.startUs) * v.speed);
            const layout = v.crop ? layoutAt(v.crop, sourceTimeUs) : null;
            return { clipId: v.clipId, sourceTimeUs, ...(v.crop ? { crop: cropAt(v.crop, sourceTimeUs) } : {}), ...(layout ? { layout } : {}) };
          });
        expect(shown, `plan at t=${sample.tUs}`).toEqual(sample.layers);
      }
    });
  }
});

const autoDir = join(dir, "auto-reframe");

describe("auto-reframe fixtures", () => {
  for (const file of readdirSync(autoDir).filter((f) => f.endsWith(".input.json"))) {
    it(file, () => {
      const { function: fn, input } = JSON.parse(readFileSync(join(autoDir, file), "utf8")) as { function: string; input: unknown };
      const { _notes: _, ...expected } = JSON.parse(readFileSync(join(autoDir, file.replace(".input.json", ".expected.json")), "utf8")) as Record<string, unknown>;
      if (fn === "autoReframe") expect(autoReframe(input as AutoReframeInput)).toEqual(expected);
      else if (fn === "planReframe") {
        // Sightings are for editors and are covered by unit tests; the fixtures pin the track and keys.
        const { sightings: _s, ...result } = planReframe(input as ReframePlanInput);
        expect(result).toEqual(expected);
      }
      else if (fn === "detectActiveArea") {
        const { peak, sourceWidth, sourceHeight } = input as { peak: LumaImage; sourceWidth: number; sourceHeight: number };
        expect({ area: detectActiveArea(peak, sourceWidth, sourceHeight) }).toEqual(expected);
      } else if (fn === "stereoPan") {
        const { left, right, sampleRate, timesUs } = input as { left: number[]; right: number[]; sampleRate: number; timesUs: number[] };
        expect({ pan: stereoPan(left, right, sampleRate, timesUs) }).toEqual(expected);
      } else if (fn === "detectCuts") expect({ cuts: detectCuts((input as { frames: FrameHistogram[] }).frames) }).toEqual(expected);
      else throw new Error(`Unknown fixture function ${fn}`);
    });
  }
});
