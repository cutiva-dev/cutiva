# CutivaEngine (iOS)

The Cutiva engine for iOS (and macOS), a Swift package with no dependencies ([ADR 0004](../../docs/adr/0004-mobile-engine-render-plan.md), [ADR 0007](../../docs/adr/0007-mobile-reframe-first.md)). It applies no edit rules: it renders the `RenderPlan` that `renderPlan(project)` in `@cutiva/core` or `cutiva_core` produces, and measures videos for auto-reframe.

Status: export and analysis tested on macOS and the iOS simulator; real iPhones need testing. One video layer only (`UNSUPPORTED_FEATURE` otherwise). No preview yet.

- **Export** (`CutivaExporter`): `AVMutableComposition` with one video track and one audio track per lane of non-overlapping sounds, `scaleTimeRange` for speed (varispeed: the pitch changes, as on the web), audio mix volume ramps for volume and fades, and a Core Image compositor that letterboxes plain clips and draws reframed ones like `draw.ts` (single, split, wide over a blur). H.264 + AAC MP4. Cancelling the task stops it with `EXPORT_CANCELLED`.
- **Analysis** (`ReframeAnalyzer`): frames at 5 fps in display orientation, faces through a `FaceDetector`, colour histograms, peak luma and speech loudness and pan, returned as the JSON `@cutiva/expo` reads. `MediaPipeFaceDetector` compiles only where the app links `MediaPipeTasksVision` (the `@cutiva/expo` pod); `FaceModel` downloads the model once and checks its pinned SHA-256.
- Crop keys are evaluated with `cropAt` / `layoutAt` / `sourceTimeAt`, checked against the `reframe` and `reframe-layouts` conformance fixtures; `AudioSignals` against the `signals-*` fixtures.

```bash
swift test   # macOS; the same tests run on an iOS simulator in CI (xcodebuild test -scheme CutivaEngine)
```

The tests export and check `Tests/CutivaEngineTests/Fixtures/clip.mp4` (white flash and 440 Hz beep at x.5–x.6 s each second; sync within 5 ms) and analyse `talk.mp4` with a fake face detector.
