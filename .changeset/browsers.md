---
"@cutiva/web": patch
---

Export works in Firefox and Safari. Firefox can't encode AAC, so exported audio falls back to Opus there; `capabilities()` reports it in the new `audioCodec` field. In Safari, exported audio no longer starts 44 ms late.
