import 'dart:convert';

import 'package:cutiva_core/cutiva_core.dart';
import 'package:test/test.dart';

import 'helpers.dart';

void main() {
  ({Editor editor, String clipId}) setup({int historyLimit = 200}) {
    final editor = Editor(ids: sequentialIds(), historyLimit: historyLimit);
    editor.dispatch(AssetAdd(video()));
    editor.dispatch(AssetAdd(music()));
    return (editor: editor, clipId: editor.dispatch(const ClipAdd('ast_v')).clipId);
  }

  group('editor', () {
    test('starts empty and reports what it can undo', () {
      final editor = Editor(ids: sequentialIds(), width: 1280, height: 720);
      expect(editor.project.settings.toJson(), {
        'width': 1280,
        'height': 720,
        'fps': {'num': 30, 'den': 1},
        'sampleRate': 48000,
      });
      expect(editor.canUndo, isFalse);
      expect(editor.undo(), isFalse);
      expect(editor.redo(), isFalse);
      expect(editor.durationUs, 0);
      editor.dispatch(AssetAdd(video()));
      expect(editor.canUndo, isTrue);
    });

    test('undo and redo restore exact states', () {
      final (:editor, :clipId) = setup();
      final before = editor.project;
      editor.dispatch(ClipSplit(clipId, atUs: 5000000));
      final after = editor.project;
      expect(editor.undo(), isTrue);
      expect(identical(editor.project, before), isTrue);
      expect(editor.redo(), isTrue);
      expect(identical(editor.project, after), isTrue);
    });

    test('a new edit clears the redo stack', () {
      final (:editor, :clipId) = setup();
      editor.dispatch(ClipSplit(clipId, atUs: 5000000));
      editor.undo();
      editor.dispatch(ClipSetVolume(clipId, 0.5));
      expect(editor.canRedo, isFalse);
    });

    test('batch is one undo step and atomic', () {
      final (:editor, :clipId) = setup();
      final before = editor.project;
      expect(() => editor.batch([ClipSetVolume(clipId, 0.2), ClipSplit(clipId, atUs: 0)]), throwsA(isA<CutivaError>()));
      expect(identical(editor.project, before), isTrue);
      expect(editor.project.tracks[0].clips[0].volume, 1);
      editor.batch([ClipSetVolume(clipId, 0.2), ClipSplit(clipId, atUs: 10000000)]);
      expect(editor.project.tracks[0].clips, hasLength(2));
      editor.undo();
      expect(identical(editor.project, before), isTrue);
    });

    test('an empty batch changes nothing', () {
      final (:editor, clipId: _) = setup();
      final before = editor.project;
      editor.batch([]);
      expect(identical(editor.project, before), isTrue);
    });

    test('keeps at most historyLimit undo steps', () {
      final (:editor, :clipId) = setup(historyLimit: 2);
      for (final volume in [0.1, 0.2, 0.3]) {
        editor.dispatch(ClipSetVolume(clipId, volume));
      }
      expect(editor.undo(), isTrue);
      expect(editor.undo(), isTrue);
      expect(editor.undo(), isFalse);
      expect(editor.project.tracks[0].clips[0].volume, 0.1);
    });

    test('notifies listeners synchronously, and stops after cancel', () async {
      final (:editor, :clipId) = setup();
      final heard = <String>[];
      final sub = editor.changes.listen((c) => heard.add(c.command?.type ?? c.cause.name));
      editor.dispatch(ClipSetVolume(clipId, 0.5));
      editor.undo();
      editor.redo();
      editor.batch([ClipSetVolume(clipId, 0.1), ClipSetFade(clipId, inUs: 1, outUs: 0)]);
      expect(heard, ['clip.setVolume', 'undo', 'redo', 'clip.setFade']);
      await sub.cancel();
      editor.dispatch(ClipSetVolume(clipId, 0.6));
      expect(heard, hasLength(4));
      await editor.dispose();
    });

    test('opens an existing project from JSON, a map or a Project', () {
      final (:editor, :clipId) = setup();
      editor.dispatch(ClipSplit(clipId, atUs: 5000000));
      editor.dispatch(const ClipAdd('ast_a', sourceOutUs: 10000000));
      editor.dispatch(ClipSetFade(clipId, inUs: 1000, outUs: 0));
      for (final input in [jsonEncode(editor.toJson()), editor.toJson(), editor.project]) {
        final reopened = Editor(project: input);
        expect(reopened.toJson(), editor.toJson());
        expect(reopened.canUndo, isFalse);
      }
    });

    test('load replaces the project, clears history and notifies', () {
      final (:editor, clipId: _) = setup();
      final other = Editor(ids: sequentialIds(), width: 640, height: 360).toJson();
      final causes = <ChangeCause>[];
      editor.changes.listen((c) => causes.add(c.cause));
      editor.load(jsonEncode(other));
      expect(editor.project.settings.width, 640);
      expect(editor.canUndo, isFalse);
      expect(editor.canRedo, isFalse);
      expect(causes, [ChangeCause.load]);
    });

    test('a failed load keeps the current project', () {
      final (:editor, clipId: _) = setup();
      final before = editor.project;
      expect(() => editor.load({'version': '0.1.0'}), throwsA(isA<CutivaError>()));
      expect(identical(editor.project, before), isTrue);
    });

    test('toJson returns a copy', () {
      final (:editor, clipId: _) = setup();
      final copy = editor.toJson();
      ((copy['tracks'] as List<Object?>)[0] as Map<String, Object?>)['muted'] = true;
      expect(editor.project.tracks[0].muted, isFalse);
    });
  });

  group('resolve', () {
    test('returns the source time to draw at a timeline time', () {
      final (:editor, :clipId) = setup();
      editor.dispatch(ClipTrim(clipId, sourceInUs: 2000000));
      final layers = resolveVideoAt(editor.project, 5000000);
      expect(layers, hasLength(1));
      expect(layers[0].sourceTimeUs, 5000000);
      expect(layers[0].asset.id, 'ast_v');
      expect(layers[0].track.id, 'trk_1');
      expect(resolveVideoAt(editor.project, 1000000), isEmpty);
    });

    test('lists audio from audio tracks and video clips, skipping muted tracks', () {
      final (:editor, :clipId) = setup();
      final trackId = editor.dispatch(const ClipAdd('ast_a', sourceOutUs: 10000000)).trackId;
      editor.dispatch(ClipSetFade(clipId, inUs: 500000, outUs: 1000000));
      expect(audioSegments(editor.project), hasLength(2));
      expect(audioSegments(editor.project)[0].fadeOutUs, 1000000);
      editor.dispatch(TrackSetMuted(trackId, muted: true));
      expect(audioSegments(editor.project), hasLength(1));
    });

    test('skips clips whose asset is missing, silent video and zero volume', () {
      final (:editor, :clipId) = setup();
      expect(audioSegments(editor.project), hasLength(1));

      final silent = editor.project.copy();
      silent.assets[0].hasAudio = false;
      expect(audioSegments(silent), isEmpty);
      expect(resolveVideoAt(silent, 0), hasLength(1));

      final orphan = editor.project.copy()..assets.clear();
      expect(audioSegments(orphan), isEmpty);
      expect(resolveVideoAt(orphan, 0), isEmpty);

      editor.dispatch(ClipSetVolume(clipId, 0));
      expect(audioSegments(editor.project), isEmpty);
    });

    test('treats fades with non-numeric params as no fade', () {
      final (:editor, clipId: _) = setup();
      final project = editor.project.copy();
      project.tracks[0].clips[0].effects = [
        Effect(type: 'core/fade', params: {'inUs': '1s'}),
      ];
      expect(audioSegments(project)[0].fadeInUs, 0);
      expect(audioSegments(project)[0].fadeOutUs, 0);
    });
  });
}
