# ADR 0008: Auto-reframe as a step other backends call, tried first in shadow mode

**Status:** proposed · 2026-11-04

## Context

Cutiva's auto-reframe plans in `@cutiva/core` (TypeScript and Dart) from numbers: faces, mouth movement, speech level, camera cuts. It runs in the browser (`@cutiva/web`) and on Android (`@cutiva/expo`).

The first product that wants it on a server already has a pipeline that turns long episodes into short clips. That pipeline owns the job queue, brands, moment picking, rendering and publishing, and it already has its own auto-framing: a face and active-speaker analysis plus its own planner, which writes fixed framing stretches per clip. It wants to move to Cutiva's planner without breaking what already works, and it wants rules Cutiva didn't have, such as no shot shorter than 2 s.

Later, the same steps (analyse, reframe, and more) may run as a hosted service for any developer or AI agent. That service lives in the private `cutiva-cloud` repository; this repository only holds what every SDK shares.

## Decision

**1. Cutiva is a set of steps, not an orchestrator.** A calling backend decides what runs and when. Cutiva's steps take numbers or files in and give numbers or files out, with no knowledge of brands, scores or social networks.

**2. Planning options that a caller needs go into the planner's input, not the project.** The first one is `minShotUs` on `planReframe`: the shortest shot to keep, combined with the camera style's minimum (the longer wins). It is not stored in the Reframe Track, so the CPF schema doesn't change.

**3. The first server integration runs in shadow mode.** The calling backend installs `@cutiva/core` (from a packed tarball until the npm org exists), converts its existing analysis into `planReframe` input, and runs Cutiva's planner next to its own. Cutiva's result is stored apart and compared; users keep seeing the existing framing. A failure in Cutiva's planner is logged and never fails a clip.

**4. Migration goes one piece at a time**, and each step waits for evidence from the previous one:

- A. Shadow mode, as above. Cutiva's planner moves on only if, over at least 20 real clips, it frames the active speaker at least as often as the existing planner (measured against the existing active-speaker scores, which Cutiva's planner doesn't read yet) and makes no more short shots.
- B. A hosted `analyze` + `reframe` step in `cutiva-cloud`, which the backend calls instead of its own analysis.
- C. Active-speaker scores as an optional per-face input in the core (TypeScript and Dart), with fixtures and its own ADR.
- D. Cutiva's planner becomes the default and the backend's own planner is removed.

## Consequences

- The core gains caller options one at a time, each with a unit test and a hand-written fixture in TypeScript and Dart (`plan-min-shot` for `minShotUs`).
- Shadow mode costs nothing to run: no new server, and the planner takes milliseconds next to the analysis.
- The comparison checks the planner only. Analysis differences (face detector, speaker model) are tested in step B.
- An edge moved onto a camera cut can still leave a shot up to 400 ms shorter than `minShotUs`; the comparison counts those.
- Before step B, the licenses of any model the hosted analysis uses must be checked against rule 6 and rule 11 of `CLAUDE.md` (no non-commercial models, pinned hashes, no stored face images).
