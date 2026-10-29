# cutiva_core

The Dart port of [`@cutiva/core`](../../core): the Cutiva Project Format (CPF), editing commands with undo and redo, and the timeline rules that say what is visible and audible at any time. Pure Dart, with no Flutter dependency and no runtime dependencies.

Status: **working, not published.** It passes the same [conformance fixtures](../../../conformance) as the TypeScript core, so a project gives the same durations, frames and audio segments on web and in Dart. The Flutter plugin that previews and exports video (`cutiva_flutter`, see [ADR 0004](../../../docs/adr/0004-mobile-engine-render-plan.md)) is planned.

```dart
import 'dart:convert';

import 'package:cutiva_core/cutiva_core.dart';

final editor = Editor(width: 1080, height: 1920);
editor.dispatch(AssetAdd(Asset(
  id: 'ast_intro',
  kind: AssetKind.video,
  name: 'intro.mp4',
  uri: 'file:///intro.mp4',
  durationUs: 42000000,
  hasAudio: true,
)));

final added = editor.dispatch(const ClipAdd('ast_intro'));
final split = editor.dispatch(ClipSplit(added.clipId, atUs: 10000000));
editor.dispatch(ClipRemove(split.leftId, ripple: true));
editor.undo();

// What to draw at 5 s, bottom layer first.
final layers = resolveVideoAt(editor.project, 5000000);

// Save and reopen: the JSON is the same CPF document the web SDK reads.
final json = jsonEncode(editor.toJson());
final reopened = Editor(project: json);
```

The same code runs in [`example/main.dart`](example/main.dart).

## Differences from the TypeScript API

- Commands are classes (`ClipSplit(clipId, atUs: …)`) instead of objects with a `type`. `toJson()` gives the TypeScript shape.
- `dispatch` returns a typed result: `ClipAdd` gives a `ClipAddResult` with `clipId` and `trackId`, `ClipSplit` a `ClipSplitResult` with `leftId` and `rightId`.
- `clip.add` picks a track automatically when `trackId` is null (TypeScript also accepts `"auto"`).
- Changes arrive on `editor.changes`, a synchronous broadcast `Stream<EditorChange>`.
- Error codes are an enum; `error.code.value` is the shared string, such as `INVALID_RANGE`.
- Dart can't freeze objects. Treat `editor.project` as read-only and change it only with commands.
- Rounding uses `roundHalfUp`, which matches JavaScript's `Math.round` also for negative values. Dart's `round()` does not.

## Development

```bash
dart pub get
dart analyze
dart test                                  # unit tests + the shared conformance fixtures
dart run coverage:test_with_coverage && dart run tool/check_coverage.dart   # fails under 90%
```

Licensed under Apache-2.0.
