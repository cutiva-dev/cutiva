# ADR 0004: One native engine per OS, driven by a render plan

**Status:** proposed · 2026-10-28

## Context

Phase 2 brings Cutiva to React Native and Flutter. ADR 0001 already fixed the split: the project format and commands are shared as a contract (TypeScript for web and React Native, a Dart port for Flutter), and each platform renders with its own media engine. What it left open is how the native engines are built and how they talk to the core.

Four ways to get there:

1. **One engine per framework.** React Native gets Swift and Kotlin engines; Flutter gets its own. That's four engines doing the same job.
2. **A shared C++ or Rust engine on FFmpeg.** Rejected in ADR 0001: a cross-platform build project before the first mobile release, a larger app, and H.264/AAC encoders we are not allowed to bundle (CLAUDE.md, rule 6). ffmpeg-kit, the usual wrapper, is no longer maintained.
3. **One engine per OS that understands CPF.** Swift and Kotlin engines read the project and apply the timing rules themselves. Two engines, but the rules (rounding, speed, gaps, layers, fades) then live in four languages: TypeScript, Dart, Swift and Kotlin.
4. **One engine per OS that plays a render plan.** The core turns the project into a flat list of what plays where; the engine only executes that list.

## Decision

Option 4.

**The core computes a render plan.** A new pure function in `@cutiva/core`, `renderPlan(project)`, and its Dart twin return:

- `durationUs` and the output settings;
- **video segments**, bottom layer first: track index, clip id, asset URI, timeline range `[startUs, endUs)`, `sourceInUs`, `speed`;
- **audio segments**: what `audioSegments()` returns today (source range, speed, volume, fades).

Everything is in integer microseconds (ADR 0002). `resolveVideoAt` and `audioSegments` become views of the plan, so the web engine uses the same thing. Conformance fixtures gain an expected plan, written by hand like the rest (rule 9).

**One engine per OS, shared by both frameworks, with no edit logic:**

| | iOS | Android |
| --- | --- | --- |
| Library | Swift package `CutivaEngine` | Kotlin library `cutiva-engine` |
| Timeline | `AVMutableComposition`, one track per plan layer | Media3 `Composition` of `EditedMediaItemSequence`s |
| Speed, volume, fades | `scaleTimeRange`, `AVAudioMix` volume ramps | `SpeedChangeEffect`, audio processors for gain and ramps |
| Preview | `AVPlayer` in a native view | Media3 `CompositionPlayer` in a native view |
| Export | `AVAssetExportSession` with an `AVVideoComposition` (H.264 + AAC) | Media3 `Transformer` (H.264 + AAC) |
| Time | `CMTime` with timescale 1,000,000 | Media3 already uses microseconds |

Both use the OS encoders, so no codec is bundled and every dependency is Apache-2.0 or part of the OS.

**Thin bindings.** React Native gets an Expo Module (`@cutiva/react-native`) that runs `@cutiva/core` in JavaScript and sends the plan, as JSON, to the engine whenever the project changes. Flutter gets a plugin (`cutiva_flutter`) with the Dart core, talking to the same engines through typed Pigeon channels. Both expose a native preview view, `export()` with progress and cancel, and `capabilities()`, mirroring `@cutiva/web`.

## Consequences

- The timing rules exist twice (TypeScript, Dart), both checked by the same fixtures, instead of four times. The engines can be tested on their own, by rendering plan fixtures and checking frames and audio the way the web E2E test does.
- "Preview and export draw the same thing" (rule 4) holds on mobile by construction: both are built from one plan.
- Sending the whole plan on each change is simple and small (a few KB for typical projects). If long projects make it slow, we send diffs later without changing the engines' model.
- New packages: `packages/engine-ios`, `packages/engine-android`, `packages/react-native`, `packages/flutter` (with the Dart core). CI needs macOS runners with Xcode and an Android emulator job.
- The phase 2 gate ("fixtures give identical results on web, React Native and Flutter") extends naturally: same plans from TypeScript and Dart, and engines that render plan fixtures with the same frames and audio timing.

## Open questions

- **Media3 `CompositionPlayer`** is still marked experimental. If multi-layer preview isn't solid enough, Android preview starts with a single video layer (`ExoPlayer` with clipped media items) while export uses `Transformer`, and we say so in the docs.
- **Thumbnails and scrubbing** on long-GOP phone video: `AVAssetImageGenerator` and Media3's frame extraction both decode from keyframes. We measure before adding a cache, like on the web.
- **Media access:** files arrive as `ph://` (Photos) or `content://` URIs. The engines resolve them; CPF keeps the fingerprint so projects can be relinked on another device.
- **iOS background export** has time limits. Long exports may need to pause and resume, or warn the user.
