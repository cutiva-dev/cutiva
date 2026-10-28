import { describe, expect, it } from "vitest";
import { createProject, CPF_SCHEMA_URL, CutivaError, DEFAULT_SETTINGS, parseProject, sequentialIds } from "../src/index.js";

/** A small valid document; tests change one thing at a time. */
function doc() {
  return {
    version: "0.1.0",
    id: "prj",
    settings: { width: 1280, height: 720, fps: { num: 30, den: 1 }, sampleRate: 48000 },
    assets: [
      { id: "v", kind: "video", name: "v.mp4", uri: "file://v.mp4", durationUs: 10_000_000 },
      { id: "a", kind: "audio", name: "a.mp3", uri: "file://a.mp3", durationUs: 10_000_000 },
    ],
    tracks: [
      { id: "tv", kind: "video", muted: false, clips: [{ id: "c1", assetId: "v", startUs: 0, sourceInUs: 0, sourceOutUs: 1_000_000, speed: 1, volume: 1, effects: [] }] },
      { id: "ta", kind: "audio", muted: false, clips: [] as Record<string, unknown>[] },
    ],
  } as Record<string, unknown> & {
    settings: Record<string, unknown> & { fps: Record<string, unknown> };
    assets: Record<string, unknown>[];
    tracks: (Record<string, unknown> & { clips: Record<string, unknown>[] })[];
  };
}

const errorOf = (input: unknown) => {
  try {
    parseProject(input);
  } catch (e) {
    return e instanceof CutivaError ? `${e.code}: ${e.message}` : `OTHER: ${String(e)}`;
  }
  return "NONE";
};

