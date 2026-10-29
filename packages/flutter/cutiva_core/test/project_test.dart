import 'dart:convert';

import 'package:cutiva_core/cutiva_core.dart';
import 'package:test/test.dart';

typedef Json = Map<String, dynamic>;

/// A small valid document; tests change one thing at a time.
/// Round-tripped through JSON so every map is as loosely typed as decoded input.
Json doc() =>
    jsonDecode(
          jsonEncode({
            'version': '0.1.0',
            'id': 'prj',
            'settings': {
              'width': 1280,
              'height': 720,
              'fps': {'num': 30, 'den': 1},
              'sampleRate': 48000,
            },
            'assets': [
              {'id': 'v', 'kind': 'video', 'name': 'v.mp4', 'uri': 'file://v.mp4', 'durationUs': 10000000},
              {'id': 'a', 'kind': 'audio', 'name': 'a.mp3', 'uri': 'file://a.mp3', 'durationUs': 10000000},
            ],
            'tracks': [
              {
                'id': 'tv',
                'kind': 'video',
                'muted': false,
                'clips': [
                  {
                    'id': 'c1',
                    'assetId': 'v',
                    'startUs': 0,
                    'sourceInUs': 0,
                    'sourceOutUs': 1000000,
                    'speed': 1,
                    'volume': 1,
                    'effects': [],
                  },
                ],
              },
              {'id': 'ta', 'kind': 'audio', 'muted': false, 'clips': []},
            ],
          }),
        )
        as Json;

Json settingsOf(Json d) => d['settings'] as Json;
Json track(Json d, int i) => (d['tracks'] as List)[i] as Json;
Json clip(Json d) => (track(d, 0)['clips'] as List)[0] as Json;
Json asset(Json d) => (d['assets'] as List)[0] as Json;

String errorOf(Object? input) {
  try {
    parseProject(input);
  } on CutivaError catch (e) {
    return '${e.code.value}: ${e.message}';
  } catch (e) {
    return 'OTHER: ${e.runtimeType}';
  }
  return 'NONE';
}

