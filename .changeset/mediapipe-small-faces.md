---
"@cutiva/web": patch
---

The MediaPipe face detector finds small faces in wide shots: it also looks in overlapping tiles and merges the boxes (`tiles: false` turns it off), and measures mouth openness as the inner-lip gap over the face's height instead of the `jawOpen` blendshape, which stays near zero on small faces.
