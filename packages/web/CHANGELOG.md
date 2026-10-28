# @cutiva/web

## 0.1.0

### Minor Changes

- 722724c: First public release. `@cutiva/core`: the CPF project format, edit commands with undo/redo, and timeline resolution. `@cutiva/web`: import, preview with a frame cache, timeline thumbnails, and MP4 export with WebCodecs, end-to-end tested in Chrome, Firefox and WebKit on macOS. `@cutiva/react`: `useCutiva`, `useProject`, `usePreview` and `<Timeline>`.

### Patch Changes

- f1882c5: Export works in Firefox and Safari. Firefox can't encode AAC, so exported audio falls back to Opus there; `capabilities()` reports it in the new `audioCodec` field. In Safari, exported audio no longer starts 44 ms late.
- Updated dependencies [722724c]
  - @cutiva/core@0.1.0
