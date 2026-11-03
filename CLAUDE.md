# CLAUDE.md — Cutiva

Cutiva is an open-source (Apache-2.0) video editing SDK for developers. Pilot platforms: React web, React Native, Flutter. An optional commercial AI cloud lives in a separate private repo (`cutiva-cloud`), never here.

Talk to the maintainer (Wilfredo) in Spanish. Write all code, comments, commit messages, docs and README content in English.

## Commands

```bash
npm install
npm run build        # core → web → react (tsc). Run before typecheck: packages resolve each other via dist/
npm run typecheck    # every workspace
npm test             # vitest: core unit tests + conformance fixtures; fails under 90% coverage
npm run test:android # Android engine: JVM tests + exports on a running emulator (needs JDK 17, Android SDK)
npm run test:dart    # Dart core: analyze, format check, tests + conformance fixtures, fails under 90% coverage (needs Dart 3.7)
npm run e2e          # Playwright in Google Chrome: import, split, export, check the MP4 (needs Chrome installed)
npm run dev          # playground at http://localhost:5173 (aliases package sources, no rebuild needed)
npm run build -w @cutiva/playground
npm run dev:website      # landing + docs at http://localhost:4321
npm run changeset        # describe a change to a published package (see RELEASING.md)
npm run build:website    # builds the playground into public/play, then Next.js: static pages, /play, /api/waitlist, /api/search
```

Always finish a task with `npm run build && npm run typecheck && npm test` green, plus `npm run test:dart` when the core or the fixtures change.

## Layout

- `packages/core` — `@cutiva/core`. Pure TypeScript, no DOM, no dependencies. CPF project format (`types.ts`, `project.ts`), commands (`commands.ts`), editor with undo/redo (`editor.ts`), timeline resolver (`resolve.ts`), render plan for native engines (`plan.ts`).
- `packages/web` — `@cutiva/web`. Mediabunny + WebCodecs + Web Audio: import (`media.ts`), preview (`preview.ts`), audio scheduling shared by preview and export (`audio.ts`), MP4 export (`export.ts`).
- `packages/react` — `@cutiva/react`. Hooks (`useCutiva`, `useProject`, `usePreview`) and `<Timeline>`; default theme in `styles.css`.
- `packages/flutter/cutiva_core` — `cutiva_core`, the core ported to Dart for Flutter (same files: `types.dart`, `project.dart`, `commands.dart`, `editor.dart`, `resolve.dart`, `plan.dart`). Not an npm workspace. **Any change to the core's behavior lands in TypeScript and Dart in the same PR**, and both run the conformance fixtures. Round with `roundHalfUp`, never Dart's `round()` (it differs from `Math.round` for negative halves).
- `packages/engine-android` — Kotlin library `dev.cutiva.engine` (Gradle 9.8, AGP 9.4 with built-in Kotlin, Media3 1.11.1). Renders a `RenderPlan` JSON; never apply edit rules here. `CutivaExporter` builds one video sequence plus one audio sequence per lane of non-overlapping sounds. `EncoderDelay` and `SourceDelay` correct two Media3 audio offsets; `ExportTest` (instrumentation) checks sync like the web E2E test.
- `apps/playground` — Vite + React editor built on the three packages. Dev runs at `/`; the production build uses base `/play/` and is served by the website.
- `apps/website` — Next.js (App Router) site for cutiva.dev, deployed on Vercel. Two root layouts: `app/(home)` is the landing (`page.tsx`, plain CSS in `landing.css`, no Tailwind) and `app/(docs)` is the docs with Fumadocs (`content/docs/*.mdx` → `/docs/...`, sidebar order in `content/docs/meta.json`, theme in `docs.css`). The playground is copied into `public/play` at build time (`scripts/copy-playground.mjs`, gitignored) and `/play` is rewritten to its `index.html` in `next.config.mjs`. `app/api/waitlist/route.ts` stores emails in MongoDB (needs `MONGODB_URI`, see `.env.example`); `app/api/search/route.ts` serves docs search. Keep the docs in sync with the real API in the same PR that changes it.
- `conformance/fixtures` — `*.cpf.json` + `*.expected.json`. Every SDK on every platform must produce the expected values.
- `spec` — `reframe-track.schema.json`, the JSON Schema of the `core/reframe` params (crop keys + Reframe Track, ADR 0006), and valid `examples/`. `reframe-schema.test.ts` validates the examples and every reframed clip in the fixtures against it.
- `fixtures` — `fetch.sh` downloads the real reframe test videos listed in `manifest.json` (pinned SHA-256) into `fixtures/videos/` (gitignored).
- `docs/adr` — architecture decisions. Add one for any decision that is hard to reverse.

## Rules that must not break

