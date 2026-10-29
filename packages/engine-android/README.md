# cutiva-engine (Android)

The Android engine of Cutiva: it renders a **render plan** (`renderPlan(project)` from [`@cutiva/core`](../core) or [`cutiva_core`](../flutter/cutiva_core)) with [Media3](https://developer.android.com/media/media3) Transformer and the device's own H.264 and AAC encoders. It applies no edit rules of its own ([ADR 0004](../../docs/adr/0004-mobile-engine-render-plan.md)). The Flutter plugin and the React Native module will call it; it isn't published on its own.

Status: **export works on the Android 15 (API 35) emulator**, checked by instrumentation tests; real devices need testing. Preview is planned.

| | Status |
| --- | --- |
| Export to MP4 (H.264 + AAC) at the project size, letterboxed | Working on the emulator |
| One video layer, gaps shown as black | Working on the emulator |
| Several video layers | Not yet: fails with `UNSUPPORTED_FEATURE` |
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

## Development

Needs JDK 17 and the Android SDK (`local.properties` with `sdk.dir`, or `ANDROID_HOME`).

```bash
./gradlew :engine:testDebugUnitTest           # JVM tests: lanes, gaps, gain, delay correlation
./gradlew :engine:connectedDebugAndroidTest   # exports on a running emulator or device
```

Dependencies: Media3 1.11.1 (`transformer`, `effect`, `common`, `inspector`), Apache-2.0. Tests also use JUnit 4 (EPL-1.0) and AndroidX Test, never shipped.

Licensed under Apache-2.0.
