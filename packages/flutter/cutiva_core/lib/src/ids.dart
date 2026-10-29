import 'dart:math';

typedef IdFactory = String Function(String prefix);

final _random = Random.secure();

/// `clip_3f9a0c41b2`: the prefix and 10 random hex digits.
String randomId(String prefix) {
  final rand = List.generate(10, (_) => _random.nextInt(16).toRadixString(16)).join();
  return '${prefix}_$rand';
}

/// Deterministic ids, handy for tests and fixtures: clip_1, clip_2, …
IdFactory sequentialIds() {
  final counters = <String, int>{};
  return (prefix) {
    final n = (counters[prefix] ?? 0) + 1;
    counters[prefix] = n;
    return '${prefix}_$n';
  };
}
