# ADR 0006: The Reframe Track lives in the `core/reframe` effect

**Status:** proposed · 2026-11-03 · extends ADR 0005, follows `docs/reframe-integration-map.md`

## Context

The reframe MVP spec (`docs/reframe-mvp-spec.md`) adds a model above crop keys: who speaks when (segments), the people in a clip, a layout per segment (single, split, wide), user choices that survive a re-analysis (`locked`) and a camera style. It proposed a separate "Reframe Track" JSON with a Rust core, millisecond times and normalised float coordinates. The maintainer chose to keep the TypeScript + Dart core (ADR 0001) and to store the track inside the project.

## Decision

**The track is the `track` field of the `core/reframe` effect's params**, next to the existing `keys`:

```json
{ "type": "core/reframe", "params": { "keys": [ ... ], "track": { "version": 1, ... } } }
```

- `keys` stay what ADR 0005 defined and stay the only thing renderers read (through `resolveVideoAt` and `renderPlan`). They are the spec's `camera`: derived from the track by the core, and reshaped automatically when the project's format changes.
- `track` holds the source of truth for automatic framing: `people`, `segments`, `style`, `maxUpscalePct`, `safeZone` and an optional `activeArea`. A clip framed only by hand has no `track`, so every existing project stays valid. Effect params are free-form, so the CPF shape and version don't change (rule 10); `track.version` versions the track itself.
- **Units follow CPF**: times are integer microseconds in **source time** (ADR 0002), positions are integer source pixels in display orientation. No milliseconds, no normalised floats, no frame indices. Settings that the spec gives as fractions are integers: `style` 0–100 (Calm 0, Balanced 50, Dynamic 100), `maxUpscalePct` (150 = 1.5×).
- **Layouts reach the renderer through keys.** A key may carry `layout: "split"` with two `regions` (`{ x, y, h }` each, the half-output aspect) or `layout: "wide"` (the whole source over a blurred fill). Without `layout` a key is a single window, as today. `x`, `y` and `h` stay on every key, so a renderer that doesn't know layouts still draws a valid crop.
- **A locked segment keeps the user's choice.** Choosing a layout, a focus or dragging the window sets `locked: true`; a drag stores the window as the segment's `window` (`{ x, y, h }`). Re-analysis and re-resolve never change a locked segment.
- **Observations stay out of the project.** Every command copies the whole project and the editor keeps up to 200 undo states, so per-frame observations would be copied on every edit. The web engine caches them in memory and IndexedDB, keyed by the asset fingerprint (`size` + `sha256Head`). Without them, edits that need a re-resolve (Never focus, camera style, merging people) ask for a new analysis; segments and locked choices are in the project either way.
- **No biometric data in the project:** no embeddings, no face images, no audio. People are ids, labels and flags. The schema forbids extra fields.
- `spec/reframe-track.schema.json` (JSON Schema 2020-12) describes the params, `spec/examples/` holds valid examples, and the core tests validate the examples and every `core/reframe` effect in `conformance/fixtures` against it. Types stay hand-written in `types.ts` and `types.dart`, like the rest of CPF. Rules a schema can't express (segments sorted and non-overlapping, person ids that exist, `window` only on locked segments) are checked by `parseProject` (`INVALID_PROJECT`).

## Consequences

- Undo/redo, Save/Open project and export need nothing new: every reframe edit is a command on the project.
- Native engines and older web builds keep working: they read keys; layouts degrade to a single crop until they draw them (the Android engine keeps refusing reframed clips).
- A project opened without the observation cache can be exported and edited by segment, but changes that re-run segmentation need a new analysis (about a minute for a three-minute clip).
- Changing a field of `track` means bumping `track.version` and migrating older tracks in `parseProject`, in TypeScript and Dart.
