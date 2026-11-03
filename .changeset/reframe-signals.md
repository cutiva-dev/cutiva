---
"@cutiva/core": minor
"@cutiva/web": minor
---

Auto-reframe analysis now records stereo pan and burned-in black bars (`stereoPan` and `detectActiveArea` in the core, `analysis.activeArea` in `@cutiva/web`), reports its stage in `onProgress(ratio, stage)`, and throws `NO_VIDEO_TRACK` (was `ASSET_NOT_FOUND`) for an asset without video. The MediaPipe detector checks its model against a pinned SHA-256 (`MEDIAPIPE_MODEL_SHA256`, `modelSha256`), caches it in Cache Storage, reports download progress and throws `MODEL_LOAD_FAILED` when it can't load.
