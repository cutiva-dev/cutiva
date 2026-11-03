# ADR 0005: Reframe as a clip effect, auto-reframe split between core and engines

**Status:** proposed · 2026-11-02

## Context

Vertical video (9:16) cut from landscape footage needs a crop window that follows the action: in a podcast, whoever is talking. Users want it automatic ("auto-reframe"), then want to fix the spots it gets wrong. It must work on web first, then React Native and Flutter, and preview and export must agree (rule 4). Until now a clip was always drawn whole and letterboxed.

Three questions: where the framing lives in CPF, which part of auto-reframe is shared, and where faces are detected.

## Decision

**Storage: a `core/reframe` effect on a video clip**, `params.keys` = crop keys `{ atUs, x, y, h, cut? }`, all integers. `atUs` is **source time**, so split, trim and speed changes keep the framing without rewriting keys. `(x, y)` is the window's centre and `h` its height, in source pixels; the width follows the project's aspect ratio, so changing the format reshapes the window instead of breaking it. A key with `cut` makes the window jump there; otherwise it glides from the previous key. Effects already exist in CPF with free-form params (like `core/fade`), so the schema shape does not change and the version stays 0.1.0 (rule 10). `parseProject` now validates `core/reframe` params.

**Resolution in the core, with integer-only rules** (`cropRect`, `cropAt`): the window is clamped inside the source, and between keys the four edges are interpolated, each rounded half up, with integer arithmetic so TypeScript, Dart, Swift and Kotlin give the same pixels. `resolveVideoAt` returns the `crop` and `renderPlan` gives each segment its crop keys already turned into rectangles, so native engines only interpolate edges (ADR 0004).

**Auto-reframe split in two:**

- **The core plans** (`autoReframe`, `detectCuts`): from observations (faces with mouth openness per sampled frame, speech loudness, colour histograms) it finds camera cuts, tracks faces, picks the speaker by mouth movement, holds each speaker at least 1.5 s, and writes keys. Pure, deterministic, ported to Dart and pinned by conformance fixtures, so every platform frames the same footage the same way.
- **The engine observes**: decoding frames and detecting faces is platform work. The web engine samples 5 frames per second and takes any `FaceDetector`; `@cutiva/web/mediapipe` provides one on MediaPipe Face Landmarker (Apache-2.0), an **optional peer dependency** loaded only when used. iOS can use Apple Vision and Android MediaPipe Tasks later, feeding the same core function.

## Consequences

- One undoable `clip.setReframe` command applies a whole auto-reframe; dragging the window is the same command.
- A clip whose asset has no known size can't be reframed (`ASSET_SIZE_UNKNOWN`).
- Speaker choice from mouth movement alone is a heuristic: it fails on profiles, covered mouths and off-screen voices. The UI says so and the user fixes keys by hand. Better active-speaker models can replace the detector or the observations without changing the format.
- MediaPipe downloads its WASM and model (about 4 MB) from public CDNs by default; apps can host them. Video frames never leave the device.
- Native engines must implement the edge interpolation (a few lines) to show crops.
