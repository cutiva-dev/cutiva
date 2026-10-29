import 'package:cutiva_core/cutiva_core.dart';
import 'package:test/test.dart';

Clip clipOf(int sourceOutUs, double speed) =>
    Clip(id: 'c', assetId: 'a', startUs: 0, sourceInUs: 0, sourceOutUs: sourceOutUs, speed: speed);

void main() {
  group('time', () {
    test('converts at the edges and rounds to whole microseconds', () {
      expect(secondsToUs(1.5), 1500000);
      expect(secondsToUs(1 / 3), 333333);
      expect(usToSeconds(2500000), 2.5);
    });

    test('rounds halves up, also below zero, like Math.round', () {
      expect(roundHalfUp(2.5), 3);
      expect(roundHalfUp(2.4999), 2);
      expect(roundHalfUp(-1.5), -1);
      expect(roundHalfUp(-1.51), -2);
      expect(roundHalfUp(0), 0);
    });

    test('rounds clip durations after speed', () {
      expect(clipDurationUs(clipOf(1000000, 3)), 333333);
      expect(clipDurationUs(clipOf(5, 2)), 3);
    });

    test('an empty project lasts 0', () {
      expect(projectDurationUs(Editor().project), 0);
    });

    test('formats timecodes, hours included, never negative', () {
      expect(formatTimecode(62500000), '00:01:02.500');
      expect(formatTimecode(3723004000), '01:02:03.004');
      expect(formatTimecode(-5), '00:00:00.000');
    });
  });

  group('ids', () {
    test('random ids carry the prefix and differ', () {
      final a = randomId('clip');
      expect(a, matches(RegExp(r'^clip_[0-9a-f]{10}$')));
      expect(randomId('clip'), isNot(a));
    });

    test('sequential ids count per prefix', () {
      final ids = sequentialIds();
      expect([ids('clip'), ids('clip'), ids('trk')], ['clip_1', 'clip_2', 'trk_1']);
    });
  });

  test('errors carry the shared code string', () {
    const e = CutivaError(CutivaErrorCode.nothingToExport, 'Empty.');
    expect(e.code.value, 'NOTHING_TO_EXPORT');
    expect(e.toString(), 'CutivaError(NOTHING_TO_EXPORT): Empty.');
  });
}
