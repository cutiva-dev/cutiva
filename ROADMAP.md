# Roadmap

Each phase starts only when the previous one passes its gate. Status is updated only when something ships.

| Phase | Scope | Gate | Status |
| --- | --- | --- | --- |
| 0 · Foundations | Monorepo, CI, core model, browser export spike | A trimmed MP4 exports in Chromium | Done: an E2E test in CI (Chrome, macOS) trims, exports and checks the MP4 |
| 1 · Web pilot | React SDK, online playground, npm v0.1 | Public demo, core coverage ≥ 90%, conformance green | In progress: core coverage 100% and 5 conformance fixtures green; npm v0.1 prepared, not published; public demo live at cutiva.ngstudios.co/play |
| 2 · Mobile pilot | Shared native engine (AVFoundation, Media3), React Native (Expo Module) and Flutter bindings | Fixtures give identical results on web, React Native and Flutter | In progress: the Dart core passes all conformance fixtures; native engines and bindings planned |
| 3 · Full web editing | Firefox and Safari export, text, overlays, transitions, proxies, OpenTimelineIO | Export verified in three browser engines | Planned |
| 4 · Native and desktop | Swift and Kotlin SDKs, desktop with LGPL FFmpeg | CPF 1.0 frozen | Planned |
| 5 · Cloud (optional, commercial) | AI edits returned as CPF commands, cloud rendering | | Planned |