1. **Time is integer microseconds (`Us`) everywhere.** Never store seconds as floats. Convert only at the edge (Mediabunny and Web Audio take seconds).
2. **Every edit is a command** in `commands.ts`, applied to a draft copy. If it throws, state is untouched. New edit types: add the command, its result type in `editor.ts` (`ResultOf`), and tests.
3. **Errors are `CutivaError` with a stable `code`.** Add codes to `errors.ts`; never throw bare strings for user-facing failures.
4. **Preview and export draw the same thing.** Both must go through `resolveVideoAt` / `audioSegments` and `scheduleSegments`. Never add logic to only one of them. Native engines read only `renderPlan` (ADR 0004) and apply no edit rules of their own.
5. **Core stays dependency-free and DOM-free.** It must port cleanly to Dart, Swift and Kotlin.
6. **Licenses:** only MIT, Apache-2.0, BSD, ISC or MPL-2.0 dependencies. No GPL code, no bundled H.264/HEVC encoders (use the OS/browser encoders). Ask before adding any runtime dependency.
7. **Pin exact versions** in package.json, and pick releases at least two weeks old.
8. **Honesty in docs:** the README status table and ROADMAP only say "working" for things verified to work. Untested = "needs testing". Planned = "planned".
9. **Conformance expected values are written by hand from the spec**, never generated by running an SDK.
10. Do not change the CPF schema shape without bumping its version and adding a migration in `parseProject`.
11. **Reframe:** the plan is `docs/reframe-mvp-spec.md` as adapted by `docs/reframe-integration-map.md` (TypeScript + Dart, no Rust; times in µs and integer source pixels). Work one phase at a time and stop after each until the maintainer says "sigue". The Reframe Track lives in the `core/reframe` effect; changing a `track` field means bumping `track.version` with a migration in `parseProject` (TS and Dart) and updating `spec/reframe-track.schema.json`. Locked segments are never changed by re-analysis. Never store embeddings, face images or audio in the project. No model with a non-commercial license. Models load from pinned SHA-256 hashes. Every change to a segmentation or camera rule comes with a unit test and an explicit fixture update, explained in the PR.

## Current status (update this section as work lands)

