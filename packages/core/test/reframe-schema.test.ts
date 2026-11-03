import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

// The contract for `core/reframe` params (ADR 0006). Examples and every reframed clip in the
// conformance fixtures must match it, so the schema can't drift from what the SDKs read.
const root = join(__dirname, "../../..");
const read = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
// strictRequired would flag the `if`/`then` on split keys, whose properties are declared one level up.
const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
const validate = ajv.compile(read(join(root, "spec/reframe-track.schema.json")) as object);
const errors = (data: unknown) => (validate(data) ? [] : ajv.errorsText(validate.errors).split(", "));

const example = read(join(root, "spec/examples/podcast-two-speakers.json")) as {
  keys: Record<string, unknown>[];
  track: { segments: Record<string, unknown>[]; people: Record<string, unknown>[] } & Record<string, unknown>;
};
const copy = () => structuredClone(example);

describe("reframe track schema", () => {
  it("accepts every example", () => {
    const dir = join(root, "spec/examples");
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(errors(read(join(dir, f))), f).toEqual([]);
  });

  it("accepts every core/reframe effect in the conformance fixtures (hand-only keys, no track)", () => {
    const dir = join(root, "conformance/fixtures");
    let seen = 0;
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".cpf.json"))) {
      const project = read(join(dir, f)) as { tracks: { clips: { effects: { type: string; params: unknown }[] }[] }[] };
      for (const effect of project.tracks.flatMap((t) => t.clips.flatMap((c) => c.effects))) {
        if (effect.type !== "core/reframe") continue;
        seen++;
        expect(errors(effect.params), f).toEqual([]);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("refuses milliseconds, floats and unknown values", () => {
    const ms = copy();
    ms.track.segments[0] = { ...ms.track.segments[0], startMs: 0 };
    expect(errors(ms)).not.toEqual([]);

    const float = copy();
    float.keys[0] = { ...float.keys[0], x: 0.27 };
    expect(errors(float)).not.toEqual([]);

    const layout = copy();
    layout.track.segments[0] = { ...layout.track.segments[0], layout: "grid" };
    expect(errors(layout)).not.toEqual([]);

    const version = copy();
    version.track.version = 2;
    expect(errors(version)).not.toEqual([]);
  });

  it("refuses biometric data: no embeddings, images or extra fields on people", () => {
    const embedding = copy();
    embedding.track.people[0] = { ...embedding.track.people[0], embedding: [0.1, 0.2] };
    expect(errors(embedding)).not.toEqual([]);

    const observations = copy();
    observations.track.observations = { faces: [] };
    expect(errors(observations)).not.toEqual([]);
  });

  it("ties regions to the split layout", () => {
    const missing = copy();
    missing.keys[3] = { atUs: 22000000, x: 960, y: 540, h: 1080, layout: "split" };
    expect(errors(missing)).not.toEqual([]);

    const stray = copy();
    stray.keys[0] = { ...stray.keys[0], regions: [{ x: 1, y: 1, h: 1 }, { x: 2, y: 2, h: 2 }] };
    expect(errors(stray)).not.toEqual([]);
  });
});
