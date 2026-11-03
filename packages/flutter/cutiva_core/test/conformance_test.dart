import 'dart:convert';
import 'dart:io';

import 'package:cutiva_core/cutiva_core.dart';
import 'package:test/test.dart';

/// The shared fixtures every Cutiva SDK must pass. See conformance/README.md.
final _dir = Directory('../../../conformance/fixtures');

void main() {
  final autoDir = Directory('${_dir.path}/auto-reframe');
  final autoFixtures =
      autoDir.listSync().whereType<File>().where((f) => f.path.endsWith('.input.json')).toList()
        ..sort((a, b) => a.path.compareTo(b.path));
  test('finds the auto-reframe fixtures', () => expect(autoFixtures, isNotEmpty));
  for (final file in autoFixtures) {
    test('auto-reframe ${file.uri.pathSegments.last}', () {
      final fixture = jsonDecode(file.readAsStringSync()) as Map<String, Object?>;
      final input = fixture['input'] as Map<String, Object?>;
      final expected =
          jsonDecode(File(file.path.replaceFirst('.input.json', '.expected.json')).readAsStringSync())
                as Map<String, Object?>
            ..remove('_notes');
      final frames = (input['frames'] as List<Object?>?) ?? const [];
      switch (fixture['function']) {
        case 'autoReframe':
          final result = autoReframe(
            sourceWidth: input['sourceWidth'] as int,
            sourceHeight: input['sourceHeight'] as int,
            outputWidth: input['outputWidth'] as int,
            outputHeight: input['outputHeight'] as int,
            durationUs: input['durationUs'] as int,
            frames: [for (final f in frames) FrameObservation.fromJson(f as Map<String, Object?>)],
            cuts: [for (final c in (input['cuts'] as List<Object?>?) ?? const []) c as int],
          );
          expect(result.toJson(), expected);
        case 'planReframe':
          final area = input['activeArea'] as Map<String, Object?>?;
          final result = planReframe(
            sourceWidth: input['sourceWidth'] as int,
            sourceHeight: input['sourceHeight'] as int,
            outputWidth: input['outputWidth'] as int,
            outputHeight: input['outputHeight'] as int,
            durationUs: input['durationUs'] as int,
            frames: [for (final f in frames) PlanFrame.fromJson(f as Map<String, Object?>)],
            cuts: [for (final c in (input['cuts'] as List<Object?>?) ?? const []) c as int],
            activeArea:
                area == null ? null : CropRect(area['x'] as int, area['y'] as int, area['w'] as int, area['h'] as int),
            track: input['track'] == null ? null : normalizeReframeTrack(input['track']),
          );
          // Sightings are for editors and are covered by unit tests; the fixtures pin the track and keys.
          expect(result.toJson()..remove('sightings'), expected);
        case 'detectCuts':
          final cuts = detectCuts([
            for (final f in frames.cast<Map<String, Object?>>())
              FrameHistogram(f['atUs'] as int, (f['bins'] as List<Object?>).cast<num>()),
          ]);
          expect({'cuts': cuts}, expected);
        case 'detectActiveArea':
          final peak = input['peak'] as Map<String, Object?>;
          final area = detectActiveArea(
            LumaImage(peak['width'] as int, peak['height'] as int, (peak['luma'] as List<Object?>).cast<int>()),
            input['sourceWidth'] as int,
            input['sourceHeight'] as int,
          );
          expect({'area': area?.toJson()}, expected);
        case 'stereoPan':
          List<double> samples(String key) => [for (final v in input[key] as List<Object?>) (v as num).toDouble()];
          final pan = stereoPan(
            samples('left'),
            samples('right'),
            input['sampleRate'] as int,
            (input['timesUs'] as List<Object?>).cast<int>(),
          );
          expect({'pan': pan}, expected);
        default:
          fail('Unknown fixture function ${fixture['function']}');
      }
    });
  }

  final fixtures =
      _dir.listSync().whereType<File>().where((f) => f.path.endsWith('.cpf.json')).toList()
        ..sort((a, b) => a.path.compareTo(b.path));

  test('finds the fixtures', () => expect(fixtures, isNotEmpty));

  for (final file in fixtures) {
    final name = file.uri.pathSegments.last;
    test(name, () {
      final project = parseProject(file.readAsStringSync());
      final expected =
          jsonDecode(File(file.path.replaceFirst('.cpf.json', '.expected.json')).readAsStringSync())
              as Map<String, Object?>;

      expect(projectDurationUs(project), expected['durationUs']);
      for (final sample in expected['videoAt'] as List<Object?>) {
        final s = sample as Map<String, Object?>;
        final got = [
          for (final l in resolveVideoAt(project, s['tUs'] as int))
            {
              'clipId': l.clip.id,
              'sourceTimeUs': l.sourceTimeUs,
              if (l.crop != null) 'crop': l.crop!.toJson(),
              if (l.layout != null) 'layout': l.layout!.toJson(),
            },
        ];
        expect(got, s['layers'], reason: 't=${s['tUs']}');
      }
      final audio = audioSegments(project);
      expect(audio, hasLength(expected['audioSegments']));
      if (expected['audio'] != null) {
        expect([for (final a in audio) a.toJson()..remove('assetId')], expected['audio']);
      }

      final plan = renderPlan(project);
      expect(plan.durationUs, expected['durationUs']);
      const fields = ['layer', 'clipId', 'startUs', 'endUs', 'sourceInUs', 'sourceOutUs', 'speed', 'crop'];
      expect([
        for (final v in plan.video)
          {
            for (final e in v.toJson().entries)
              if (fields.contains(e.key)) e.key: e.value,
          },
      ], expected['videoSegments']);
      expect([for (final a in plan.audio) a.segment.toJson()], [for (final a in audio) a.toJson()]);
      for (final a in plan.audio) {
        final s = a.segment;
        expect(a.endUs, s.startUs + roundHalfUp((s.sourceOutUs - s.sourceInUs) / s.speed));
      }
      // An engine that only reads the plan shows the same frames as resolveVideoAt.
      for (final sample in expected['videoAt'] as List<Object?>) {
        final s = sample as Map<String, Object?>;
        final t = s['tUs'] as int;
        final shown = [
          for (final v in plan.video)
            if (t >= v.startUs && t < v.endUs) _shown(v, v.sourceInUs + roundHalfUp((t - v.startUs) * v.speed)),
        ];
        expect(shown, s['layers'], reason: 'plan at t=$t');
      }
    });
  }
}

Map<String, Object?> _shown(VideoSegment v, int sourceTimeUs) => {
  'clipId': v.clipId,
  'sourceTimeUs': sourceTimeUs,
  if (v.crop != null) 'crop': cropAt(v.crop!, sourceTimeUs).toJson(),
  if (v.crop != null && layoutAt(v.crop!, sourceTimeUs) != null) 'layout': layoutAt(v.crop!, sourceTimeUs)!.toJson(),
};
