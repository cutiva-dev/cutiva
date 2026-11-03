import 'package:cutiva_core/cutiva_core.dart';
import 'package:test/test.dart';

import 'helpers.dart';

Asset wide() => Asset(
  id: 'ast_w',
  kind: AssetKind.video,
  name: 'w.mp4',
  uri: 'file://w.mp4',
  durationUs: 10000000,
  width: 1920,
  height: 1080,
  hasAudio: true,
);
Asset unsized() => Asset(id: 'ast_u', kind: AssetKind.video, name: 'u.mp4', uri: 'file://u.mp4', durationUs: 10000000);

({Editor editor, String clipId}) setup() {
  final editor = Editor(ids: sequentialIds(), width: 1080, height: 1920);
  for (final a in [wide(), unsized(), music()]) {
    editor.dispatch(AssetAdd(a));
  }
  return (editor: editor, clipId: editor.dispatch(const ClipAdd('ast_w')).clipId);
}

const key0 = ReframeKey(atUs: 0, x: 0, y: 0, h: 1);
Map<String, Object?>? cropAtStart(Editor e, [int t = 0]) => resolveVideoAt(e.project, t).first.crop?.toJson();

FaceObservation face(double cx, [double mouth = 0, double size = 200]) =>
    FaceObservation(x: cx - size / 2, y: 300, w: size, h: size, mouth: mouth);

/// [n] frames 200 ms apart, built by [fn].
List<FrameObservation> frames(int n, FrameObservation Function(int i, int atUs) fn) => [
  for (var i = 0; i < n; i++) fn(i, i * 200000),
];

AutoReframeResult run(
  List<FrameObservation> frames, {
  required int durationUs,
  List<int> cuts = const [],
  double zoom = 1,
  int minHoldUs = 1500000,
}) => autoReframe(
  sourceWidth: 1920,
  sourceHeight: 1080,
  outputWidth: 1080,
  outputHeight: 1920,
  durationUs: durationUs,
  frames: frames,
  cuts: cuts,
  zoom: zoom,
  minHoldUs: minHoldUs,
);

