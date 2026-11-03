# Reframe integration map

Phase 0 of `docs/reframe-mvp-spec.md` · 2026-11-03 · status: **reviewed** (decisions below)

This map says where every piece of the spec plugs into the editor that exists today (the playground and the three packages), which pieces are new, and where the spec and the current editor disagree. Per the spec's own rule, the current editor wins every conflict until the maintainer decides otherwise.

**Decisions (maintainer, 2026-11-03):**

- Core: TypeScript + Dart, no Rust (conflict 1).
- The Reframe Track lives in the project, inside the `core/reframe` effect; observations stay out of it (conflicts 2 and 3). Recorded in ADR 0006.
- Real test videos: the maintainer provides them, with the speakers' consent (conflict 11).
- Every other proposal in section 3 is accepted as written: no new dependencies for detection, a drag locks the segment, docs in English, the feedback panel stays.

## 1. What already exists

Reframe and auto-reframe shipped in PR #29 (ADR 0005, proposed). A large part of the spec is already in place:

| Spec piece | Exists today | Where |
| --- | --- | --- |
| Output aspect from the Format selector | Yes: 16:9, 9:16, 1:1, 4:5 | `apps/playground/src/Reframe.tsx` (`FORMATS`, `FormatPicker`), command `project.setSize` in `packages/core/src/commands.ts` |
| Crop stored in the project, undoable, saved | Yes: `core/reframe` clip effect with keys `{ atUs, x, y, h, cut? }` in source time and source pixels | `packages/core/src/reframe.ts`, command `clip.setReframe`, validated in `parseProject` (`project.ts`); Dart port in `packages/flutter/cutiva_core/lib/src/reframe.dart` |
| `cropAt(track, t)` | Yes, integer-only and identical in TS and Dart | `cropAt`, `cropRect`, `clipCropKeys` in `reframe.ts` |
| Preview applies the crop | Yes, on the existing canvas | `resolveVideoAt` (`resolve.ts`) returns `crop` → `packages/web/src/preview.ts` → `drawLayer` (`draw.ts`) |
| Export MP4 applies the crop | Yes, through the same `drawLayer` | `packages/web/src/export.ts` |
| Undo/redo, Open/Save project | Yes: every reframe edit is a command | `packages/core/src/editor.ts`, `App.tsx` (`editor.toJSON`, `editor.load`) |
| On-device analysis: shots, faces, mouth, voice | Yes: 5 fps sampling, RGB histogram cuts, MediaPipe Face Landmarker (faces + mouth openness), speech loudness | `packages/web/src/reframe.ts` (`engine.autoReframe`), `packages/web/src/mediapipe.ts` (optional peer dependency) |
| Decision engine (speaker, hold, cuts between people, smoothing, dead zone, headroom) | Yes, deterministic, TS + Dart, pinned by conformance fixtures | `packages/core/src/auto-reframe.ts` (`autoReframe`, `detectCuts`), `auto_reframe.dart`, `conformance/fixtures/auto-reframe/` |
| Auto-reframe section in the clip inspector | Yes: Auto-reframe, progress, Cancel, people with avatars, Zoom, Restore | `AutoReframePanel` in `Reframe.tsx`, mounted in the inspector `<aside>` of `App.tsx` |
| Source view with the crop window | Yes: side-by-side source monitor with a draggable window | `SourceMonitor` (`Reframe.tsx`) + `<ReframeBox>` (`packages/react/src/ReframeBox.tsx`) |
| Framing changes on the timeline | Partly: marks on the clip where framing jumps | `reframeCuts` in `packages/react/src/Timeline.tsx` |
| Already vertical (passthrough) | Partly: same shape ±1% disables auto-reframe and offers "Switch to 9:16" | `sameShape` in `App.tsx` and `Reframe.tsx` |
| Cancellation, typed errors | Yes: `ANALYSIS_CANCELLED`, `UNSUPPORTED_CODEC`, `ASSET_SIZE_UNKNOWN` | `packages/core/src/errors.ts` |
| Tests | Unit + conformance (TS 125, Dart 121), E2E `reframe.spec.ts` (drag, preview and export colours), `auto-reframe.spec.ts` (MediaPipe, gated by `E2E_MEDIAPIPE=1`) | `packages/core/test`, `apps/playground/e2e` |
| Docs | Crop rules and auto-reframe steps | `apps/website/content/docs/project-format.mdx`, `auto-reframe.mdx` |
| Feedback loop (not in the spec) | Rate framing changes, report as a GitHub issue (PR #30, open) | `apps/playground/src/ReframeFeedback.tsx` |

## 2. What each spec piece touches

| Spec piece | Existing files it changes | New code |
| --- | --- | --- |
| Segments, people, layout, focus, `locked`, `reason` | `reframe.ts`, `auto-reframe.ts`, `commands.ts` (+ `ResultOf` in `editor.ts`), `project.ts` validation, `types.ts`; the same five in Dart; `project-format.mdx` | Commands `reframe.setSegment`, `reframe.resetSegment`, `reframe.setPerson`, `reframe.mergePeople`, `reframe.setStyle` (names to confirm); conformance fixtures |
| Speaker score (lips + pan + continuity), hysteresis 0.15, `split` / `wide` / `voice-only` / `no-face`, minimum segment, snap to cuts, `priority` / `neverFocus` | `auto-reframe.ts` + `auto_reframe.dart` | Hand-written conformance fixtures, one per rule (synthetic observations) |
| Camera style (Calm / Balanced / Dynamic) | `auto-reframe.ts` (today `minHoldUs` 1.5 s and the 5% dead zone are fixed) | One Euro filter and max speed, integer output |
| Layouts `split` and `wide + blur` | `resolve.ts` (`crop` becomes a list of regions), `plan.ts` (segments carry regions), `draw.ts` (two regions, blurred fill), `export.ts` / `preview.ts` only through `draw.ts`; Dart `resolve.dart` / `plan.dart`; Android engine keeps refusing (`UNSUPPORTED_FEATURE`) | Conformance fixtures for regions |
| Active area (burned-in bars), rotation, SAR, VFR | `packages/web/src/reframe.ts` (analysis), `media.ts` (probe); core takes the active area as input | Bars detection in the analysis pass |
| `maxUpscale` → low-quality fallback | `auto-reframe.ts` | — |
| Safe zones | `auto-reframe.ts` (offset), `SourceMonitor` / preview overlay | Platform presets |
| People panel (name, colour, Priority, Never focus, merge) | `AutoReframePanel` (today a list of avatars) | Inside the same inspector section |
| Segment editing (layout per segment, Reset to automatic, Apply to every clip) | `AutoReframePanel` | — |
| Clickable faces on the source | `SourceMonitor`, `ReframeBox` | Face overlay |
| Speakers and Camera lanes | `Timeline.tsx` (new optional props, rendered under the video track only for reframed clips), `packages/react/styles.css` | — |
| Stage-level progress, `MODEL_LOAD_FAILED`, `NO_VIDEO_TRACK` | `packages/web/src/reframe.ts`, `errors.ts` (TS + Dart) | — |
| Model download with pinned SHA-256, `modelBaseUrl` | `packages/web/src/mediapipe.ts` | — |
| E2E: import, analyse, edit, export, compare with preview | `apps/playground/e2e/auto-reframe.spec.ts` | Real-footage fixtures (see conflict 10) |

New pieces needed, placed in the current structure:

- **No new packages.** The logic goes into `@cutiva/core` + `cutiva_core`, observation into `@cutiva/web` (and `@cutiva/web/mediapipe`), reusable UI into `@cutiva/react`, editor wiring into `apps/playground`.
- `conformance/fixtures/auto-reframe/*`: one hand-written fixture per MVP rule in the edge-case table.
- `fixtures/` or `apps/playground/e2e/fixtures/`: real test videos (see conflicts 10 and 11).
- An ADR for the segment and people model (it changes what `core/reframe` stores).

## 3. Conflicts and proposals

**1. Rust core (`crates/reframe-core`, WASM, uniffi, flutter_rust_bridge) against ADR 0001.** ADR 0001 (accepted) shares the contract, not a binary: the core is TypeScript for web and React Native and Dart for Flutter, kept equal by conformance fixtures. It names Rust as a phase 5 option if keeping two ports becomes costly. The reframe decision engine already exists in both, deterministically. A Rust core now would add a second core next to the one that holds CPF, a WASM build that SDK users must bundle (the same friction that deferred the Web Worker, #5), three binding toolchains, and it would block phase 2 until iOS builds (Xcode isn't installed).
*Proposal:* keep extending `auto-reframe.ts` and `auto_reframe.dart`. The spec's determinism goal ("same track on every platform") is met the way it is today: identical conformance outputs in TS and Dart. Revisit Rust with an ADR that supersedes 0001 if a third language port (Swift/Kotlin) is ever needed.

**2. A separate Reframe Track JSON against the `core/reframe` effect in CPF.** The editor already stores framing inside the project, so undo, Save/Open and export work without anything else.
*Proposal:* the Reframe Track becomes the params of the `core/reframe` effect: today's `keys` (the spec's `camera`, already reshaped automatically when the format changes) plus `segments`, `people` and `style`. Effect params are free-form, so the CPF shape doesn't change (rule 10); `parseProject` validates the new params. Field names follow the spec where they fit.

**3. Where observations live.** The spec puts `observations` in the track or a sidecar `.obs.json`. The editor keeps up to 200 undo states and every command `structuredClone`s the whole project: a 3-minute clip at 5 fps (~900 frames with faces) inside the project would be copied on every edit and kept 200 times.
*Proposal:* observations stay out of the project. The web engine caches them in memory and in IndexedDB keyed by the asset fingerprint (size + SHA-256 of the head, which `media.ts` already computes for relinking). Edits that need them (Never focus, Camera style, merging people) re-resolve from the cache; after a reload without the cache, the UI asks to re-analyse. Segments and locked choices survive in the project either way.

**4. Milliseconds against integer microseconds.** ADR 0002 and rule 1: time is integer µs everywhere. *Proposal:* µs in storage and in the API; no ms fields.

**5. Normalised 0–1 floats rounded to 4 decimals against integer source pixels.** ADR 0005 chose integer pixels so TS, Dart, Swift and Kotlin produce identical rectangles. Asset `width`/`height` are already display dimensions (Mediabunny's `displayWidth`/`displayHeight`, rotation applied). *Proposal:* keep integer source pixels in storage; normalised values only at the UI edge if useful. SAR needs a check (see questions).

**6. Detectors and runtime dependencies.** The spec uses YuNet + Face Landmarker on ONNX Runtime Web, Silero VAD and mp4box.js. Today one MediaPipe model gives faces and mouth openness, Mediabunny already demuxes and decodes (mp4box.js would duplicate it), and voice is a loudness measure. Each new runtime dependency needs the maintainer's approval (rule 6), and YuNet's licence is still unconfirmed in the spec.
*Proposal:* keep MediaPipe and Mediabunny. Add VAD only if the real-footage benchmark shows loudness isn't enough, as an optional detector behind the existing interface. Add SHA-256 pinning and `modelBaseUrl` to the MediaPipe loader.

**7. Package names.** The spec lists `@cutiva/reframe-core`, `@cutiva/reframe-web`, `@cutiva/reframe`, `@cutiva/reframe-native` and `cutiva_reframe`. *Proposal:* no new packages (see section 2). React Native and the Flutter plugin don't exist yet for anything; reframe joins them when they do.

**8. Preview by CSS transform against the shared canvas.** The spec previews with a CSS transform over the video element. The playground previews on a canvas drawn by `drawLayer`, the same function export uses (rule 4: preview and export draw the same thing). *Proposal:* keep the canvas; every layout (single, split, wide + blur) is drawn once in `draw.ts` for both.

**9. Hand-dragged framing against "the user never sets keyframes".** Today `<ReframeBox>` lets the user drag the window, which writes keys directly. Once keys are derived from segments, a re-resolve would wipe those drags.
*Proposal:* dragging inside a segment locks it and stores the window as that segment's manual framing, which re-resolves keep. `<ReframeBox>` stays; the command it dispatches changes.

**10. Golden files recorded from real footage against rule 9.** Rule 9: conformance expected values are written by hand from the spec, never by running an SDK. A full track (segments plus camera keys) can't be written by hand for a 3-minute video.
*Proposal:* two levels. (a) Conformance: small synthetic observations per rule with hand-written expected outputs, run by TS and Dart (as today). This is what guarantees cross-platform determinism. (b) Benchmark: real fixtures with a hand-labelled "who speaks when" and the spec's metrics (≥ 85% speaker accuracy, ≤ 8 changes per minute, jitter), checked by threshold, not byte for byte.

**11. Test videos.** `fixtures/fetch.sh` needs 8 redistributable videos of real people talking. Faces are biometric data, and downloading in CI makes runs depend on the network (the MediaPipe E2E is already opt-in for that reason). *Proposal:* a script that downloads pinned files by SHA-256, used locally and in an opt-in CI job; the required CI keeps the synthetic fixtures. Sources still need choosing (questions).

**12. Mobile (phase 6).** ONNX Runtime Mobile, a Turbo Module and a Flutter plugin don't exist; ADR 0004 (accepted) has native engines render `renderPlan`, and ADR 0005 plans Apple Vision / MediaPipe Tasks as mobile detectors. iOS is blocked until Xcode is installed. *Proposal:* phase 6 comes after the `cutiva_flutter` plugin and the React Native binding exist; until then the Android engine keeps refusing reframed clips.

**13. Inspector order and "Show source".** The spec puts Auto-reframe below volume, speed and fades and uses a Show source toggle. Today the section sits between Speed and the fades, and the source monitor appears side by side with the output whenever a reframable clip is selected. *Proposal:* the editor wins: keep the position and the side-by-side monitor (it already is the source view) and add clickable faces to it. A toggle could come later for narrow screens.

**14. Two CLAUDE.md files.** The kit's `CLAUDE.md` would replace the repo's and asks for internal docs in Spanish and Rust style rules; the repo's asks for English everywhere. *Proposal:* the kit's file is not copied. Its rules that survive this map (locked segments, no embeddings or face crops in the project, no non-commercial models, pinned model hashes, a test and fixture update with every rule change) go into the repo's CLAUDE.md, in English. This map is in English for the same reason.

**15. The rest of Phase 0.** Phase 0 asks for a Cargo workspace, `spec/reframe-track.schema.json` with generated TS and Rust types, `cargo test` in CI and `fixtures/fetch.sh`. All of it depends on conflicts 1, 2, 10 and 11, so **none of it was done**. Under these proposals, Phase 0 becomes: a JSON Schema for the `core/reframe` params as documentation, validated in CI against the fixtures (types stay hand-written in `types.ts` and `types.dart`, as for the rest of CPF), plus the download script once sources are chosen.

## 4. The phases under these proposals

| Spec phase | Becomes |
| --- | --- |
| 0 Contract | ADR for segments and people in `core/reframe`; JSON Schema for its params; CI validates fixtures against it; fixture download script |
| 1 Core in Rust | The same rules in `auto-reframe.ts` + `auto_reframe.dart`, one hand-written conformance fixture per MVP edge case |
| 2 Bindings | Not needed (no Rust). Replaced by: TS and Dart pass the same fixtures (already the CI rule) |
| 3 Web detectors | Active area, rotation/SAR, stage progress, model hashes in `@cutiva/web`; VAD only if the benchmark asks for it |
| 4 Editor integration | People, segment layouts, Camera style and the lanes in the existing inspector, source monitor and `<Timeline>` |
| 5 Web export | Regions and wide + blur in `draw.ts`, used by preview and export alike |
| 6 Mobile | After the Flutter and React Native bindings exist |

## 5. Questions (answered 2026-11-03: 1 TS + Dart, 2 in the project, 3 none for now, 4 yes, 5 the maintainer provides them, 7 keep, 8 English; 6 and 9 below stay open)

1. **Rust:** do you accept keeping the TS + Dart core (conflict 1)? If you want Rust anyway, it needs an ADR that supersedes 0001, and phases 1–2 grow a lot.
2. **Track storage:** inside the `core/reframe` effect, with observations cached outside the project (conflicts 2 and 3)?
3. **New dependencies:** ONNX Runtime Web, YuNet, Silero VAD, mp4box.js: none for now, or do you want any of them from the start?
4. **Hand-dragging:** does dragging the window lock the segment with a manual framing (conflict 9)?
5. **Test videos:** do you have redistributable podcast or interview clips (CC-BY or your own, with the speakers' consent)? Without them, phases 3–5 can only be checked with synthetic fixtures.
6. **SAR:** do non-square-pixel sources matter for the MVP? Mediabunny gives display dimensions; checking it needs a sample file.
7. **Feedback panel:** keep it (PR #30) next to the new People section?
8. **Language:** this map and the docs in English (repo rule), or do you want internal docs in Spanish as the kit asks? If Spanish, the repo's CLAUDE.md changes too.
9. **Spec location:** I copied `docs/reframe-mvp-spec.md` and `docs/reframe-mockups/` into `docs/` so the plan can be ticked there. Should they be committed as they are (Spanish), and can the untracked `cutiva-reframe-kit/` folder and zip be deleted afterwards?
