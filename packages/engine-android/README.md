# cutiva-engine (Android)

The Android engine of Cutiva: it renders a **render plan** (`renderPlan(project)` from [`@cutiva/core`](../core) or [`cutiva_core`](../flutter/cutiva_core)) with [Media3](https://developer.android.com/media/media3) Transformer and the device's own H.264 and AAC encoders. It applies no edit rules of its own ([ADR 0004](../../docs/adr/0004-mobile-engine-render-plan.md)). The Flutter plugin and the React Native module will call it; it isn't published on its own.

Status: **export works on the Android 15 (API 35) emulator**, checked by instrumentation tests; real devices need testing. Preview is planned. The `reframe` module analyses videos for auto-reframe ([ADR 0007](../../docs/adr/0007-mobile-reframe-first.md)).

| | Status |
| --- | --- |
| Export to MP4 (H.264 + AAC) at the project size, letterboxed | Working on the emulator |
| One video layer, gaps shown as black | Working on the emulator |
| Several video layers | Not yet: fails with `UNSUPPORTED_FEATURE` |
| Reframed clips: single window, split and wide + blur, as `@cutiva/web` draws them | Working on the emulator |
| Speed, capped at the project frame rate | Working on the emulator |
| Audio mixing, volume (up to 4x, clipped), linear fades in timeline time | Working on the emulator |
| Audio within 5 ms of the picture | Working on the emulator (see below) |
| Preview (`CompositionPlayer`) | Planned |

```kotlin
val plan = RenderPlan.fromJson(planJson) // the JSON renderPlan() returns
val task = CutivaExporter(context).export(plan, outputFile.absolutePath, object : CutivaExporter.Listener {
    override fun onProgress(fraction: Float) { /* 0..1 */ }
    override fun onCompleted(summary: ExportSummary) { /* done */ }
    override fun onError(error: CutivaException) { /* error.code: NOTHING_TO_EXPORT, UNSUPPORTED_FEATURE, EXPORT_CANCELLED, EXPORT_FAILED */ }
})
// task.cancel()
```

## Audio sync

Two Media3 behaviors would put the sound tens of milliseconds behind the picture. The engine corrects both, and `ExportTest` checks every beep of the fixture lands within 5 ms:

- **Encoder priming.** AAC encoders prepend silence that the MP4 edit list must skip. Media3 assumes 1600 samples for `c2.android.aac.encoder` (it adds 2048 on the emulator) and nothing for hardware encoders. `EncoderDelay` measures the real value once per encoder, like the web engine: encode a noise burst, decode it, cross-correlate.
- **Cuts after 0.** When an AAC input is cut at any point after 0, Media3 plays it one AAC frame (1024 samples) late. `SourceDelay` cuts those clips one frame later. This was measured on the emulator; real devices with hardware decoders need checking.

## Reframed clips

Segments with `crop` keys (and `sourceWidth`, `sourceHeight`) are drawn by a GL effect (`ReframeEffect`) at the output size: the crop rectangle filling the frame, a split's two regions in the top and bottom halves, or wide (the area letterboxed over a copy shrunk to 32 px, stretched back and darkened 35%). Keys are evaluated with Kotlin ports of `cropAt` and `layoutAt` (`Crop.kt`), checked against the `reframe` and `reframe-layouts` conformance fixtures. `ReframeExportTest` exports the web E2E fixture `talk.mp4` and checks colours and face edges at the same points as `reframe-export.spec.ts`. Media3 may write a portrait export as landscape with a 90° rotation tag; players show it upright.

## Reframe analysis (`reframe` module)

`dev.cutiva.engine.reframe` measures what `analyzeAsset` measures on the web, as numbers only:

```kotlin
val model = FaceModel.load(context)            // downloaded once, checked against its pinned SHA-256
val m = MediaPipeFaceDetector(context, model).use { detector ->
    ReframeAnalyzer(context).analyze(uri, detector, onProgress = { ratio, stage -> })
}
m.toJson() // faces, voice, pan, colour histograms, peak luma: what @cutiva/core plans from
```

- Frames: Media3 `FrameExtractor` at 5 fps, scaled to 640 px on the GPU.
- Faces: MediaPipe Face Landmarker (`tasks-vision` 1.1.1, the web's model and hash), on the whole frame and on overlapping tiles (`FaceTiles.kt`, a port of `face-tiles.ts` with the same tests); the mouth is the inner-lip gap over face height.
- Audio: decoded with `MediaCodec` in one pass; loudness and stereo pan (`AudioSignals`, checked against the `signals-pan` fixture) within 100 ms of each frame.
- Planning is not here: `@cutiva/core` (`detectCuts`, `detectActiveArea`, `planReframe`) plans from the JSON.

On the first real clip (48 s podcast, 3 people) the Android analysis matches the web's: same frames, faces per frame within 1%, identical voice levels and cuts, and the same speaker turns (edges within 0.2 s) except one stretch with an off-camera voice. It took 177 s on the emulator (software GPU); speed on real phones needs measuring.

**Privacy:** frames and audio never leave the device. MediaPipe's Android library itself sends anonymous usage statistics (task name, latency, device model) to Google through `com.google.android.datatransport`; no images or results. Apps that must avoid this need to know before shipping.

`RealVideoBenchmark` runs the analysis on any video you pass (`-Pandroid.testInstrumentationRunnerArguments.video=file:///...`) and writes `real-analysis.json` to the test app's cache; it is skipped otherwise.

## Development

Needs JDK 17 and the Android SDK (`local.properties` with `sdk.dir`, or `ANDROID_HOME`).

```bash
./gradlew :engine:testDebugUnitTest :reframe:testDebugUnitTest                 # JVM tests: lanes, gaps, gain, delay, crop keys, tiles, pan
./gradlew :engine:connectedDebugAndroidTest :reframe:connectedDebugAndroidTest # exports and analysis on a running emulator or device
```

Dependencies: Media3 1.11.1 (`transformer`, `effect`, `common`, `inspector`; the `reframe` module also `inspector-frame`) and MediaPipe Tasks Vision 1.1.1 (`reframe` module only), all Apache-2.0. Tests also use JUnit 4 (EPL-1.0), org.json (public domain) and AndroidX Test, never shipped.

Licensed under Apache-2.0.
