import 'dart:io';

/// Fails when line coverage in coverage/lcov.info is under the minimum, like the TypeScript core.
void main() {
  const minimum = 90.0;
  var found = 0;
  var hit = 0;
  for (final line in File('coverage/lcov.info').readAsLinesSync()) {
    if (line.startsWith('LF:')) found += int.parse(line.substring(3));
    if (line.startsWith('LH:')) hit += int.parse(line.substring(3));
  }
  final percent = found == 0 ? 0.0 : 100 * hit / found;
  stdout.writeln('Line coverage: ${percent.toStringAsFixed(1)}% ($hit/$found)');
  if (percent < minimum) {
    stderr.writeln('Coverage is under $minimum%.');
    exitCode = 1;
  }
}