void main() {
  group('parseProject', () {
    test('accepts a JSON string or a map', () {
      expect(parseProject(jsonEncode(doc())).toJson(), parseProject(doc()).toJson());
    });

    test('fills defaults and drops unknown fields', () {
      final d = doc();
      (track(d, 0)['clips'] as List)[0] = {
        'id': 'c1',
        'assetId': 'v',
        'startUs': 0,
        'sourceInUs': 0,
        'sourceOutUs': 1000000,
        'extra': true,
      };
      (d['assets'] as List)[0] = {
        'id': 'v',
        'kind': 'video',
        'uri': 'file://v.mp4',
        'durationUs': 10000000,
        'fingerprint': {'size': 5},
        'junk': 1,
      };
      d['meta'] = {'app': 'test'};
      final p = parseProject(d);
      expect(p.schema, cpfSchemaUrl);
      expect(p.tracks[0].clips[0].toJson(), {
        'id': 'c1',
        'assetId': 'v',
        'startUs': 0,
        'sourceInUs': 0,
        'sourceOutUs': 1000000,
        'speed': 1,
        'volume': 1,
        'effects': [],
      });
      expect(p.assets[0].toJson(), {
        'id': 'v',
        'kind': 'video',
        'name': 'v',
        'uri': 'file://v.mp4',
        'durationUs': 10000000,
        'fingerprint': {'size': 5},
      });
      expect(p.meta, {'app': 'test'});
      expect(p.tracks[1].muted, isFalse);
    });

    test('keeps optional asset fields and well-formed effects', () {
      final d = doc();
      asset(d).addAll({
        'width': 1920,
        'height': 1080.0,
        'hasAudio': false,
        'fingerprint': {'size': 9, 'sha256Head': 'ab'},
      });
      clip(d)['effects'] = [
        {
          'type': 'core/fade',
          'params': {'inUs': 1},
        },
        {'type': 'x'},
        'junk',
      ];
      final p = parseProject(d);
      expect(p.assets[0].toJson(), containsPair('width', 1920));
      expect(p.assets[0].height, 1080);
      expect(p.assets[0].hasAudio, isFalse);
      expect(p.assets[0].fingerprint!.toJson(), {'size': 9, 'sha256Head': 'ab'});
      expect(
        [for (final e in p.tracks[0].clips[0].effects) e.toJson()],
        [
          {
            'type': 'core/fade',
            'params': {'inUs': 1},
          },
          {'type': 'x', 'params': {}},
        ],
      );
    });

    test('reads whole numbers written as decimals, and keeps fractional speed', () {
      final d = doc();
      clip(d).addAll({'sourceOutUs': 1000000.0, 'speed': 1.5, 'volume': 0.25});
      final c = parseProject(d).tracks[0].clips[0];
      expect(c.sourceOutUs, 1000000);
      expect(c.toJson(), containsPair('speed', 1.5));
      expect(c.toJson(), containsPair('volume', 0.25));
    });

    test('sorts clips by start and allows gaps', () {
      final d = doc();
      track(d, 1)['clips'] = [
        {'id': 'late', 'assetId': 'a', 'startUs': 5000000, 'sourceInUs': 0, 'sourceOutUs': 1000000},
        {'id': 'early', 'assetId': 'a', 'startUs': 1000000, 'sourceInUs': 0, 'sourceOutUs': 1000000},
      ];
      expect([for (final c in parseProject(d).tracks[1].clips) c.id], ['early', 'late']);
    });

    final invalid = <(String, Object? Function(Json d), RegExp)>[
      ('not an object', (d) => [], RegExp(r'at \$: expected an object')),
      ('missing settings', (d) => d..['settings'] = null, RegExp(r'\$\.settings: expected an object')),
      ('missing fps', (d) => d..['settings']['fps'] = 30, RegExp(r'\$\.settings\.fps: expected an object')),
      (
        'fractional width',
        (d) => d..['settings']['width'] = 1280.5,
        RegExp(r'\$\.settings\.width: expected an integer'),
      ),
      ('tiny width', (d) => d..['settings']['width'] = 1, RegExp(r'\$\.settings\.width: expected a number >= 2')),
      ('string height', (d) => d..['settings']['height'] = '720', RegExp(r'\$\.settings\.height: expected a number')),
      (
        'infinite sample rate',
        (d) => d..['settings']['sampleRate'] = double.infinity,
        RegExp(r'sampleRate: expected a number'),
      ),
      ('zero fps', (d) => d..['settings']['fps'] = {'num': 0, 'den': 1}, RegExp(r'fps\.num: expected a number >= 1')),
      ('assets not an array', (d) => d..['assets'] = {}, RegExp(r'\$\.assets: expected an array')),
      ('asset not an object', (d) => d..['assets'] = [1], RegExp(r'\$\.assets\[0\]: expected an object')),
      ('asset kind', (d) => d..['assets'][0]['kind'] = 'image', RegExp(r'\$\.assets\[0\]\.kind')),
      (
        'empty asset id',
        (d) => d..['assets'][0]['id'] = '',
        RegExp(r'\$\.assets\[0\]\.id: expected a non-empty string'),
      ),
      ('zero duration', (d) => d..['assets'][0]['durationUs'] = 0, RegExp(r'durationUs: expected a number >= 1')),
      ('track not an object', (d) => d..['tracks'] = [null], RegExp(r'\$\.tracks\[0\]: expected an object')),
      ('track kind', (d) => d..['tracks'][0]['kind'] = 'text', RegExp(r'\$\.tracks\[0\]\.kind')),
      (
        'clips not an array',
        (d) => d..['tracks'][0]['clips'] = 'none',
        RegExp(r'\$\.tracks\[0\]\.clips: expected an array'),
      ),
      ('clip not an object', (d) => d..['tracks'][0]['clips'] = [7], RegExp(r'clips\[0\]: expected an object')),
      (
        'duplicate clip id',
        (d) =>
            d
              ..['tracks'][1]['clips'] = [
                {'id': 'c1', 'assetId': 'a', 'startUs': 0, 'sourceInUs': 0, 'sourceOutUs': 1},
              ],
        RegExp(r'expected a unique clip id'),
      ),
      (
        'clip on missing asset',
        (d) => d..['tracks'][0]['clips'][0]['assetId'] = 'zz',
        RegExp(r'assetId: expected the id of an asset'),
      ),
      (
        'audio asset on a video track',
        (d) => d..['tracks'][0]['clips'][0]['assetId'] = 'a',
        RegExp(r'assetId: expected a video asset, like its track'),
      ),
      (
        'fractional start',
        (d) => d..['tracks'][0]['clips'][0]['startUs'] = 0.5,
        RegExp(r'startUs: expected an integer'),
      ),
      (
        'empty range',
        (d) => d..['tracks'][0]['clips'][0].addAll({'sourceInUs': 5, 'sourceOutUs': 5}),
        RegExp(r'sourceOutUs: expected a value greater than sourceInUs'),
      ),
      (
        'speed too low',
        (d) => d..['tracks'][0]['clips'][0]['speed'] = 0.05,
        RegExp(r'speed: expected a number >= 0\.1'),
      ),
      ('speed too high', (d) => d..['tracks'][0]['clips'][0]['speed'] = 20, RegExp(r'speed: expected a number <= 16')),
      ('volume too high', (d) => d..['tracks'][0]['clips'][0]['volume'] = 5, RegExp(r'volume: expected a number <= 4')),
      (
        'overlapping clips',
        (d) => d..['tracks'][0]['clips'].add({...clip(d), 'id': 'c2', 'startUs': 999999}),
        RegExp(r'\$\.tracks\[0\]\.clips: expected clips that do not overlap \("c2" starts inside "c1"\)'),
      ),
      ('missing project id', (d) => d..remove('id'), RegExp(r'\$\.id: expected a non-empty string')),
    ];

    for (final (name, make, message) in invalid) {
      test('rejects $name with the path', () {
        final out = errorOf(make(doc()));
        expect(out, startsWith('INVALID_PROJECT: '));
        expect(out, matches(message));
      });
    }

    test('rejects other versions and text that is not JSON', () {
      expect(errorOf(doc()..['version'] = '0.2.0'), startsWith('UNSUPPORTED_VERSION: CPF version "0.2.0"'));
      expect(errorOf('not json'), 'OTHER: FormatException');
    });
  });

  group('createProject', () {
    test('starts empty with default settings, overridable', () {
      final p = createProject(fps: Rational(25, 1), ids: sequentialIds());
      expect(p.toJson(), {
        r'$schema': cpfSchemaUrl,
        'version': '0.1.0',
        'id': 'prj_1',
        'settings': {
          ...defaultSettings().toJson(),
          'fps': {'num': 25, 'den': 1},
        },
        'assets': [],
        'tracks': [],
      });
    });
  });

  group('findTrack and findClip', () {
    test('fail with their codes', () {
      final p = parseProject(doc());
      expect(findTrack(p, 'ta').kind, TrackKind.audio);
      expect(findClip(p, 'c1').index, 0);
      expect(
        () => findTrack(p, 'x'),
        throwsA(isA<CutivaError>().having((e) => e.code, 'code', CutivaErrorCode.trackNotFound)),
      );
      expect(
        () => findClip(p, 'x'),
        throwsA(isA<CutivaError>().having((e) => e.code, 'code', CutivaErrorCode.clipNotFound)),
      );
    });
  });
}
