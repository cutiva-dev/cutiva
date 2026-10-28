import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { audioSegments, parseProject, projectDurationUs, resolveVideoAt } from "../src/index.js";

interface Expected {
  durationUs: number;
  videoAt: { tUs: number; layers: { clipId: string; sourceTimeUs: number }[] }[];
  audioSegments: number;
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
      expect(audioSegments(project)).toHaveLength(expected.audioSegments);
    });
  }
});
