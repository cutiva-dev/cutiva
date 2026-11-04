# @cutiva/expo

Auto-reframe for Expo and React Native apps: a landscape video in, a vertical (9:16) MP4 out that follows whoever is talking. Faces are found and the video is exported **on the phone**, with no server ([ADR 0007](../../docs/adr/0007-mobile-reframe-first.md)).

Status: **beta, iOS and Android, tested on the Android 15 emulator and the iOS simulator.** Real phones need testing.

```ts
import { reframeVideo } from "@cutiva/expo";

const result = await reframeVideo(videoUri, {
  onProgress: (ratio, stage) => setProgress(ratio), // stage: "model" | "video" | "audio" | "export"
});

result.uri;      // file:// URI of the vertical MP4, ready for expo-video or an upload
result.track;    // who speaks when, and which shot each segment uses
result.analysis; // keep it: corrections re-plan from it without analysing again
```

Correct a shot (focus another person, split two people, or go wide) and export again, in a second or two plus the export:

```ts
const fixed = await reframeVideo(videoUri, {
  analysis: result.analysis,
  track: result.track,
  edits: [{ type: "segment", segmentId: result.track.segments[2].id, layout: "single", focus: ["p2"] }],
});
```

Corrected segments are locked: re-planning never changes them. `{ type: "reset", segmentId }` gives one back to the planner; `{ type: "settings", style: 0..100 }` makes the camera calmer or livelier.

## Install

```bash
npx expo install @cutiva/expo
npx expo run:ios       # or run:android; a development build: Expo Go can't load native modules
```

Needs Expo SDK 58 or later, iOS 16.4 or later, and Android 7 (API 24) or later. Pass `file://` URIs (what `expo-image-picker` returns); Photos `ph://` URIs are rejected with `ASSET_NOT_FOUND`. `expo` and `react-native` are peer dependencies, marked optional only so that npm doesn't install them in the Cutiva monorepo; every Expo app has them.

## How it works

| Step | Where | What |
| --- | --- | --- |
| Analyse | Native (Swift, Kotlin) | 5 frames per second; faces and mouth movement with MediaPipe Face Landmarker; speech loudness and stereo pan; colour histograms and peak brightness |
| Plan | JavaScript, [`@cutiva/core`](../core) | Camera cuts, black bars, who speaks when, which shot, where the window sits: the same `planReframe` as the web |
| Export | Native | The Cutiva iOS engine (AVFoundation, Core Image) or Android engine (Media3) draws each frame (single window, split, or wide over a blur) and encodes H.264 + AAC with the phone's encoders |

`analyzeVideo`, `planVideo` and `reframedProject` expose each step. `result.project` is a Cutiva project (CPF) you can save and open in any Cutiva editor.

## Privacy

Frames and audio never leave the device; the analysis is numbers only. The face model (MediaPipe `face_landmarker.task`, 3.7 MB, Apache-2.0) downloads once from Google's model storage and is checked against a pinned SHA-256; this is why the module adds the `INTERNET` permission. **MediaPipe's Android library sends anonymous usage statistics** (task name, latency, device model) to Google; no images or results. Tell your users if your privacy policy needs it. On iOS, MediaPipe Tasks Vision 1.0.0 comes from CocoaPods; a scan of its binaries found no usage-statistics code, but its network traffic hasn't been measured.

## Speed

A 48-second 1080p clip takes about 3 minutes to analyse on the Android emulator and about 2 minutes on the iOS simulator; exporting it on the iOS simulator takes about 7 minutes (CPU drawing). Real phones should be faster; this needs measuring. Analysis is the slow part: keep `result.analysis` for corrections.

## Example

[`apps/expo-example`](../../apps/expo-example): pick a video, reframe it, watch it, tap a shot to correct it.

Licensed under Apache-2.0.
