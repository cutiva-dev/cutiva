import 'dart:convert';

import 'package:cutiva_core/cutiva_core.dart';
import 'package:test/test.dart';

import 'helpers.dart';

// The Dart side of packages/core/test/reframe-plan.test.ts and the track tests in reframe.test.ts.

const _step = 200000;
double _talk(int i) => i.isOdd ? 0.3 : 0.1;
PlanFace _face(double x, double? mouth, {double y = 300, double w = 200, double h = 200, double? conf}) =>
    PlanFace(x: x, y: y, w: w, h: h, mouth: mouth, conf: conf);
List<PlanFrame> _frames(int count, ({List<PlanFace> faces, double? voice, double? pan}) Function(int i) make) => [
  for (var i = 0; i < count; i++)
    PlanFrame(atUs: i * _step, faces: make(i).faces, voice: make(i).voice, pan: make(i).pan),
];
ReframePlanResult _plan(
  List<PlanFrame> frames, {
  int srcW = 1920,
  int srcH = 1080,
  int outW = 1080,
  int outH = 1920,
  int? durationUs,
  List<int> cuts = const [],
  CropRect? area,
  ReframeTrack? track,
}) => planReframe(
  sourceWidth: srcW,
  sourceHeight: srcH,
  outputWidth: outW,
  outputHeight: outH,
  durationUs: durationUs ?? frames.length * _step,
  frames: frames,
  cuts: cuts,
  activeArea: area,
  track: track,
);
List<List<Object?>> _brief(List<TrackSegment> s) => [
  for (final x in s) [x.startUs, x.endUs, x.speakers.join('+'), x.resolved, x.reason],
];
TrackPerson _person(String id, {String kind = 'face', bool priority = false, bool neverFocus = false}) =>
    TrackPerson(id: id, label: id.toUpperCase(), kind: kind, priority: priority, neverFocus: neverFocus);
TrackSegment _locked(
  String id,
  int startUs,
  int endUs, {
  String resolved = 'single',
  List<String> focus = const [],
  ReframeWindow? window,
}) => TrackSegment(
  id: id,
  startUs: startUs,
  endUs: endUs,
  speakers: ['p1'],
  layout: resolved,
  focus: [...focus],
  resolved: resolved,
  locked: true,
  reason: 'user',
  window: window,
);
const _a = 400.0;
const _b = 1300.0;

