---
"@cutiva/core": minor
"@cutiva/web": minor
---

Split and wide layouts are drawn: `CropKey` carries a `layout` (split regions as rectangles, or the wide area), `layoutAt(keys, sourceUs)` gives the layout in effect, and `resolveVideoAt` layers have `layout`. `@cutiva/web` draws a split as two halves and wide as the whole picture over a blurred, darkened copy, in preview and export alike.
