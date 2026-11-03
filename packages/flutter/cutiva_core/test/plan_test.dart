import 'package:cutiva_core/cutiva_core.dart';
import 'package:test/test.dart';

import 'helpers.dart';

void main() {
  test('carries URIs and settings, numbers layers among video tracks only, and skips clips without an asset', () {
    final editor = Editor(ids: sequentialIds());
    editor.dispatch(AssetAdd(video()));
    editor.dispatch(AssetAdd(music()));
    editor.dispatch(const ClipAdd('ast_a', sourceOutUs: 5000000));
    editor.dispatch(const TrackAdd(TrackKind.video));
    editor.dispatch(const ClipAdd('ast_v', trackId: 'trk_2', startUs: 1000000));
    final plan = renderPlan(editor.project);
    expect(plan.settings.toJson(), editor.project.settings.toJson());
    expect(identical(plan.settings.fps, editor.project.settings.fps), isFalse);
    expect(plan.toJson()['video'], [
      {
        'layer': 0,
        'trackId': 'trk_2',
        'clipId': 'clip_2',
        'assetId': 'ast_v',
        'uri': 'file://v.mp4',
        'startUs': 1000000,
        'endUs': 21000000,
        'sourceInUs': 0,
        'sourceOutUs': 20000000,
        'speed': 1,
      },
    ]);
    expect(
      [for (final a in plan.audio) a.toJson()],
      [
        {
          'clipId': 'clip_1',
          'assetId': 'ast_a',
          'startUs': 0,
          'sourceInUs': 0,
          'sourceOutUs': 5000000,
          'speed': 1,
          'volume': 1,
          'fadeInUs': 0,
          'fadeOutUs': 0,
          'uri': 'file://a.mp3',
          'endUs': 5000000,
        },
        containsPair('uri', 'file://v.mp4'),
      ],
    );
    expect(plan.toJson(), containsPair('durationUs', 21000000));

    final orphan = editor.project.copy()..assets.clear();
    expect(renderPlan(orphan).video, isEmpty);
    expect(renderPlan(orphan).audio, isEmpty);
  });
}
