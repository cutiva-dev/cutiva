# ADR 0007: Auto-reframe on mobile first, through an Expo module

**Status:** proposed · 2026-11-03

## Context

Auto-reframe works on the web (ADR 0005, ADR 0006, reframe MVP phases 0–5). The first app that wants it on a phone is built with Expo, and it needs reframing only: a landscape video in, a vertical MP4 out. It needs no timeline, preview or editor.

ADR 0004 plans the mobile SDK as a whole: one native engine per OS that plays a render plan, a React Native Expo module and a Flutter plugin, each with preview and export. Reframe phase 6 (mobile analysis and preview) was to come after those bindings (integration map, conflict 12). Building the whole mobile SDK first would delay the one feature that is asked for by months.

Today the Android engine exports one video layer and refuses reframed clips (`UNSUPPORTED_FEATURE`). There is no iOS engine. MediaPipe Face Landmarker, the web's face detector, also ships for Android and iOS under Apache-2.0.

## Decision

Bring auto-reframe to mobile before the rest of the mobile SDK, as a narrow slice of ADR 0004, and reuse every piece of it:

**1. The engines draw crops.** The Android engine (and later the iOS one) reads the `crop` keys of `renderPlan` segments and draws them the way `@cutiva/web`'s `draw.ts` does: a single window filling the frame, a split (two regions filling the top and bottom halves) or wide (the area letterboxed over a blurred, dimmed copy). It evaluates the keys with ports of `cropAt` and `layoutAt`, checked against the `reframe` and `reframe-layouts` conformance fixtures. This is evaluation of what the plan says, not an edit rule.

**2. Analysis runs natively and returns numbers.** A separate engine module (`dev.cutiva.engine.reframe` on Android) samples frames at 5 fps, finds faces with MediaPipe Face Landmarker (same model and pinned SHA-256 as the web, same overlapping tiles, same lip-gap mouth measure), and measures what `analyzeAsset` measures on the web: colour histograms, the brightest luma per pixel, speech loudness and stereo pan. Pan is a port of `stereoPan`, checked against the `signals-*` fixtures. Only numbers cross to JavaScript; frames and audio stay in native memory.

**3. Planning stays in `@cutiva/core`.** JavaScript turns the numbers into a `ReframeAnalysis` (with `detectCuts` and `detectActiveArea`) and plans with `planReframe`, unchanged. Corrections (focus on a person, split, wide) use `editReframeTrack`, as on the web.

**4. One Expo module, `@cutiva/expo`**, built with the Expo Modules API. Its first function is `reframeVideo(uri, { format })`, which analyses, plans and exports in one call and returns the new file and the Reframe Track. It runs `@cutiva/core` in JavaScript and sends the plan to the engine as JSON, exactly the binding ADR 0004 describes, minus the preview view. ADR 0004 named the package `@cutiva/react-native`; it is `@cutiva/expo` because it needs Expo's module system, and apps without Expo can add it with `npx install-expo-modules`.

Android comes first, because its engine already exports and the emulator is set up. iOS follows with the same JavaScript API.

New dependencies, all Apache-2.0 or MIT: MediaPipe Tasks Vision for Android (`com.google.mediapipe:tasks-vision` 1.1.1, the web's version) and for iOS, and `expo-modules-core`.

## Consequences

- An Expo app can reframe a video on the phone, with no server, months before the mobile editor exists.
- Expo Go can't load the module: apps need a development build (`npx expo run:android` or EAS Build), as with any native video module.
- `cropAt`, `layoutAt` and `stereoPan` gain Kotlin (and later Swift) twins. They are small and pinned by the same fixtures as the TypeScript and Dart versions. `planReframe` keeps two implementations (TypeScript, Dart).
- Face detection on a phone may not match the web exactly (different MediaPipe runtimes and frame decoders). Phase 6's condition still applies: the same clip must give the same track within tolerances, and analysis of a 3-minute clip must take under 3 minutes on a mid-range phone. Until that is measured, mobile reframe is "needs testing".
- The engine's reframe module adds MediaPipe (a few MB of native libraries) only to apps that use it; the export engine stays free of it.
- **MediaPipe's Android library sends anonymous usage statistics** (task name, latency, device model) to Google through `com.google.android.datatransport`, with no switch to turn it off. No frames, faces or results are sent. The docs say so; if it is unacceptable, the alternative is running the same model's two TFLite networks with LiteRT and our own pre- and post-processing.
- When the full mobile SDK arrives (ADR 0004), `@cutiva/expo` grows a preview view and the editor API; `reframeVideo` stays as a shortcut.
