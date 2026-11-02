import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  audioSegments,
  autoReframe,
  cropAt,
  detectCuts,
  parseProject,
  projectDurationUs,
  renderPlan,
  resolveVideoAt,
  type AutoReframeInput,
  type CropKey,
  type CropRect,
  type FrameHistogram,
} from "../src/index.js";

interface Expected {
  durationUs: number;
  videoAt: { tUs: number; layers: { clipId: string; sourceTimeUs: number; crop?: CropRect }[] }[];
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
        const got = resolveVideoAt(project, sample.tUs).map((l) => ({ clipId: l.clip.id, sourceTimeUs: l.sourceTimeUs, ...(l.crop ? { crop: l.crop } : {}) }));
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
      expect(plan.audio.map(({ uri: _, ...segment }) => segment)).toEqual(audio);
      // An engine that only reads the plan shows the same frames as resolveVideoAt.
      for (const sample of expected.videoAt) {
        const shown = plan.video
          .filter((v) => sample.tUs >= v.startUs && sample.tUs < v.endUs)
          .map((v) => {
            const sourceTimeUs = v.sourceInUs + Math.round((sample.tUs - v.startUs) * v.speed);
            return { clipId: v.clipId, sourceTimeUs, ...(v.crop ? { crop: cropAt(v.crop, sourceTimeUs) } : {}) };
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
      else if (fn === "detectCuts") expect({ cuts: detectCuts((input as { frames: FrameHistogram[] }).frames) }).toEqual(expected);
      else throw new Error(`Unknown fixture function ${fn}`);
    });
  }
});