void main() {
  group('reframe keys', () {
    test('validates and copies keys', () {
      expect(
        [
          for (final k in normalizeReframeKeys([
            {'atUs': 0, 'x': 1, 'y': 2, 'h': 3, 'cut': false},
            const ReframeKey(atUs: 5, x: 1, y: 2, h: 3, cut: true),
          ]))
            k.toJson(),
        ],
        [
          {'atUs': 0, 'x': 1, 'y': 2, 'h': 3},
          {'atUs': 5, 'x': 1, 'y': 2, 'h': 3, 'cut': true},
        ],
      );
      for (final bad in <Object?>[
        'nope',
        [null],
        [
          {'atUs': 0.5, 'x': 0, 'y': 0, 'h': 1},
        ],
        [
          {'atUs': 0, 'x': -1, 'y': 0, 'h': 1},
        ],
        [
          {'atUs': 0, 'x': 0, 'y': 0, 'h': 0},
        ],
        [
          {'atUs': 0, 'x': 0, 'y': 0, 'h': 1, 'cut': 'yes'},
        ],
        [key0, key0],
      ]) {
        expect(codeOf(() => normalizeReframeKeys(bad)), 'INVALID_RANGE', reason: '$bad');
      }
    });

    test('fits the window inside narrow sources', () {
      expect(cropRect(const ReframeKey(atUs: 0, x: 50, y: 500, h: 1000), 100, 1000, 1920, 1080).toJson(), {
        'x': 0,
        'y': 472,
        'w': 100,
        'h': 56,
      });
    });

    test('uses the first key before it starts', () {
      expect(cropAt([const CropKey(1000, CropRect(1, 2, 3, 4), cut: false)], 0).toJson(), {
        'x': 1,
        'y': 2,
        'w': 3,
        'h': 4,
      });
    });

    test('needs the asset size', () {
      final clip = Clip(
        id: 'c',
        assetId: 'ast_u',
        startUs: 0,
        sourceInUs: 0,
        sourceOutUs: 1000,
        effects: [
          Effect(
            type: reframeEffect,
            params: {
              'keys': [key0.toJson()],
            },
          ),
        ],
      );
      expect(clipCropKeys(clip, unsized(), defaultSettings()), isNull);
      clip.effects.first.params['keys'] = <Object?>[];
      expect(reframeKeys(clip), isNull);
    });
  });

  group('ClipSetReframe and ProjectSetSize', () {
    test('sets, replaces and removes the reframe as undoable steps', () {
      final (:editor, :clipId) = setup();
      editor.dispatch(ClipSetReframe(clipId, const [ReframeKey(atUs: 0, x: 480, y: 540, h: 1080)]));
      expect(cropAtStart(editor), {'x': 176, 'y': 0, 'w': 608, 'h': 1080});
      editor.dispatch(ClipSetReframe(clipId, const [ReframeKey(atUs: 0, x: 1440, y: 540, h: 1080)]));
      expect(editor.project.tracks[0].clips[0].effects.where((e) => e.type == reframeEffect), hasLength(1));
      editor.dispatch(ClipSetReframe(clipId, const []));
      expect(cropAtStart(editor), isNull);
      expect(renderPlan(editor.project).video[0].crop, isNull);
      editor.undo();
      expect(cropAtStart(editor)!['x'], 1136);
      expect(ClipSetReframe(clipId, const [key0]).toJson(), {
        'type': 'clip.setReframe',
        'clipId': clipId,
        'keys': [key0.toJson()],
      });
    });

    test('keeps the framing on both halves of a split, because keys use source time', () {
      final (:editor, :clipId) = setup();
      editor.dispatch(
        ClipSetReframe(clipId, const [
          ReframeKey(atUs: 0, x: 480, y: 540, h: 1080),
          ReframeKey(atUs: 5000000, x: 1440, y: 540, h: 1080, cut: true),
        ]),
      );
      editor.dispatch(ClipSplit(clipId, atUs: 4000000));
      expect(cropAtStart(editor, 4500000)!['x'], 176);
      expect(cropAtStart(editor, 6000000)!['x'], 1136);
      expect([for (final v in renderPlan(editor.project).video) v.crop!.length], [2, 2]);
      editor.dispatch(ClipSplit(editor.project.tracks[0].clips[1].id, atUs: 7000000));
      expect(
        [for (final k in renderPlan(editor.project).video[2].crop!) k.toJson()],
        [
          {
            'atUs': 5000000,
            'rect': {'x': 1136, 'y': 0, 'w': 608, 'h': 1080},
            'cut': true,
          },
        ],
      );
    });

    test('rejects audio clips, unsized assets and bad keys', () {
      final (:editor, :clipId) = setup();
      final audio = editor.dispatch(const ClipAdd('ast_a')).clipId;
      final plain = editor.dispatch(const ClipAdd('ast_u')).clipId;
      expect(codeOf(() => editor.dispatch(ClipSetReframe(audio, const [key0]))), 'TRACK_KIND_MISMATCH');
      expect(codeOf(() => editor.dispatch(ClipSetReframe(plain, const [key0]))), 'ASSET_SIZE_UNKNOWN');
      expect(codeOf(() => editor.dispatch(ClipSetReframe(plain, const []))), 'NONE');
      expect(
        codeOf(() => editor.dispatch(ClipSetReframe(clipId, const [ReframeKey(atUs: 0, x: 0, y: 0, h: 0)]))),
        'INVALID_RANGE',
      );
      expect(codeOf(() => editor.dispatch(const ClipSetReframe('nope', []))), 'CLIP_NOT_FOUND');
    });

    test('changes the output size, which reshapes the window', () {
      final (:editor, :clipId) = setup();
      editor.dispatch(ClipSetReframe(clipId, const [ReframeKey(atUs: 0, x: 960, y: 540, h: 1080)]));
      editor.dispatch(const ProjectSetSize(width: 1080, height: 1080));
      expect(editor.project.settings.width, 1080);
      expect(editor.project.settings.height, 1080);
      expect(cropAtStart(editor), {'x': 420, 'y': 0, 'w': 1080, 'h': 1080});
      expect(const ProjectSetSize(width: 4, height: 2).toJson(), {'type': 'project.setSize', 'width': 4, 'height': 2});
      expect(codeOf(() => editor.dispatch(const ProjectSetSize(width: 1, height: 100))), 'INVALID_RANGE');
    });

    test('parses reframes and rejects broken ones', () {
      final (:editor, :clipId) = setup();
      editor.dispatch(ClipSetReframe(clipId, const [ReframeKey(atUs: 0, x: 480, y: 540, h: 1080, cut: true)]));
      final json = editor.project.toJson();
      expect(parseProject(json).toJson(), json);

      final broken = parseProject(json).toJson();
      final clip = ((broken['tracks'] as List).first['clips'] as List).first as Map<String, Object?>;
      ((clip['effects'] as List).first as Map)['params'] = {
        'keys': [
          {'atUs': -1, 'x': 0, 'y': 0, 'h': 1},
        ],
      };
      expect(codeOf(() => parseProject(broken)), 'INVALID_PROJECT');

      final onAudio = parseProject(json).toJson();
      (onAudio['tracks'] as List).add({
        'id': 'ta',
        'kind': 'audio',
        'muted': false,
        'clips': [
          {
            'id': 'ca',
            'assetId': 'ast_a',
            'startUs': 0,
            'sourceInUs': 0,
            'sourceOutUs': 1000,
            'effects': [
              {
                'type': 'core/reframe',
                'params': {'keys': <Object?>[]},
              },
            ],
          },
        ],
      });
      expect(codeOf(() => parseProject(onAudio)), 'INVALID_PROJECT');
    });
  });

  group('autoReframe', () {
    test('validates its input', () {
      AutoReframeResult call({
        int w = 1920,
        int d = 1000000,
        double zoom = 1,
        int hold = 0,
        List<int> cuts = const [],
      }) => autoReframe(
        sourceWidth: w,
        sourceHeight: 1080,
        outputWidth: 1080,
        outputHeight: 1920,
        durationUs: d,
        frames: const [],
        zoom: zoom,
        minHoldUs: hold,
        cuts: cuts,
      );
      expect(codeOf(() => call(w: 0)), 'INVALID_RANGE');
      expect(codeOf(() => call(d: 0)), 'INVALID_RANGE');
      expect(codeOf(() => call(zoom: 0.5)), 'INVALID_RANGE');
      expect(codeOf(() => call(hold: -1)), 'INVALID_RANGE');
      expect(codeOf(() => call(cuts: [-1])), 'INVALID_RANGE');
      expect(
        codeOf(
          () => run(const [FrameObservation(atUs: 5, faces: []), FrameObservation(atUs: 5, faces: [])], durationUs: 10),
        ),
        'INVALID_RANGE',
      );
    });

    test('centres shots without faces and starts each shot with a cut', () {
      final result = run(
        frames(20, (i, t) => FrameObservation(atUs: t, faces: i < 10 ? [] : [face(1440)])),
        durationUs: 4000000,
        cuts: [2000000, 2000000, 0, 9000000],
      );
      expect(result.shotStartsUs, [0, 2000000]);
      expect(
        [for (final k in result.keys) k.toJson()],
        [
          {'atUs': 0, 'x': 960, 'y': 540, 'h': 1080, 'cut': true},
          {'atUs': 2000000, 'x': 1440, 'y': 562, 'h': 1080, 'cut': true},
        ],
      );
      expect([for (final p in result.people) (p.id, p.speakingUs)], [('s1p0', 2000000)]);
    });

    test('holds the speaker through short interruptions and silence', () {
      double talking(int i, int from, int to) => i >= from && i < to ? (i % 2).toDouble() : 0;
      final result = run(
        frames(
          40,
          (i, t) => FrameObservation(
            atUs: t,
            faces: [
              face(480, i < 10 || (i >= 12 && i < 25) ? (i % 2).toDouble() : 0),
              face(1440, talking(i, 10, 12) + talking(i, 25, 40)),
            ],
            voice: i >= 25 ? 0 : 1,
          ),
        ),
        durationUs: 8000000,
      );
      expect(
        [for (final k in result.keys) k.toJson()],
        [
          {'atUs': 0, 'x': 480, 'y': 562, 'h': 1080, 'cut': true},
        ],
      );
      expect([for (final p in result.people) p.speakingUs], [8000000, 0]);
    });

    test('folds a short first run into the next one', () {
      final result = run(
        frames(
          20,
          (i, t) => FrameObservation(
            atUs: t,
            faces: [face(480, i < 3 ? (i % 2).toDouble() : 0), face(1440, i >= 3 ? (i % 2).toDouble() : 0)],
          ),
        ),
        durationUs: 4000000,
      );
      expect(
        [for (final k in result.keys) k.toJson()],
        [
          {'atUs': 0, 'x': 1440, 'y': 562, 'h': 1080, 'cut': true},
        ],
      );
    });

    test('frames the most visible person when nobody talks, and zooms in', () {
      final result = run(
        frames(10, (i, t) => FrameObservation(atUs: t, faces: [face(480, 0, 100), face(1440, 0, 300)])),
        durationUs: 2000000,
        zoom: 2,
      );
      expect(
        [for (final k in result.keys) k.toJson()],
        [
          {'atUs': 0, 'x': 1440, 'y': 531, 'h': 540, 'cut': true},
        ],
      );
    });

    test('keeps the longest track when every face is brief', () {
      final result = run(
        frames(
          20,
          (i, t) => FrameObservation(
            atUs: t,
            faces:
                i == 3
                    ? [face(480)]
                    : i == 8 || i == 9
                    ? [face(1440)]
                    : [],
          ),
        ),
        durationUs: 4000000,
      );
      expect([for (final p in result.people) p.faceAtUs], [1600000]);
      expect(result.keys.first.x, 1440);
    });

    test('finds a speaker who is out of sight when their run starts', () {
      final result = run(
        frames(
          30,
          (i, t) => FrameObservation(
            atUs: t,
            faces: [
              face(480, i < 10 ? (i % 2).toDouble() : 0),
              if (i < 3 || i >= 16) face(1440, i >= 16 ? (i % 2).toDouble() : 0),
            ],
          ),
        ),
        durationUs: 6000000,
        minHoldUs: 0,
      );
      expect([for (final k in result.keys) (k.x, k.cut)], [(480, true), (1440, true)]);
    });
  });

  test('detectCuts handles empty input, blank frames and mismatched bins', () {
    expect(detectCuts(const []), isEmpty);
    expect(
      detectCuts(const [
        FrameHistogram(0, [0, 0]),
        FrameHistogram(2000000, [0, 0]),
      ]),
      isEmpty,
    );
    expect(
      detectCuts(
        const [
          FrameHistogram(0, [1, 0]),
          FrameHistogram(100, [0, 1]),
        ],
        minShotUs: 0,
        threshold: 1,
      ),
      [100],
    );
    expect(
      codeOf(
        () => detectCuts(const [
          FrameHistogram(0, [1]),
          FrameHistogram(1, [1, 2]),
        ]),
      ),
      'INVALID_RANGE',
    );
  });
}
