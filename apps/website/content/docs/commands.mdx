---
title: Commands and undo
description: Every edit in Cutiva is a serializable command.
---

You never mutate a project directly. You dispatch a **command**, a plain object the core validates and applies. If it fails, nothing changes.

```ts
const { leftId, rightId } = editor.dispatch({ type: "clip.split", clipId, atUs: 12_000_000 });
editor.undo();
editor.redo();
```

| Command | What it does |
| --- | --- |
| `clip.add` | Place an asset on a track (end of track by default) |
| `clip.split` | Cut a clip in two at a timeline time |
| `clip.trim` | Change a clip's source in or out point |
| `clip.move` | Move a clip to a new time or track |
| `clip.reorder` | Move a clip to an index and close gaps |
| `clip.remove` | Delete a clip, optionally closing the gap |
| `clip.setVolume`, `clip.setSpeed`, `clip.setFade` | Adjust a clip |
| `track.add`, `track.setMuted` | Manage tracks |

`editor.batch([...])` applies several commands as one undo step, all or nothing. Errors are `CutivaError` objects with a stable `code`, such as `OVERLAP` or `INVALID_RANGE`.
