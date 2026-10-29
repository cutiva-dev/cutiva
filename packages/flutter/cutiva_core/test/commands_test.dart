import 'package:cutiva_core/cutiva_core.dart';
import 'package:test/test.dart';

import 'helpers.dart';

void main() {
  late Editor editor;
  late String clipId;
  late String trackId;

  setUp(() {
    editor = Editor(ids: sequentialIds());
    editor.dispatch(AssetAdd(video()));
    editor.dispatch(AssetAdd(music()));
    final r = editor.dispatch(const ClipAdd('ast_v', sourceOutUs: 10000000));
    clipId = r.clipId;
    trackId = r.trackId;
  });

  List<List<Object>> clips([int track = 0]) => [
    for (final c in editor.project.tracks[track].clips) [c.id, c.startUs, c.sourceInUs, c.sourceOutUs],
  ];

  group('asset.add and track.add', () {
    test('adding the same asset twice keeps one copy', () {
      expect(editor.dispatch(AssetAdd(video())).assetId, 'ast_v');
      expect(editor.project.assets, hasLength(2));
    });

    test('uses the given track id or makes one', () {
      expect(editor.dispatch(const TrackAdd(TrackKind.audio, trackId: 'music')).trackId, 'music');
      expect(editor.dispatch(const TrackAdd(TrackKind.video)).trackId, 'trk_2');
    });

    test('mutes a track, and fails on unknown tracks', () {
      editor.dispatch(TrackSetMuted(trackId, muted: true));
      expect(editor.project.tracks[0].muted, isTrue);
      expect(codeOf(() => editor.dispatch(const TrackSetMuted('nope', muted: true))), 'TRACK_NOT_FOUND');
    });
  });

  group('clip.add', () {
    test('creates a matching track automatically and appends clips back to back', () {
      editor.dispatch(const ClipAdd('ast_v', sourceInUs: 0, sourceOutUs: 5000000));
      final track = editor.project.tracks[0];
      expect(track.kind, TrackKind.video);
      expect([for (final c in track.clips) c.startUs], [0, 10000000]);
      expect(editor.durationUs, 15000000);
    });

    test('places a clip on an explicit track at an explicit start, leaving a gap', () {
      final t = editor.dispatch(const TrackAdd(TrackKind.audio)).trackId;
      final r = editor.dispatch(
        ClipAdd('ast_a', trackId: t, startUs: 3000000, sourceInUs: 1000000, sourceOutUs: 2000000),
      );
      expect(r.trackId, t);
      expect(clips(1), [
        [r.clipId, 3000000, 1000000, 2000000],
      ]);
    });

    test('keeps clips sorted by start', () {
      editor.dispatch(const ClipAdd('ast_v', startUs: 15000000, sourceOutUs: 1000000, clipId: 'late'));
      editor.dispatch(const ClipAdd('ast_v', startUs: 12000000, sourceOutUs: 1000000, clipId: 'early'));
      expect([for (final c in editor.project.tracks[0].clips) c.id], ['clip_1', 'early', 'late']);
    });

    test('fails on unknown assets and tracks', () {
      expect(codeOf(() => editor.dispatch(const ClipAdd('nope'))), 'ASSET_NOT_FOUND');
      expect(codeOf(() => editor.dispatch(const ClipAdd('ast_v', trackId: 'nope'))), 'TRACK_NOT_FOUND');
    });

    test('does not put audio on a video track, or video on an audio track', () {
      expect(codeOf(() => editor.dispatch(ClipAdd('ast_a', trackId: trackId))), 'TRACK_KIND_MISMATCH');
      final audio = editor.dispatch(const TrackAdd(TrackKind.audio)).trackId;
      expect(codeOf(() => editor.dispatch(ClipAdd('ast_v', trackId: audio))), 'TRACK_KIND_MISMATCH');
    });

    test('rejects negative times, ranges outside the asset and clips shorter than 1 ms', () {
      expect(codeOf(() => editor.dispatch(const ClipAdd('ast_v', startUs: -1))), 'INVALID_RANGE');
      expect(codeOf(() => editor.dispatch(const ClipAdd('ast_v', sourceInUs: -1))), 'INVALID_RANGE');
      expect(codeOf(() => editor.dispatch(const ClipAdd('ast_v', sourceOutUs: 99000000))), 'INVALID_RANGE');
      expect(codeOf(() => editor.dispatch(const ClipAdd('ast_v', sourceInUs: 0, sourceOutUs: 999))), 'INVALID_RANGE');
    });

    test('rejects overlaps and leaves state untouched', () {
      final before = editor.project;
      expect(codeOf(() => editor.dispatch(const ClipAdd('ast_v', startUs: 1000000))), 'OVERLAP');
      expect(identical(editor.project, before), isTrue);
    });
  });

  group('clip.remove', () {
    test('without ripple leaves a gap', () {
      final b = editor.dispatch(const ClipAdd('ast_v', sourceOutUs: 2000000)).clipId;
      editor.dispatch(ClipRemove(clipId));
      expect(clips(), [
        [b, 10000000, 0, 2000000],
      ]);
    });

    test('ripple only shifts clips after the removed one, on its track', () {
      final b = editor.dispatch(const ClipAdd('ast_v', sourceOutUs: 2000000)).clipId;
      final c = editor.dispatch(const ClipAdd('ast_v', sourceOutUs: 3000000)).clipId;
      final m = editor.dispatch(const ClipAdd('ast_a', startUs: 11000000, sourceOutUs: 1000000)).clipId;
      editor.dispatch(ClipRemove(b, ripple: true));
      expect(clips(), [
        ['clip_1', 0, 0, 10000000],
        [c, 10000000, 0, 3000000],
      ]);
      expect(clips(1), [
        [m, 11000000, 0, 1000000],
      ]);
    });

    test('fails on unknown clips', () {
      expect(codeOf(() => editor.dispatch(const ClipRemove('nope'))), 'CLIP_NOT_FOUND');
    });
  });

  group('clip.split', () {
    test('splits at a timeline time and keeps source continuity', () {
      final r = editor.dispatch(ClipSplit(clipId, atUs: 6000000));
      final [left, right] = editor.project.tracks[0].clips;
      expect([left.id, right.id], [r.leftId, r.rightId]);
      expect(left.sourceOutUs, 6000000);
      expect(right.sourceInUs, 6000000);
      expect(right.startUs, 6000000);
      expect(editor.durationUs, 10000000);
    });

    test('respects speed when mapping to source time', () {
      editor.dispatch(ClipSetSpeed(clipId, 2));
      expect(editor.durationUs, 5000000);
      editor.dispatch(ClipSplit(clipId, atUs: 2000000));
      expect(editor.project.tracks[0].clips[1].sourceInUs, 4000000);
    });

    test('refuses split points on the edges', () {
      expect(codeOf(() => editor.dispatch(ClipSplit(clipId, atUs: 0))), 'INVALID_RANGE');
      expect(codeOf(() => editor.dispatch(ClipSplit(clipId, atUs: 10000000))), 'INVALID_RANGE');
      expect(codeOf(() => editor.dispatch(ClipSplit(clipId, atUs: -1))), 'INVALID_RANGE');
    });

    test('copies effects instead of sharing them', () {
      editor.dispatch(ClipSetFade(clipId, inUs: 1000000, outUs: 0));
      final r = editor.dispatch(ClipSplit(clipId, atUs: 5000000));
      final [left, right] = editor.project.tracks[0].clips;
      expect(right.id, r.rightId);
      expect(right.effects.single.toJson(), left.effects.single.toJson());
      expect(identical(right.effects.single, left.effects.single), isFalse);
      expect(identical(right.effects.single.params, left.effects.single.params), isFalse);
    });
  });

  group('clip.trim', () {
    test('trimming the head keeps the right edge in place', () {
      editor.dispatch(ClipTrim(clipId, sourceInUs: 2000000));
      expect(clips(), [
        [clipId, 2000000, 2000000, 10000000],
      ]);
    });

    test('trimming the tail shortens the clip', () {
      editor.dispatch(ClipTrim(clipId, sourceOutUs: 8000000));
      expect(editor.durationUs, 8000000);
    });

    test('respects speed when trimming the head', () {
      editor.dispatch(ClipMove(clipId, startUs: 4000000));
      editor.dispatch(ClipSetSpeed(clipId, 2));
      editor.dispatch(ClipTrim(clipId, sourceInUs: 2000000));
      // 2 s of source at 2x is 1 s of timeline; the right edge stays at 4 + 10/2 = 9 s.
      expect(clips(), [
        [clipId, 5000000, 2000000, 10000000],
      ]);
    });

    test('rounds a negative shift with halves going up, like every SDK', () {
      // At 2x, revealing 3 µs of head moves the start by -1.5 µs, which rounds to -1.
      editor.dispatch(ClipTrim(clipId, sourceInUs: 1000003));
      editor.dispatch(ClipMove(clipId, startUs: 1000000));
      editor.dispatch(ClipSetSpeed(clipId, 2));
      editor.dispatch(ClipTrim(clipId, sourceInUs: 1000000));
      expect(editor.project.tracks[0].clips[0].startUs, 999999);
    });

    test('refuses to move a clip before 0', () {
      // Starts at 1 s showing source from 5 s: revealing 5 s of head would start it at -4 s.
      editor.dispatch(ClipTrim(clipId, sourceInUs: 5000000));
      editor.dispatch(ClipMove(clipId, startUs: 1000000));
      expect(codeOf(() => editor.dispatch(ClipTrim(clipId, sourceInUs: 0))), 'INVALID_RANGE');
    });

    test('refuses to grow into the next clip', () {
      editor.dispatch(const ClipAdd('ast_v', sourceOutUs: 1000000));
      expect(codeOf(() => editor.dispatch(ClipTrim(clipId, sourceOutUs: 12000000))), 'OVERLAP');
    });

    test('refuses ranges past the asset', () {
      expect(codeOf(() => editor.dispatch(ClipTrim(clipId, sourceOutUs: 21000000))), 'INVALID_RANGE');
    });
  });

  group('clip.move', () {
    test('moves within a track and keeps it sorted', () {
      final b = editor.dispatch(const ClipAdd('ast_v', sourceOutUs: 2000000)).clipId;
      editor.dispatch(ClipMove(clipId, startUs: 20000000));
      expect([for (final c in clips()) c[0]], [b, clipId]);
      expect(editor.durationUs, 30000000);
    });

    test('moves to another track of the same kind', () {
      final t = editor.dispatch(const TrackAdd(TrackKind.video)).trackId;
      editor.dispatch(ClipMove(clipId, startUs: 1000000, trackId: t));
      expect(editor.project.tracks[0].clips, isEmpty);
      expect(clips(1), [
        [clipId, 1000000, 0, 10000000],
      ]);
    });

    test('refuses the wrong track kind, overlaps and bad times', () {
      final t = editor.dispatch(const TrackAdd(TrackKind.audio)).trackId;
      expect(codeOf(() => editor.dispatch(ClipMove(clipId, startUs: 0, trackId: t))), 'TRACK_KIND_MISMATCH');
      expect(codeOf(() => editor.dispatch(ClipMove(clipId, startUs: 0, trackId: 'nope'))), 'TRACK_NOT_FOUND');
      editor.dispatch(const ClipAdd('ast_v', sourceOutUs: 2000000));
      expect(codeOf(() => editor.dispatch(ClipMove(clipId, startUs: 5000000))), 'OVERLAP');
      expect(codeOf(() => editor.dispatch(ClipMove(clipId, startUs: -1))), 'INVALID_RANGE');
    });

    test('moving onto its own track id is a plain move', () {
      editor.dispatch(ClipMove(clipId, startUs: 2000000, trackId: trackId));
      expect(clips(), [
        [clipId, 2000000, 0, 10000000],
      ]);
    });
  });

  group('clip.reorder', () {
    test('reorders magnetically with no gaps', () {
      final b = editor.dispatch(const ClipAdd('ast_v', sourceOutUs: 3000000)).clipId;
      editor.dispatch(ClipReorder(b, index: 0));
      expect(clips(), [
        [b, 0, 0, 3000000],
        [clipId, 3000000, 0, 10000000],
      ]);
    });

    test('clamps the index and closes gaps', () {
      final b = editor.dispatch(const ClipAdd('ast_v', startUs: 15000000, sourceOutUs: 2000000)).clipId;
      editor.dispatch(ClipReorder(clipId, index: 99));
      expect(clips(), [
        [b, 0, 0, 2000000],
        [clipId, 2000000, 0, 10000000],
      ]);
      editor.dispatch(ClipReorder(clipId, index: -5));
      expect([for (final c in clips()) c[0]], [clipId, b]);
    });
  });

  group('clip.setVolume, clip.setSpeed, clip.setFade', () {
    test('accepts the edges of each range and refuses outside them', () {
      editor.dispatch(ClipSetVolume(clipId, 0));
      editor.dispatch(ClipSetVolume(clipId, 4));
      expect(codeOf(() => editor.dispatch(ClipSetVolume(clipId, 4.01))), 'INVALID_RANGE');
      expect(codeOf(() => editor.dispatch(ClipSetVolume(clipId, double.nan))), 'INVALID_RANGE');
      editor.dispatch(ClipSetSpeed(clipId, 16));
      editor.dispatch(ClipSetSpeed(clipId, 0.1));
      expect(codeOf(() => editor.dispatch(ClipSetSpeed(clipId, 0.09))), 'INVALID_RANGE');
      expect(codeOf(() => editor.dispatch(ClipSetSpeed(clipId, 17))), 'INVALID_RANGE');
    });

    test('slowing down a clip into its neighbour is refused', () {
      editor.dispatch(const ClipAdd('ast_v', sourceOutUs: 1000000));
      expect(codeOf(() => editor.dispatch(ClipSetSpeed(clipId, 0.5))), 'OVERLAP');
    });

    test('fades must fit the clip and zero removes them', () {
      editor.dispatch(ClipSetFade(clipId, inUs: 4000000, outUs: 6000000));
      expect(
        [for (final e in editor.project.tracks[0].clips[0].effects) e.toJson()],
        [
          {
            'type': 'core/fade',
            'params': {'inUs': 4000000, 'outUs': 6000000},
          },
        ],
      );
      expect(codeOf(() => editor.dispatch(ClipSetFade(clipId, inUs: 5000000, outUs: 5000001))), 'INVALID_RANGE');
      expect(codeOf(() => editor.dispatch(ClipSetFade(clipId, inUs: -1, outUs: 0))), 'INVALID_RANGE');
      editor.dispatch(ClipSetFade(clipId, inUs: 0, outUs: 0));
      expect(editor.project.tracks[0].clips[0].effects, isEmpty);
    });
  });

  test('commands serialize like the TypeScript SDK', () {
    expect(ClipSplit(clipId, atUs: 5).toJson(), {'type': 'clip.split', 'clipId': clipId, 'atUs': 5});
    expect(const ClipAdd('ast_v').toJson(), {'type': 'clip.add', 'assetId': 'ast_v'});
    expect(const ClipAdd('a', trackId: 't', startUs: 1, sourceInUs: 2, sourceOutUs: 3, clipId: 'c').toJson(), {
      'type': 'clip.add',
      'assetId': 'a',
      'trackId': 't',
      'startUs': 1,
      'sourceInUs': 2,
      'sourceOutUs': 3,
      'clipId': 'c',
    });
    expect(const ClipRemove('c', ripple: true).toJson(), {'type': 'clip.remove', 'clipId': 'c', 'ripple': true});
    expect(const ClipRemove('c').toJson(), {'type': 'clip.remove', 'clipId': 'c'});
    expect(const ClipSetVolume('c', 0.5).toJson(), {'type': 'clip.setVolume', 'clipId': 'c', 'volume': 0.5});
    expect(const ClipSetSpeed('c', 2).toJson(), {'type': 'clip.setSpeed', 'clipId': 'c', 'speed': 2});
    expect(const ClipSetFade('c', inUs: 1, outUs: 2).toJson(), {
      'type': 'clip.setFade',
      'clipId': 'c',
      'inUs': 1,
      'outUs': 2,
    });
    expect(const ClipReorder('c', index: 1).toJson(), {'type': 'clip.reorder', 'clipId': 'c', 'index': 1});
    expect(const ClipTrim('c', sourceInUs: 1, sourceOutUs: 2).toJson(), {
      'type': 'clip.trim',
      'clipId': 'c',
      'sourceInUs': 1,
      'sourceOutUs': 2,
    });
    expect(const ClipMove('c', startUs: 1, trackId: 't').toJson(), {
      'type': 'clip.move',
      'clipId': 'c',
      'startUs': 1,
      'trackId': 't',
    });
    expect(const TrackAdd(TrackKind.video).toJson(), {'type': 'track.add', 'kind': 'video'});
    expect(const TrackSetMuted('t', muted: true).toJson(), {'type': 'track.setMuted', 'trackId': 't', 'muted': true});
    expect(AssetAdd(music()).toJson(), {'type': 'asset.add', 'asset': music().toJson()});
  });
}
