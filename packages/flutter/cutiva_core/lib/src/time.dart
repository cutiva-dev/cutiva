import 'types.dart';

const usPerSecond = 1000000;

/// Rounds to the nearest integer with halves going up, like `Math.round` in JavaScript.
/// Dart's `round()` sends negative halves away from zero, so it is not used for time math.
int roundHalfUp(double x) {
  final f = x.floorToDouble();
  return (x - f >= 0.5 ? f + 1 : f).toInt();
}

Us secondsToUs(double s) => roundHalfUp(s * usPerSecond);
double usToSeconds(Us us) => us / usPerSecond;

/// Length of a clip on the timeline, after speed.
Us clipDurationUs(Clip clip) => timelineLengthUs(clip.sourceInUs, clip.sourceOutUs, clip.speed);

/// Length on the timeline of a source range played at [speed].
Us timelineLengthUs(Us sourceInUs, Us sourceOutUs, double speed) => roundHalfUp((sourceOutUs - sourceInUs) / speed);

Us clipEndUs(Clip clip) => clip.startUs + clipDurationUs(clip);

Us projectDurationUs(Project project) {
  var end = 0;
  for (final track in project.tracks) {
    for (final clip in track.clips) {
      final e = clipEndUs(clip);
      if (e > end) end = e;
    }
  }
  return end;
}

/// Map a timeline time inside a clip to the source time it shows.
Us sourceTimeAt(Clip clip, Us timelineUs) => clip.sourceInUs + roundHalfUp((timelineUs - clip.startUs) * clip.speed);

/// "00:01:02.500"
String formatTimecode(Us us) {
  final totalMs = us <= 0 ? 0 : roundHalfUp(us / 1000);
  String p(int n, [int w = 2]) => n.toString().padLeft(w, '0');
  final ms = totalMs % 1000;
  final s = totalMs ~/ 1000 % 60;
  final m = totalMs ~/ 60000 % 60;
  final h = totalMs ~/ 3600000;
  return '${p(h)}:${p(m)}:${p(s)}.${p(ms, 3)}';
}
