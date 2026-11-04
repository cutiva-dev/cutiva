# ADR 0008: Auto-reframe as a step other backends call

**Status:** proposed · 2026-11-04

## Context

Cutiva's auto-reframe plans in `@cutiva/core` (TypeScript and Dart) from numbers: faces, mouth movement, speech level, camera cuts. It runs in the browser (`@cutiva/web`) and on Android (`@cutiva/expo`).

The first product that wants it on a server already has a pipeline that turns long episodes into short clips. That pipeline owns the job queue, brands, moment picking, rendering and publishing, and it already has its own auto-framing: a face and active-speaker analysis plus its own planner, which writes fixed framing stretches per clip. It wants to move to Cutiva's planner without breaking what already works, and it wants rules Cutiva didn't have, such as no shot shorter than 2 s.

Later, the same steps (analyse, reframe, and more) may run as a hosted service for any developer or AI agent. That service lives in the private `cutiva-cloud` repository; this repository only holds what every SDK shares.

## Decision

**1. Cutiva is a set of steps, not an orchestrator.** A calling backend decides what runs and when. Cutiva's steps take numbers or files in and give numbers or files out, with no knowledge of brands, scores or social networks.

**2. Planning options that a caller needs go into the planner's input, not the project.** The first one is `minShotUs` on `planReframe`: the shortest shot to keep, combined with the camera style's minimum (the longer wins). It is not stored in the Reframe Track, so the CPF schema doesn't change.

**3. The first server integration replaces the backend's planner directly.** The calling backend installs `@cutiva/core` (from a packed tarball until the npm org exists), converts its existing analysis into `planReframe` input, and writes Cutiva's segments back in its own framing format. Everything around the planner (queue, progress, undo, editor, render) stays as it is. The maintainer chose this over a shadow-mode comparison; the backend's undo ("back to how it was") is the safety net.

**4. Before that, the core reads active-speaker scores.** The backend already runs an active-speaker model (Light-ASD) that watches each face and listens to the audio together; it tells who talks better than lip movement. `PlanFace.speaking` (0 to 1) carries it, and replaces lip activity for the faces that have it, so the switch loses no signal.

**5. Migration goes one piece at a time:**

- A. The planner options the backend needs (`minShotUs`) and `PlanFace.speaking`, in the core (TypeScript and Dart).
- B. The backend swaps its planner for Cutiva's; its old planner is removed once real clips look right.
- C. Smooth camera motion and editing by person in the backend's web and mobile editors and renderer, which today only know fixed framing stretches.
- D. A hosted `analyze` + `reframe` step in `cutiva-cloud`, which the backend calls instead of its own analysis.

## Consequences

- The core gains caller options one at a time, each with a unit test and a hand-written fixture in TypeScript and Dart (`plan-min-shot` for `minShotUs`).
- The switch costs nothing to run: no new server, and the planner takes milliseconds next to the analysis.
- Until step C, each framing stretch is fixed: the backend uses one window per Cutiva segment and drops the camera's smooth follow.
- There is no side-by-side measurement against the old planner; quality is judged on real clips, with undo as the fallback.
- An edge moved onto a camera cut can still leave a shot up to 400 ms shorter than `minShotUs`.
- Before step D, the licenses of any model the hosted analysis uses must be checked against rule 6 and rule 11 of `CLAUDE.md` (no non-commercial models, pinned hashes, no stored face images).
