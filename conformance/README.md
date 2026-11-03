# Conformance suite

Every Cutiva SDK (TypeScript, Dart, Swift, Kotlin) must load each `*.cpf.json` fixture and produce exactly the values in its `*.expected.json`: total duration, which clip is visible at each sampled time and which source time it shows, and how many audio segments play. This is what keeps web, React Native and Flutter in agreement without sharing native code.

The rules are in the [project format spec](https://cutiva.dev/docs/project-format#rules-every-sdk-follows).

## Expected values

- `durationUs`: the project duration.
- `videoAt`: for each sampled time `tUs`, the visible layers bottom first, each with its `clipId`, the `sourceTimeUs` it shows and, for reframed clips, its `crop` rectangle.
- `audioSegments`: how many audio segments play.
- `audio` (optional): every audio segment in order, with `clipId`, `startUs`, `sourceInUs`, `sourceOutUs`, `speed`, `volume`, `fadeInUs` and `fadeOutUs`.
- `videoSegments`: the render plan's video segments, bottom layer first, each with `layer` (0 is the bottom video track), `clipId`, `startUs`, `endUs`, `sourceInUs`, `sourceOutUs`, `speed` and, for reframed clips, `crop`. SDKs also check that reading the plan gives the same `videoAt` layers, crops included.
- `_notes` (optional): the arithmetic behind the values, for reviewers. SDKs ignore it.

## Cases

| Fixture | What it pins down |
| --- | --- |
| `split-and-music` | A split clip, a 2x clip, music with a fade |
| `speed-and-rounding` | Durations and source times at 3x, 0.5x, 2x and 1.5x, including halves rounding up |
| `gaps` | Leading, middle and trailing gaps; an audio track that outlasts the video; a video with no audio |
| `multiple-video-tracks` | Layer order across three video tracks, overlays starting and ending, a 29.97 fps project |
| `muted-tracks` | Muted tracks stay visible but silent, zero volume, partial fade params |
| `reframe` | Crop keys: holding before a cut, gliding edges with rounding, clamping inside the frame, a 2x clip, plan keys trimmed to the clip's source range |

## Auto-reframe fixtures

`auto-reframe/*.input.json` holds `{ "function", "input" }`: the input of `autoReframe` or `detectCuts`. The matching `*.expected.json` is its exact result (`keys`, `people`, `shotStartsUs`, or `cuts`), written by hand from the [auto-reframe rules](https://cutiva.dev/docs/auto-reframe#how-it-decides).

| Fixture | What it pins down |
| --- | --- |
| `two-speakers` | Two people taking turns, the switch frame, a one-frame false face dropped, speaking time |
| `follow-one-person` | Nobody talks, the only person holds the frame, follow keys past the dead zone, hold keys |
| `detect-cuts` | Histogram distance, threshold, minimum shot length |

To add a case: write the fixture, write the expected values by hand from the spec (not by running an SDK), and add it to every SDK's test run. Today two SDKs run every fixture in this folder: TypeScript (`npm test`) and Dart (`npm run test:dart`).
