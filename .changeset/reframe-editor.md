---
"@cutiva/core": minor
"@cutiva/web": minor
"@cutiva/react": minor
---

Reframe editing: `planReframe` returns `sightings` (where each person's face was seen) and a new error code `ANALYSIS_NEEDED`; `engine.reframe`, `engine.editReframe` and `engine.reframePlan` in `@cutiva/web` plan with the clip's Reframe Track and apply keys and track as one undo step, with analyses cached in memory and IndexedDB; `<Timeline>` shows Speakers and Camera lanes for reframed clips (`reframeLanes`, `selectedSegment`, `onSelectSegment`) and `<ReframeBox>` takes `faces`, `onFaceClick` and `onWindow`. `ReframeAnalysis` now records `fromUs`, `toUs` and `fps`.