describe("parseProject", () => {
  it("accepts a JSON string or an object", () => {
    expect(parseProject(JSON.stringify(doc()))).toEqual(parseProject(doc()));
  });

  it("fills defaults and drops unknown fields", () => {
    const d = doc();
    d.tracks[0]!.clips[0] = { id: "c1", assetId: "v", startUs: 0, sourceInUs: 0, sourceOutUs: 1_000_000, extra: true };
    d.assets[0] = { id: "v", kind: "video", uri: "file://v.mp4", durationUs: 10_000_000, fingerprint: { size: 5 }, junk: 1 };
    d.meta = { app: "test" };
    const p = parseProject(d);
    expect(p.$schema).toBe(CPF_SCHEMA_URL);
    expect(p.tracks[0]!.clips[0]).toEqual({ id: "c1", assetId: "v", startUs: 0, sourceInUs: 0, sourceOutUs: 1_000_000, speed: 1, volume: 1, effects: [] });
    expect(p.assets[0]).toEqual({ id: "v", kind: "video", name: "v", uri: "file://v.mp4", durationUs: 10_000_000, fingerprint: { size: 5 } });
    expect(p.meta).toEqual({ app: "test" });
    expect(p.tracks[1]!.muted).toBe(false);
  });

  it("keeps optional asset fields and well-formed effects", () => {
    const d = doc();
    d.assets[0] = { ...d.assets[0], width: 1920, height: 1080, hasAudio: false, fingerprint: { size: 9, sha256Head: "ab" } };
    d.tracks[0]!.clips[0]!.effects = [{ type: "core/fade", params: { inUs: 1 } }, { type: "x" }, "junk"];
    const p = parseProject(d);
    expect(p.assets[0]).toMatchObject({ width: 1920, height: 1080, hasAudio: false, fingerprint: { size: 9, sha256Head: "ab" } });
    expect(p.tracks[0]!.clips[0]!.effects).toEqual([
      { type: "core/fade", params: { inUs: 1 } },
      { type: "x", params: {} },
    ]);
  });

  it("sorts clips by start and allows gaps", () => {
    const d = doc();
    d.tracks[1]!.clips = [
      { id: "late", assetId: "a", startUs: 5_000_000, sourceInUs: 0, sourceOutUs: 1_000_000 },
      { id: "early", assetId: "a", startUs: 1_000_000, sourceInUs: 0, sourceOutUs: 1_000_000 },
    ];
    expect(parseProject(d).tracks[1]!.clips.map((c) => c.id)).toEqual(["early", "late"]);
  });

  const invalid: [string, (d: ReturnType<typeof doc>) => unknown, RegExp][] = [
    ["not an object", () => [], /at \$: expected an object/],
    ["missing settings", (d) => ({ ...d, settings: null }), /\$\.settings: expected an object/],
    ["missing fps", (d) => ({ ...d, settings: { ...d.settings, fps: 30 } }), /\$\.settings\.fps: expected an object/],
    ["fractional width", (d) => ({ ...d, settings: { ...d.settings, width: 1280.5 } }), /\$\.settings\.width: expected an integer/],
    ["tiny width", (d) => ({ ...d, settings: { ...d.settings, width: 1 } }), /\$\.settings\.width: expected a number >= 2/],
    ["string height", (d) => ({ ...d, settings: { ...d.settings, height: "720" } }), /\$\.settings\.height: expected a number/],
    ["infinite sample rate", (d) => ({ ...d, settings: { ...d.settings, sampleRate: Infinity } }), /sampleRate: expected a number/],
    ["zero fps", (d) => ({ ...d, settings: { ...d.settings, fps: { num: 0, den: 1 } } }), /fps\.num: expected a number >= 1/],
    ["assets not an array", (d) => ({ ...d, assets: {} }), /\$\.assets: expected an array/],
    ["asset not an object", (d) => ({ ...d, assets: [1] }), /\$\.assets\[0\]: expected an object/],
    ["asset kind", (d) => ({ ...d, assets: [{ ...d.assets[0], kind: "image" }] }), /\$\.assets\[0\]\.kind/],
    ["empty asset id", (d) => ({ ...d, assets: [{ ...d.assets[0], id: "" }] }), /\$\.assets\[0\]\.id: expected a non-empty string/],
    ["zero duration", (d) => ({ ...d, assets: [{ ...d.assets[0], durationUs: 0 }] }), /durationUs: expected a number >= 1/],
    ["track not an object", (d) => ({ ...d, tracks: [null] }), /\$\.tracks\[0\]: expected an object/],
    ["track kind", (d) => ({ ...d, tracks: [{ ...d.tracks[0], kind: "text" }] }), /\$\.tracks\[0\]\.kind/],
    ["clips not an array", (d) => ({ ...d, tracks: [{ ...d.tracks[0], clips: "none" }] }), /\$\.tracks\[0\]\.clips: expected an array/],
    ["clip not an object", (d) => ({ ...d, tracks: [{ ...d.tracks[0], clips: [7] }] }), /clips\[0\]: expected an object/],
    ["duplicate clip id", (d) => ({ ...d, tracks: [d.tracks[0], { ...d.tracks[1], clips: [{ id: "c1", assetId: "a", startUs: 0, sourceInUs: 0, sourceOutUs: 1 }] }] }), /expected a unique clip id/],
    ["clip on missing asset", (d) => ({ ...d, tracks: [{ ...d.tracks[0], clips: [{ ...d.tracks[0]!.clips[0], assetId: "zz" }] }] }), /assetId: expected the id of an asset/],
    ["audio asset on a video track", (d) => ({ ...d, tracks: [{ ...d.tracks[0], clips: [{ ...d.tracks[0]!.clips[0], assetId: "a" }] }] }), /assetId: expected a video asset, like its track/],
    ["fractional start", (d) => ({ ...d, tracks: [{ ...d.tracks[0], clips: [{ ...d.tracks[0]!.clips[0], startUs: 0.5 }] }] }), /startUs: expected an integer/],
    ["empty range", (d) => ({ ...d, tracks: [{ ...d.tracks[0], clips: [{ ...d.tracks[0]!.clips[0], sourceInUs: 5, sourceOutUs: 5 }] }] }), /sourceOutUs: expected a value greater than sourceInUs/],
    ["speed too low", (d) => ({ ...d, tracks: [{ ...d.tracks[0], clips: [{ ...d.tracks[0]!.clips[0], speed: 0.05 }] }] }), /speed: expected a number >= 0\.1/],
    ["speed too high", (d) => ({ ...d, tracks: [{ ...d.tracks[0], clips: [{ ...d.tracks[0]!.clips[0], speed: 20 }] }] }), /speed: expected a number <= 16/],
    ["volume too high", (d) => ({ ...d, tracks: [{ ...d.tracks[0], clips: [{ ...d.tracks[0]!.clips[0], volume: 5 }] }] }), /volume: expected a number <= 4/],
    [
      "overlapping clips",
      (d) => ({ ...d, tracks: [{ ...d.tracks[0], clips: [d.tracks[0]!.clips[0], { ...d.tracks[0]!.clips[0], id: "c2", startUs: 999_999 }] }] }),
      /\$\.tracks\[0\]\.clips: expected clips that do not overlap \("c2" starts inside "c1"\)/,
    ],
    ["missing project id", (d) => ({ ...d, id: undefined }), /\$\.id: expected a non-empty string/],
  ];

  for (const [name, make, message] of invalid) {
    it(`rejects ${name} with the path`, () => {
      const out = errorOf(make(doc()));
      expect(out.startsWith("INVALID_PROJECT: ")).toBe(true);
      expect(out).toMatch(message);
    });
  }

  it("rejects other versions", () => {
    expect(errorOf({ ...doc(), version: "0.2.0" })).toMatch(/^UNSUPPORTED_VERSION: CPF version "0.2.0"/);
    expect(errorOf("not json")).toMatch(/^OTHER: SyntaxError/);
  });
});

describe("createProject", () => {
  it("starts empty with default settings, overridable", () => {
    const p = createProject({ fps: { num: 25, den: 1 } }, sequentialIds());
    expect(p).toEqual({
      $schema: CPF_SCHEMA_URL,
      version: "0.1.0",
      id: "prj_1",
      settings: { ...DEFAULT_SETTINGS, fps: { num: 25, den: 1 } },
      assets: [],
      tracks: [],
    });
  });
});
