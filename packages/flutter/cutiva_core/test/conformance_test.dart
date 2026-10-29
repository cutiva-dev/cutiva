import 'dart:convert';
import 'dart:io';

import 'package:cutiva_core/cutiva_core.dart';
import 'package:test/test.dart';

/// The shared fixtures every Cutiva SDK must pass. See conformance/README.md.
final _dir = Directory('../../../conformance/fixtures');

void main() {
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
            {'clipId': l.clip.id, 'sourceTimeUs': l.sourceTimeUs},
        ];
        expect(got, s['layers'], reason: 't=${s['tUs']}');
      }
      final audio = audioSegments(project);
      expect(audio, hasLength(expected['audioSegments']));
      if (expected['audio'] != null) {
        expect([for (final a in audio) a.toJson()..remove('assetId')], expected['audio']);
      }
    });
  }
}
