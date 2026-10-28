---
title: Project format (CPF)
description: The Cutiva Project Format, a versioned JSON document every SDK reads.
---

A Cutiva project is a JSON document called **CPF** (Cutiva Project Format). A project saved on one platform opens on any other.

- **Assets** are the media files, identified by id and a fingerprint (size and a hash of the first 64 KiB) so they can be relinked on another device.
- **Tracks** are `video` or `audio`. Video tracks are drawn in array order; later tracks draw on top.
- **Clips** place a range of an asset (`sourceInUs` to `sourceOutUs`) at a position on the timeline (`startUs`), with `speed`, `volume` and effects.

All times are **integer microseconds**. `12_000_000` is twelve seconds.

```json
{
  "version": "0.1.0",
  "id": "prj_8f2a",
  "settings": { "width": 1080, "height": 1920, "fps": { "num": 30, "den": 1 }, "sampleRate": 48000 },
  "assets": [{ "id": "ast_v1", "kind": "video", "name": "intro.mp4", "uri": "file://intro.mp4", "durationUs": 42000000 }],
  "tracks": [{ "id": "trk_v1", "kind": "video", "muted": false, "clips": [
    { "id": "clip_1", "assetId": "ast_v1", "startUs": 0, "sourceInUs": 2000000, "sourceOutUs": 12000000, "speed": 1, "volume": 1, "effects": [] }
  ]}]
}
```

`parseProject()` validates a document and reports the exact path of any error.