void main() {
  test('reframeStyle gives the presets and interpolates', () {
    final calm = reframeStyle(0);
    expect(
      [calm.holdUs, calm.minSegmentUs, calm.deadZone, calm.minCutoff, calm.maxSpeed],
      [1600000, 1500000, 0.06, 0.3, 0.15],
    );
    final dynamic = reframeStyle(100);
    expect([dynamic.holdUs, dynamic.minSegmentUs, dynamic.maxSpeed], [400000, 600000, 0.4]);
    expect(reframeStyle(25).holdUs, 1300000);
    expect(reframeStyle(75).holdUs, 700000);
  });

  test('planReframe refuses bad input', () {
    final ok = _frames(2, (_) => (faces: [], voice: null, pan: null));
    expect(codeOf(() => _plan(ok, srcW: 0)), 'INVALID_RANGE');
    expect(codeOf(() => _plan(ok, durationUs: 0)), 'INVALID_RANGE');
    expect(
      codeOf(() => _plan([const PlanFrame(atUs: 5, faces: []), const PlanFrame(atUs: 5, faces: [])])),
      'INVALID_RANGE',
    );
    expect(codeOf(() => _plan([const PlanFrame(atUs: 0, faces: [], voice: 2)])), 'INVALID_RANGE');
    expect(codeOf(() => _plan([const PlanFrame(atUs: 0, faces: [], pan: -3)])), 'INVALID_RANGE');
    expect(
      codeOf(
        () => _plan([
          PlanFrame(atUs: 0, faces: [_face(0, 0, w: 0)]),
        ]),
      ),
      'INVALID_RANGE',
    );
    expect(
      codeOf(
        () => _plan([
          PlanFrame(atUs: 0, faces: [_face(0, 7)]),
        ]),
      ),
      'INVALID_RANGE',
    );
    expect(
      codeOf(
        () => _plan([
          PlanFrame(atUs: 0, faces: [_face(0, 0, conf: 9)]),
        ]),
      ),
      'INVALID_RANGE',
    );
    expect(codeOf(() => _plan(ok, cuts: [-1])), 'INVALID_RANGE');
    expect(codeOf(() => _plan(ok, area: const CropRect(1000, 0, 1000, 1080))), 'INVALID_RANGE');
    final none = _plan([], durationUs: 1000000);
    expect(_brief(none.track.segments), [
      [0, 1000000, '', 'wide', 'no-face'],
    ]);
  });

  test('lips without voice keep the framing; before anyone talks, the first speaker holds', () {
    final laugh = _frames(
      20,
      (i) => (
        voice: i < 10 ? 0.5 : 0,
        pan: null,
        faces: [_face(_a, i < 10 ? _talk(i) : 0.1), _face(_b, i >= 10 ? _talk(i) : 0.1)],
      ),
    );
    expect(_brief(_plan(laugh).track.segments), [
      [0, 4000000, 'p1', 'single', 'lips+voice'],
    ]);
    final late = _frames(
      20,
      (i) => (voice: i < 10 ? 0 : 0.5, pan: null, faces: [_face(_a, 0.1), _face(_b, i >= 10 ? _talk(i) : 0.1)]),
    );
    expect(_brief(_plan(late).track.segments), [
      [0, 4000000, 'p2', 'single', 'lips+voice'],
    ]);
  });

  test('voice gaps under 300 ms fill and bursts under 250 ms drop', () {
    double voice(int i) => i == 5 ? 0 : (i < 10 ? 0.5 : (i == 15 ? 0.5 : 0));
    final fs = _frames(
      20,
      (i) => (voice: voice(i), pan: null, faces: [_face(_a, i < 10 ? _talk(i) : 0.1), _face(_b, i == 15 ? 0.3 : 0.1)]),
    );
    expect(_brief(_plan(fs).track.segments), [
      [0, 4000000, 'p1', 'single', 'lips+voice'],
    ]);
  });

  test('without audio, lips decide; with nothing to go on, the most visible person holds', () {
    final fs = _frames(
      20,
      (i) => (voice: null, pan: null, faces: [_face(_a, i < 10 ? _talk(i) : 0.1), _face(_b, i >= 10 ? _talk(i) : 0.1)]),
    );
    expect(_brief(_plan(fs).track.segments), [
      [0, 2200000, 'p1', 'single', 'lips+voice'],
      [2200000, 4000000, 'p2', 'single', 'lips+voice'],
    ]);
    final still = _frames(10, (_) => (voice: 0, pan: null, faces: [_face(_a, 0.1, w: 150, h: 150), _face(_b, 0.1)]));
    expect(_brief(_plan(still).track.segments), [
      [0, 2000000, 'p2', 'single', 'lips+voice'],
    ]);
  });

  test('covered mouths: continuity keeps the speaker, stereo pan can move it', () {
    final covered = _frames(
      20,
      (i) => (voice: 0.5, pan: null, faces: [_face(_a, i < 3 ? _talk(i) : null), _face(_b, null)]),
    );
    expect(_brief(_plan(covered).track.segments), [
      [0, 4000000, 'p1', 'single', 'lips+voice'],
    ]);
    final panned = _frames(
      30,
      (i) => (voice: 0.5, pan: i < 10 ? -0.6 : 0.6, faces: [_face(_a, null), _face(_b, null)]),
    );
    expect(_brief(_plan(panned).track.segments), [
      [0, 2000000, 'p1', 'single', 'lips+voice'],
      [2000000, 6000000, 'p2', 'single', 'lips+voice'],
    ]);
  });

  test('short interruptions fold back; crowds keep four people', () {
    bool bTalks(int i) => i >= 10 && i < 13;
    final fs = _frames(
      25,
      (i) => (
        voice: 0.5,
        pan: null,
        faces: [_face(_a, bTalks(i) ? 0.1 : _talk(i)), _face(_b, bTalks(i) ? _talk(i) : 0.1)],
      ),
    );
    expect(_brief(_plan(fs, track: ReframeTrack(style: 100)).track.segments), [
      [0, 5000000, 'p1', 'single', 'lips+voice'],
    ]);
    final crowd = _frames(
      10,
      (i) => (
        voice: 0.5,
        pan: null,
        faces: [
          _face(100, _talk(i)),
          _face(500, 0.1),
          _face(900, 0.1),
          _face(1300, 0.1),
          _face(1700, 0.1, w: 150, h: 150),
          _face(800, 0.3, y: 900, w: 30, h: 30),
          _face(1500, 0.3, conf: 0.4),
        ],
      ),
    );
    expect(_plan(crowd).track.people.map((p) => p.id), ['p1', 'p2', 'p3', 'p4']);
  });

  test('people who leave come back new; missed detections interpolate', () {
    final away = _frames(
      30,
      (i) => (voice: 0.5, pan: null, faces: i >= 10 && i < 17 ? <PlanFace>[] : [_face(_a, _talk(i))]),
    );
    final r = _plan(away);
    expect(r.track.people.map((p) => p.id), ['p1', 'p2']);
    expect(_brief(r.track.segments), [
      [0, 2000000, 'p1', 'single', 'lips+voice'],
      [2000000, 3400000, '', 'wide', 'no-face'],
      [3400000, 6000000, 'p2', 'single', 'lips+voice'],
    ]);
    final gap = _frames(
      15,
      (i) => (
        voice: 0.5,
        pan: null,
        faces: i >= 5 && i < 9 ? <PlanFace>[] : [_face(i < 5 ? 400 : 520, _talk(i), w: 600, h: 600)],
      ),
    );
    final g = _plan(gap);
    expect(g.track.people, hasLength(1));
    expect(g.keys.first.x, 700);
    expect(g.keys.last.x, greaterThan(760));
  });

  test('framing: close pairs share a window, close-ups centre, narrow sources move in y, zoom', () {
    final pair = _frames(20, (i) => (voice: 0.5, pan: null, faces: [_face(700, _talk(i)), _face(1000, _talk(i))]));
    final p = _plan(pair);
    expect(_brief(p.track.segments), [
      [0, 4000000, 'p1+p2', 'single', 'overlap'],
    ]);
    expect(p.keys.first.toJson(), {'atUs': 0, 'x': 950, 'y': 540, 'h': 1080, 'cut': true});
    final close = _frames(10, (i) => (voice: 0.5, pan: null, faces: [_face(560, _talk(i), y: 100, w: 800, h: 800)]));
    expect(_plan(close).keys.first.toJson(), {'atUs': 0, 'x': 960, 'y': 540, 'h': 1080, 'cut': true});
    final tall = _frames(10, (i) => (voice: 0.5, pan: null, faces: [_face(440, _talk(i), y: 200)]));
    expect(_plan(tall, srcW: 1080, srcH: 1920, outW: 1080, outH: 1080).keys.first.toJson(), {
      'atUs': 0,
      'x': 540,
      'y': 610,
      'h': 1080,
      'cut': true,
    });
    final one = _frames(10, (i) => (voice: 0.5, pan: null, faces: [_face(_a, _talk(i))]));
    expect(_plan(one, track: ReframeTrack(zoomPct: 200, maxUpscalePct: 400)).keys.first.toJson(), {
      'atUs': 0,
      'x': 500,
      'y': 505,
      'h': 540,
      'cut': true,
    });
    final vfr = [
      for (final (i, t) in [0, 150000, 420000, 600000, 790000, 1000000, 1230000, 1400000].indexed)
        PlanFrame(atUs: t, voice: 0.5, faces: [_face(_a, _talk(i))]),
    ];
    expect(_brief(_plan(vfr, durationUs: 1600000).track.segments), [
      [0, 1600000, 'p1', 'single', 'lips+voice'],
    ]);
  });

  test('priority, low-quality splits and never-focus', () {
    final both = _frames(
      10,
      (i) => (
        voice: 0.5,
        pan: null,
        faces: [_face(_a, i == 0 ? 0.3 : _talk(i + 1)), _face(_b, i == 0 ? 0.3 : _talk(i + 1))],
      ),
    );
    final people = [_person('p1'), _person('p2', priority: true)];
    expect(_brief(_plan(both, track: ReframeTrack(people: people)).track.segments), [
      [0, 2000000, 'p1+p2', 'split', 'overlap'],
    ]);
    expect(_brief(_plan(both.sublist(0, 7), durationUs: 1400000, track: ReframeTrack(people: people)).track.segments), [
      [0, 1400000, 'p2', 'single', 'lips+voice'],
    ]);
    final tiny = _frames(
      10,
      (i) => (voice: 0.5, pan: null, faces: [_face(_a, _talk(i), w: 60, h: 60), _face(_b, _talk(i), w: 60, h: 60)]),
    );
    expect(_brief(_plan(tiny).track.segments), [
      [0, 2000000, 'p1+p2', 'wide', 'low-quality'],
    ]);
    final closeSmall = _frames(
      10,
      (i) => (
        voice: 0.5,
        pan: null,
        faces: [_face(200, _talk(i), y: 100, w: 60, h: 60), _face(300, _talk(i), y: 100, w: 60, h: 60)],
      ),
    );
    expect(_brief(_plan(closeSmall, srcW: 854, srcH: 480).track.segments), [
      [0, 2000000, 'p1+p2', 'wide', 'low-quality'],
    ]);
    final host = _frames(10, (_) => (voice: 0, pan: null, faces: [_face(_a, 0.1)]));
    expect(_brief(_plan(host, track: ReframeTrack(people: [_person('p1', neverFocus: true)])).track.segments), [
      [0, 2000000, 'p1', 'wide', 'never-focus'],
    ]);
  });

  test('lists where each person was seen, by time then person, with merges applied and noise dropped', () {
    final fs = _frames(
      3,
      (i) => (
        voice: 0.5,
        pan: null,
        faces: [_face(_b, _talk(i)), _face(_a, 0.1), _face(900, 0.1, h: 20), _face(1700, 0.1, conf: 0.2)],
      ),
    );
    final r = _plan(fs);
    List<Object?> box(String id, int atUs, double x) => [id, atUs, x, 300.0, 200.0, 200.0];
    List<List<Object?>> brief(ReframePlanResult r) => [
      for (final s in r.sightings) [s.personId, s.atUs, s.x, s.y, s.w, s.h],
    ];
    expect(brief(r), [
      box('p1', 0, _a),
      box('p2', 0, _b),
      box('p1', _step, _a),
      box('p2', _step, _b),
      box('p1', 2 * _step, _a),
      box('p2', 2 * _step, _b),
    ]);
    expect(r.toJson()['sightings'], hasLength(6));
    final merged = _plan(fs, track: editReframeTrack(r.track, const PersonMerge('p2', 'p1')));
    expect(
      [
        for (final s in merged.sightings) [s.personId, s.atUs, s.x],
      ],
      [
        ['p1', 0, _a],
        ['p1', 0, _b],
        ['p1', _step, _a],
        ['p1', _step, _b],
        ['p1', 2 * _step, _a],
        ['p1', 2 * _step, _b],
      ],
    );
    expect(_plan([], srcW: 1080, srcH: 1920, durationUs: 1000000).sightings, isEmpty);
  });

  test('merged people are one, across a cut', () {
    final fs = _frames(20, (i) => (voice: 0.5, pan: null, faces: [_face(i < 10 ? _a : _b, _talk(i))]));
    final first = _plan(fs, cuts: [2000000]);
    final merged = editReframeTrack(first.track, const PersonMerge('p2', 'p1'));
    final r = _plan(fs, cuts: [2000000], track: merged);
    expect(r.track.people.map((p) => p.toJson()), [
      {
        'id': 'p1',
        'label': 'Speaker A',
        'kind': 'face',
        'priority': false,
        'neverFocus': false,
        'merged': ['p2'],
      },
    ]);
    expect(r.keys.map((k) => k.toJson()), [
      {'atUs': 0, 'x': 500, 'y': 540, 'h': 1080, 'cut': true},
      {'atUs': 2000000, 'x': 1400, 'y': 540, 'h': 1080, 'cut': true},
    ]);
  });

  test('keeps voice ids and people that locked segments name; draws every locked kind', () {
    final quiet = _frames(10, (_) => (voice: 0.5, pan: null, faces: [_face(_a, 0.1)]));
    final keep = ReframeTrack(
      people: [_person('p4', kind: 'voice'), _person('p7')],
      segments: [
        TrackSegment(
          id: 's1',
          startUs: 1000000,
          endUs: 3000000,
          speakers: ['p7'],
          layout: 'wide',
          focus: [],
          resolved: 'wide',
          locked: true,
          reason: 'user',
        ),
      ],
    );
    final r = _plan(quiet, durationUs: 2000000, track: keep);
    expect(r.track.people.map((p) => p.id), ['p1', 'p4', 'p7']);
    expect(_brief(r.track.segments), [
      [0, 1000000, 'p4', 'wide', 'voice-only'],
      [1000000, 2000000, 'p7', 'wide', 'user'],
    ]);

    final fs = _frames(25, (i) => (voice: 0.5, pan: null, faces: [_face(_a, _talk(i)), _face(_b, 0.1)]));
    final kinds = ReframeTrack(
      people: [_person('p1'), _person('p2'), _person('p9')],
      segments: [
        _locked('s1', 0, 1000000, resolved: 'split', focus: ['p1', 'p2']),
        _locked('s2', 1000000, 2000000, window: const ReframeWindow(x: 700, y: 540, h: 1080)),
        _locked('s3', 2000000, 3000000, focus: ['p9']),
        TrackSegment(
          id: 's4',
          startUs: 3000000,
          endUs: 4000000,
          speakers: [],
          layout: 'single',
          focus: [],
          resolved: 'single',
          locked: true,
          reason: 'user',
        ),
        _locked('s5', 4000000, 5000000, resolved: 'split', focus: ['p1', 'p9']),
      ],
    );
    expect(_plan(fs, track: kinds).keys.map((k) => [k.atUs, k.x, k.layout ?? 'single']), [
      [0, 960, 'split'],
      [1000000, 700, 'single'],
      [2000000, 960, 'single'],
      [3000000, 960, 'single'],
      [4000000, 960, 'wide'],
    ]);
    final boxed = _frames(15, (i) => (voice: 0.5, pan: null, faces: [_face(_a, _talk(i))]));
    final walls = ReframeTrack(
      people: [_person('p1')],
      segments: [_locked('s1', 0, 1000000, resolved: 'wide'), _locked('s2', 1400000, 3000000, resolved: 'wide')],
    );
    expect(_brief(_plan(boxed, track: walls).track.segments), [
      [0, 1000000, 'p1', 'wide', 'user'],
      [1000000, 1400000, 'p1', 'single', 'lips+voice'],
      [1400000, 3000000, 'p1', 'wide', 'user'],
    ]);
  });

  test('a silent new shot takes its first speaker, else its most visible person; passthrough keeps people', () {
    final fs = _frames(
      30,
      (i) => (
        voice: (i >= 10 && i < 15) || i >= 20 ? 0 : 0.5,
        pan: null,
        faces:
            i < 10
                ? [_face(_a, _talk(i))]
                : (i < 20 ? [_face(_b, i >= 15 ? _talk(i) : 0.1)] : [_face(_a, 0.1), _face(_b, 0.1, w: 300, h: 300)]),
      ),
    );
    expect(
      _plan(fs, cuts: [2000000, 4000000], track: ReframeTrack(style: 100)).track.segments.map((s) => s.speakers.join()),
      ['p1', 'p2', 'p4'],
    );
    final area = const CropRect(240, 0, 1440, 1080);
    final one = _frames(5, (i) => (voice: 0.5, pan: null, faces: [_face(600, _talk(i))]));
    expect(_plan(one, track: ReframeTrack(activeArea: area)).track.activeArea?.toJson(), area.toJson());
    final people = [
      _person('p1', priority: true)..merged = ['p3'],
    ];
    final pass = _plan([], srcW: 1080, srcH: 1920, durationUs: 1000000, track: ReframeTrack(people: people));
    expect(pass.passthrough, isTrue);
    expect(pass.track.people.map((p) => p.toJson()), people.map((p) => p.toJson()));
  });

  test('follows within the top speed and ignores jitter inside the dead zone', () {
    final fs = _frames(20, (i) => (voice: 0.5, pan: null, faces: [_face(400 + (i < 10 ? i : 10) * 40, _talk(i))]));
    final keys = _plan(fs).keys;
    for (var k = 1; k < keys.length; k++) {
      final dt = (keys[k].atUs - keys[k - 1].atUs) / 1e6;
      expect((keys[k].x - keys[k - 1].x).abs(), lessThanOrEqualTo((0.25 * 608 * dt).ceil() + 1));
    }
    final jitter = _frames(20, (i) => (voice: 0.5, pan: null, faces: [_face(400 + (i % 2) * 10, _talk(i))]));
    expect(_plan(jitter).keys, hasLength(1));
  });

  group('editReframeTrack', () {
    ReframeTrack base() => ReframeTrack(
      people: [
        _person('p1'),
        _person('p2')..merged = ['p5'],
        _person('p3', kind: 'voice'),
      ],
      segments: [
        TrackSegment(
          id: 's1',
          startUs: 0,
          endUs: 1000000,
          speakers: ['p1'],
          layout: 'auto',
          focus: [],
          resolved: 'single',
          locked: false,
          reason: 'lips+voice',
        ),
        TrackSegment(
          id: 's2',
          startUs: 1000000,
          endUs: 2000000,
          speakers: ['p1', 'p2'],
          layout: 'auto',
          focus: [],
          resolved: 'split',
          locked: false,
          reason: 'overlap',
        ),
      ],
    );

    test('locks, resets, renames, merges and changes settings', () {
      final t = base();
      final one = editReframeTrack(t, const SegmentEdit('s1', focus: ['p2']));
      expect(one.segments[0].toJson(), {
        ...t.segments[0].toJson(),
        'layout': 'single',
        'focus': ['p2'],
        'resolved': 'single',
        'locked': true,
        'reason': 'user',
      });
      expect(t.segments[0].locked, isFalse);
      expect(editReframeTrack(t, const SegmentEdit('s1', focus: ['p1', 'p2'])).segments[0].layout, 'split');
      expect(editReframeTrack(t, const SegmentEdit('s2', layout: 'split')).segments[1].resolved, 'split');
      final dragged = editReframeTrack(t, const SegmentEdit('s1', window: ReframeWindow(x: 800, y: 540, h: 1080)));
      expect(dragged.segments[0].window?.toJson(), {'x': 800, 'y': 540, 'h': 1080});
      expect(editReframeTrack(dragged, const SegmentEdit('s1', layout: 'wide')).segments[0].window, isNull);
      expect(editReframeTrack(dragged, const SegmentReset('s1')).segments[0].toJson(), {
        ...t.segments[0].toJson(),
        'reason': 'user',
      });
      final p = editReframeTrack(t, const PersonEdit('p1', label: 'Ana', priority: true, neverFocus: true));
      expect([p.people[0].label, p.people[0].priority, p.people[0].neverFocus], ['Ana', true, true]);
      final m = editReframeTrack(t, const PersonMerge('p2', 'p1'));
      expect(m.people.map((x) => [x.id, x.merged]), [
        [
          'p1',
          ['p2', 'p5'],
        ],
        ['p3', null],
      ]);
      expect(m.segments[1].speakers, ['p1']);
      final s = editReframeTrack(t, const ReframeSettingsEdit(style: 0, maxUpscalePct: 300, zoomPct: 150));
      expect([s.style, s.maxUpscalePct, s.zoomPct], [0, 300, 150]);
    });

    test('refuses what it cannot apply', () {
      final t = base();
      expect(codeOf(() => editReframeTrack(t, const SegmentReset('s9'))), 'SEGMENT_NOT_FOUND');
      expect(codeOf(() => editReframeTrack(t, const PersonEdit('p9'))), 'PERSON_NOT_FOUND');
      for (final edit in <ReframeEdit>[
        const SegmentEdit('s1', focus: ['p3']),
        const SegmentEdit('s1', focus: ['p1', 'p1']),
        const SegmentEdit('s1', layout: 'split'),
        const SegmentEdit('s1', window: ReframeWindow(x: -1, y: 0, h: 10)),
        const PersonEdit('p1', label: ''),
        const PersonMerge('p1', 'p1'),
        const PersonMerge('p3', 'p1'),
        const ReframeSettingsEdit(style: 101),
        const ReframeSettingsEdit(maxUpscalePct: 99),
        const ReframeSettingsEdit(zoomPct: 50),
      ]) {
        expect(codeOf(() => editReframeTrack(t, edit)), 'INVALID_RANGE');
      }
    });
  });

  group('track in the project', () {
    final track = <String, Object?>{
      'version': 1,
      'style': 50,
      'maxUpscalePct': 200,
      'zoomPct': 100,
      'safeZone': 'none',
      'activeArea': {'x': 240, 'y': 0, 'w': 1440, 'h': 1080},
      'people': [
        {
          'id': 'p1',
          'label': 'Ana',
          'kind': 'face',
          'priority': false,
          'neverFocus': false,
          'merged': ['p3'],
        },
        {'id': 'p2', 'label': 'Voice', 'kind': 'voice', 'priority': false, 'neverFocus': false},
      ],
      'segments': [
        {
          'id': 's1',
          'startUs': 0,
          'endUs': 1000000,
          'speakers': ['p1'],
          'layout': 'auto',
          'focus': [],
          'resolved': 'single',
          'locked': false,
          'reason': 'lips+voice',
        },
        {
          'id': 's2',
          'startUs': 1000000,
          'endUs': 2000000,
          'speakers': ['p1'],
          'layout': 'single',
          'focus': ['p1'],
          'resolved': 'single',
          'locked': true,
          'reason': 'user',
          'window': {'x': 700, 'y': 540, 'h': 1080},
        },
      ],
    };
    final keys = [
      {'atUs': 0, 'x': 500, 'y': 540, 'h': 1080, 'cut': true},
      {
        'atUs': 1000000,
        'x': 960,
        'y': 540,
        'h': 1080,
        'cut': true,
        'layout': 'split',
        'regions': [
          {'x': 500, 'y': 500, 'h': 571},
          {'x': 1400, 'y': 500, 'h': 571},
        ],
      },
      {'atUs': 2000000, 'x': 960, 'y': 540, 'h': 1080, 'cut': true, 'layout': 'wide'},
    ];

    test('validates keys with layouts', () {
      expect(normalizeReframeKeys(keys).map((k) => k.toJson()), keys);
      for (final bad in [
        {'atUs': 0, 'x': 1, 'y': 1, 'h': 1, 'layout': 'grid'},
        {'atUs': 0, 'x': 1, 'y': 1, 'h': 1, 'layout': 'split'},
        {'atUs': 0, 'x': 1, 'y': 1, 'h': 1, 'regions': []},
        {
          'atUs': 0,
          'x': 1,
          'y': 1,
          'h': 1,
          'layout': 'split',
          'regions': [
            {'x': 1, 'y': 1, 'h': 1},
          ],
        },
        {
          'atUs': 0,
          'x': 1,
          'y': 1,
          'h': 1,
          'layout': 'split',
          'regions': [
            {'x': 1, 'y': 1, 'h': 0},
            {'x': 1, 'y': 1, 'h': 1},
          ],
        },
      ]) {
        expect(codeOf(() => normalizeReframeKeys([bad])), 'INVALID_RANGE', reason: '$bad');
      }
    });

    test('validates a track', () {
      expect(normalizeReframeTrack(track).toJson(), track);
      Map<String, Object?> copy() => jsonDecode(jsonEncode(track)) as Map<String, Object?>;
      String bad(void Function(Map<String, Object?> t) change) =>
          codeOf(() => normalizeReframeTrack(copy().let(change)));
      expect(codeOf(() => normalizeReframeTrack(null)), 'INVALID_RANGE');
      for (final change in <void Function(Map<String, Object?>)>[
        (t) => t['version'] = 2,
        (t) => t['style'] = 101,
        (t) => t['maxUpscalePct'] = 99,
        (t) => t['zoomPct'] = 1001,
        (t) => t['safeZone'] = 'tiktok',
        (t) => t['activeArea'] = {'x': 0, 'y': 0, 'w': 0, 'h': 1},
        (t) => t['people'] = {},
        (t) => t['segments'] = {},
        (t) => (t['people'] as List)[0] = null,
        (t) => ((t['people'] as List)[0] as Map)['id'] = 'x1',
        (t) => ((t['people'] as List)[0] as Map)['label'] = '',
        (t) => ((t['people'] as List)[0] as Map)['kind'] = 'robot',
        (t) => ((t['people'] as List)[0] as Map)['priority'] = 'yes',
        (t) => ((t['people'] as List)[0] as Map)['merged'] = ['p2'],
        (t) => ((t['people'] as List)[1] as Map)['merged'] = ['p3'],
        (t) => (t['segments'] as List)[0] = null,
        (t) => ((t['segments'] as List)[0] as Map)['id'] = 't1',
        (t) => ((t['segments'] as List)[0] as Map)['endUs'] = 0,
        (t) => ((t['segments'] as List)[1] as Map)['startUs'] = 500000,
        (t) => ((t['segments'] as List)[0] as Map)['layout'] = 'grid',
        (t) => ((t['segments'] as List)[0] as Map)['resolved'] = 'auto',
        (t) => ((t['segments'] as List)[0] as Map)['reason'] = 'magic',
        (t) => ((t['segments'] as List)[0] as Map)['locked'] = 1,
        (t) => ((t['segments'] as List)[0] as Map)['focus'] = ['p9'],
        (t) => ((t['segments'] as List)[0] as Map)['focus'] = ['p1', 'p2', 'p1'],
        (t) => ((t['segments'] as List)[0] as Map)['window'] = {'x': 1, 'y': 1, 'h': 1},
      ]) {
        expect(bad(change), 'INVALID_RANGE');
      }
    });

    test('stores, keeps and removes the track with ClipSetReframe, and saves it', () {
      final editor = Editor(ids: sequentialIds(), width: 1080, height: 1920);
      editor.dispatch(
        AssetAdd(
          Asset(
            id: 'ast_w',
            kind: AssetKind.video,
            name: 'w.mp4',
            uri: 'file://w.mp4',
            durationUs: 10000000,
            width: 1920,
            height: 1080,
          ),
        ),
      );
      final clipId = editor.dispatch(const ClipAdd('ast_w')).clipId;
      final t = normalizeReframeTrack(track);
      final k = normalizeReframeKeys(keys);
      Clip clip() => editor.project.tracks[0].clips[0];
      editor.dispatch(ClipSetReframe(clipId, k, track: t));
      expect(reframeTrack(clip())?.toJson(), track);
      editor.dispatch(ClipSetReframe(clipId, [k[0]]));
      expect(reframeTrack(clip())?.toJson(), track);
      final crop = clipCropKeys(clip(), editor.project.assets[0], editor.project.settings)!;
      expect(crop[0].rect.toJson(), {'x': 240, 'y': 0, 'w': 608, 'h': 1080});
      final reopened = parseProject(jsonEncode(editor.toJson()));
      expect(reframeTrack(reopened.tracks[0].clips[0])?.toJson(), track);
      editor.dispatch(ClipSetReframe(clipId, [k[0]], removeTrack: true));
      expect(reframeTrack(clip()), isNull);
      editor.undo();
      expect(reframeTrack(clip())?.toJson(), track);
      final outside = normalizeReframeTrack(track)..activeArea = const CropRect(1000, 0, 1440, 1080);
      expect(codeOf(() => editor.dispatch(ClipSetReframe(clipId, k, track: outside))), 'INVALID_RANGE');
      final json = jsonDecode(jsonEncode(editor.toJson())) as Map<String, Object?>;
      final effect =
          (((json['tracks'] as List<Object?>)[0] as Map<String, Object?>)['clips'] as List<Object?>)[0]
              as Map<String, Object?>;
      final params =
          ((effect['effects'] as List<Object?>)[0] as Map<String, Object?>)['params'] as Map<String, Object?>;
      (((params['track'] as Map<String, Object?>)['segments'] as List<Object?>)[0] as Map<String, Object?>)['reason'] =
          'magic';
      expect(codeOf(() => parseProject(jsonEncode(json))), 'INVALID_PROJECT');
    });

    test('clamps crops inside an active area', () {
      const area = CropRect(240, 0, 1440, 1080);
      expect(
        cropRect(const ReframeKey(atUs: 0, x: 1700, y: 540, h: 2000), 1920, 1080, 1080, 1920, area: area).toJson(),
        {'x': 1072, 'y': 0, 'w': 608, 'h': 1080},
      );
    });
  });
}

extension<T> on T {
  T let(void Function(T) f) {
    f(this);
    return this;
  }
}
