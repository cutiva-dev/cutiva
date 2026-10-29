import 'dart:convert';

import 'package:cutiva_core/cutiva_core.dart';

void main() {
  final editor = Editor(width: 1080, height: 1920);
  editor.dispatch(
    AssetAdd(
      Asset(
        id: 'ast_intro',
        kind: AssetKind.video,
        name: 'intro.mp4',
        uri: 'file:///intro.mp4',
        durationUs: 42000000,
        hasAudio: true,
      ),
    ),
  );

  final added = editor.dispatch(const ClipAdd('ast_intro'));
  final split = editor.dispatch(ClipSplit(added.clipId, atUs: 10000000));
  editor.dispatch(ClipRemove(split.leftId, ripple: true));
  editor.undo();

  // What to draw at 5 s, bottom layer first.
  for (final layer in resolveVideoAt(editor.project, 5000000)) {
    print('${layer.clip.id} shows ${layer.asset.name} at ${formatTimecode(layer.sourceTimeUs)}');
  }

  // Save and reopen: the JSON is the same CPF document the web SDK reads.
  final json = jsonEncode(editor.toJson());
  final reopened = Editor(project: json);
  print('${reopened.project.tracks.first.clips.length} clips, ${formatTimecode(reopened.durationUs)} long');
}