- Core: 200 tests (5 validate `spec/reframe-track.schema.json`), ~99% line coverage, 100% functions, ~97% branches (`npm test` fails under 90%). 6 conformance fixtures (split, speed and rounding, gaps, multiple video tracks, muted tracks, reframe) plus the auto-reframe fixtures in `conformance/fixtures/auto-reframe` (`autoReframe`, `detectCuts`, 8 `plan-*`, 3 `signals-*`). The timing and crop rules every SDK follows are written in `apps/website/content/docs/project-format.mdx`; the auto-reframe steps in `auto-reframe.mdx`.
- Reframe (ADR 0005, proposed): crop keys live in a `core/reframe` clip effect, in source time; `clip.setReframe` and `project.setSize` commands; `resolveVideoAt` returns `crop` and `renderPlan` segments carry `crop` keys. `autoReframe` / `detectCuts` (core, TS + Dart) plan keys from observations; `planReframe` / `editReframeTrack` (reframe MVP phase 1, TS + Dart, 8 hand-written `plan-*` fixtures) also plan segments, people, split/wide layouts and the Reframe Track (`params.track`, ADR 0006), plus `sightings` (faces per person, not stored; unit-tested, the fixtures pin track and keys only). Phase 4 (editor): `engine.reframe` / `editReframe` / `reframePlan` in `@cutiva/web` (`reframe-track.ts`) plan with the clip's track and apply keys + track in one `clip.setReframe`; analyses are cached in memory and IndexedDB by asset fingerprint (`ANALYSIS_NEEDED` without them). `<Timeline>` has Speakers / Camera lanes, `<ReframeBox>` clickable faces and `onWindow`; the playground inspector has segment layout, Focus on, Reset, Camera style, Zoom, Apply to every clip and People (`Reframe.tsx`). E2E `reframe-editor.spec.ts` (fixture `talk.mp4`, fake detector via `window.__cutivaFaceDetector`) passes in Chrome and Firefox on macOS. Split and wide still draw as one centred window (phase 5); `@cutiva/web` samples 5 fps and takes any `FaceDetector`; reframe phase 3 added to `analyzeAsset` stereo pan (`stereoPan`) and burned-in black bars (`detectActiveArea`, `analysis.activeArea`), both in core TS + Dart (`reframe-signals`, 3 `signals-*` fixtures), staged progress (`video`, `audio`), display-size measurement (rotation, SAR) and `NO_VIDEO_TRACK`. `@cutiva/web/mediapipe` wraps MediaPipe Face Landmarker (optional peer dependency `@mediapipe/tasks-vision` 1.1.1, model from Google's CDN, checked against pinned `MEDIAPIPE_MODEL_SHA256` and kept in Cache Storage, `MODEL_LOAD_FAILED` otherwise). No VAD model: speech is still loudness. `<Timeline>` marks framing changes, `<ReframeBox>` drags the window. E2E `reframe.spec.ts` (drag, preview and export colours, fixture `stripes.mp4`) passes locally in Chrome and Firefox on macOS (WebKit only in CI); `auto-reframe.spec.ts` runs MediaPipe only with `E2E_MEDIAPIPE=1` (network) and passed locally in both. Speaker detection is untested on real conversations; native engines don't draw crops yet. Feedback: the playground's auto-reframe panel rates each framing change and downloads a numbers-only JSON report (`ReframeFeedback.tsx`) and opens a prefilled GitHub issue to attach it to; no backend or database.
- Web engine, React package, playground: E2E tests (export with frame and audio sync checks, preview seeking, thumbnails) pass in Chrome, Firefox and Playwright's WebKit on macOS (required `e2e` job), and in Chrome, Edge and Firefox on Windows and Linux plus Edge on macOS (`e2e-platforms` job, not required). Known: Firefox on Windows shifts exported video one frame late (#21, marked as an expected failure). AAC isn't encodable in Firefox or Chrome on Linux, so export falls back to Opus (`capabilities().audioCodec`). Encoder priming is measured per codec (`encoder-delay.ts`). WebKit can't run locally on macOS 14. Preview sound not checked by ear outside Chrome. Real Safari, iOS and Android not tested. Exported audio runs up to ~40 ms past the video (frame padding).
- Preview frames: `FrameServer` (`frames.ts`) keeps one decoder per asset running forward and caches decoded frames within a 192 MB budget shared by all assets. On a 1080p30 clip with 2 s GOPs, playback shows every frame (was ~25 fps) and scrubbing over seen frames is ~instant; a jump to an unseen spot still costs one GOP decode (~50 ms). Timeline thumbnails (`thumbnails.ts`, `engine.thumbnail`, `<Timeline thumbnail>`) show the keyframe at or before each slot.
- E2E: `apps/playground/e2e/export.spec.ts` imports `e2e/fixtures/clip.mp4` (white flash + 440 Hz beep at x.5–x.6 s each second), splits, deletes the first second and exports; it checks codecs, size, duration, that every flash and beep lands within 5 ms of where it belongs, and that no main-thread task during export exceeds 250 ms (500 ms on CI runners). `preview.spec.ts` checks the thumbnail strip draws and that the preview shows the right frame after seeking forward and back. Runs in CI on `macos-latest`, where Chrome has the platform H.264 and AAC encoders; Linux runners are untested.
- Website: migrated to Next.js 16 + Fumadocs (ADR 0003). Builds; landing, docs, search and the waitlist endpoint respond locally under `next start` (validation, honeypot and the no-database 503 tested). Not yet tested against a real MongoDB or deployed.
- Release: Changesets is set up (`.changeset/`, three packages share one version) with a pending changeset for 0.1.0. Packed tarballs install in a clean project, core runs in Node, and the README examples type-check (consumers need `skipLibCheck: true` because of Mediabunny's type dependencies). Not published: the `@cutiva` npm org doesn't exist yet.
- Dart core (`cutiva_core`): 165 tests, 98.9% line coverage, passes all conformance and auto-reframe fixtures; `dart` CI job (not required yet). Not on pub.dev. `renderPlan` exists in both and every fixture pins its video segments. Flutter preview/export and React Native not started; the mobile plan is ADR 0004 (accepted).
- Android engine: export works on the API 35 emulator (6 instrumentation tests: sync wherever a clip starts, gaps and 2x speed, volume and fades, mixing, refusals). One video layer only and no reframed clips (`UNSUPPORTED_FEATURE` otherwise). Not tested on real devices; no preview yet. `android` CI job (emulator, not required).
- Whole monorepo is on React 19.3 (`@cutiva/react` still accepts `react >=18` as a peer).

## Next tasks, in order (Phase 0 gate: a trimmed MP4 exports in Chromium)

Each task is a GitHub issue in `cutiva-dev/cutiva`. Close the issue from the PR that finishes it, and remove the line here.

1. (#9) Deploy on Vercel as one project: Root Directory `apps/website`, framework Next.js, env `MONGODB_URI` (without it the waitlist answers 503). `apps/website/vercel.json` installs from the monorepo root (`npm ci`), because an install inside the workspace skips the playground's dependencies. It serves the landing at `/`, docs at `/docs` and the playground at `/play`, on the `*.vercel.app` URL until cutiva.dev is bought.

Then: create the `cutiva` npm org and publish v0.1 following RELEASING.md (the maintainer does this).

Deferred: (#5) export in a Web Worker. Measured in Chrome 156 on macOS: export on the main thread keeps the UI at ~60 fps (worst task 50–75 ms on a 4K source, also with 4× CPU throttling), because WebCodecs already runs off the main thread. A worker would add bundler friction for SDK users for little gain. Revisit when export draws heavy canvas work (text, overlays, effects) or low-end devices show jank. The E2E test fails if any main-thread task during export exceeds 250 ms (500 ms on CI).

Brand, if UI work is needed: background `#0E0F12`, raised `#17191E`, lines `#2A2D33`, text `#EDEEF0`, muted `#9BA1AC`, accent `#FF6A3D` (text on it `#14161A`), audio green `#34D399`. Fonts: Geist and Geist Mono. Borders instead of shadows, no gradients.
