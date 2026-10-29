import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { audioSegments, parseProject, projectDurationUs, renderPlan, resolveVideoAt } from "../src/index.js";

interface Expected {
  durationUs: number;
  videoAt: { tUs: number; layers: { clipId: string; sourceTimeUs: number }[] }[];
  audioSegments: number;
  /** Optional: every audio segment in order, field by field. */
  audio?: { clipId: string; startUs: number; sourceInUs: number; sourceOutUs: number; speed: number; volume: number; fadeInUs: number; fadeOutUs: number }[];
  /** The render plan's video segments, bottom layer first. */
  videoSegments: { layer: number; clipId: string; startUs: number; endUs: number; sourceInUs: number; sourceOutUs: number; speed: number }[];
}

const dir = join(__dirname, "../../../conformance/fixtures");

describe("conformance fixtures", () => {
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".cpf.json"))) {
    it(file, () => {
      const project = parseProject(readFileSync(join(dir, file), "utf8"));
      const expected = JSON.parse(readFileSync(join(dir, file.replace(".cpf.json", ".expected.json")), "utf8")) as Expected;
      expect(projectDurationUs(project)).toBe(expected.durationUs);
      for (const sample of expected.videoAt) {
        const got = resolveVideoAt(project, sample.tUs).map((l) => ({ clipId: l.clip.id, sourceTimeUs: l.sourceTimeUs }));
        expect(got, `t=${sample.tUs}`).toEqual(sample.layers);
      }
      const audio = audioSegments(project);
      expect(audio).toHaveLength(expected.audioSegments);
      if (expected.audio) {
        expect(audio.map(({ assetId: _, ...segment }) => segment)).toEqual(expected.audio);
      }

      const plan = renderPlan(project);
      expect(plan.durationUs).toBe(expected.durationUs);
      expect(plan.video.map(({ layer, clipId, startUs, endUs, sourceInUs, sourceOutUs, speed }) => ({ layer, clipId, startUs, endUs, sourceInUs, sourceOutUs, speed }))).toEqual(
        expected.videoSegments,
      );
      expect(plan.audio.map(({ uri: _, ...segment }) => segment)).toEqual(audio);
      // An engine that only reads the plan shows the same frames as resolveVideoAt.
      for (const sample of expected.videoAt) {
        const shown = plan.video
          .filter((v) => sample.tUs >= v.startUs && sample.tUs < v.endUs)
          .map((v) => ({ clipId: v.clipId, sourceTimeUs: v.sourceInUs + Math.round((sample.tUs - v.startUs) * v.speed) }));
        expect(shown, `plan at t=${sample.tUs}`).toEqual(sample.layers);
      }
    });
  }
});
