---
"@cutiva/core": minor
---

`renderPlan` segments with `crop` keys also carry `sourceWidth` and `sourceHeight`, the asset size the crop rectangles are in, so native engines can scale them to the decoded frame.
