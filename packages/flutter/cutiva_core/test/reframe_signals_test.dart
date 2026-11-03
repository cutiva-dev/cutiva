import 'dart:math' as math;

import 'package:cutiva_core/cutiva_core.dart';
import 'package:test/test.dart';

import 'helpers.dart';

/// A w×h image filled with [fill], where [paint] returns a value for the pixels it wants to change.
LumaImage image(int w, int h, int fill, [int? Function(int x, int y)? paint]) => LumaImage(w, h, [
  for (var y = 0; y < h; y++)
    for (var x = 0; x < w; x++) paint?.call(x, y) ?? fill,
]);

Map<String, Object?>? area(LumaImage peak, int w, int h) => detectActiveArea(peak, w, h)?.toJson();

void main() {
  group('detectActiveArea', () {
    test('returns null when nothing is black at the edges', () {
      expect(area(image(16, 9, 120), 1920, 1080), isNull);
    });

    test('finds a letterbox and scales it to source pixels', () {
      final peak = image(64, 36, 180, (_, y) => y < 5 || y >= 31 ? 16 : null);
      expect(area(peak, 1920, 1080), {'x': 0, 'y': 150, 'w': 1920, 'h': 780});
    });

    test('finds pillarbox bars', () {
      final peak = image(64, 36, 180, (x, _) => x < 8 || x >= 56 ? 20 : null);
      expect(area(peak, 1920, 1080), {'x': 240, 'y': 0, 'w': 1440, 'h': 1080});
    });

    test('ignores a bar under 2% of the side', () {
      expect(area(image(100, 100, 180, (_, y) => y == 0 ? 0 : null), 1000, 1000), isNull);
      expect(area(image(100, 100, 180, (_, y) => y <= 1 ? 0 : null), 1000, 1000), {
        'x': 0,
        'y': 20,
        'w': 1000,
        'h': 980,
      });
    });

    test('needs 95% of a row black and luma up to 32', () {
      expect(area(image(100, 10, 180, (x, y) => y == 0 && x < 95 ? 0 : null), 100, 10), {
        'x': 0,
        'y': 1,
        'w': 100,
        'h': 9,
      });
      expect(area(image(100, 10, 180, (x, y) => y == 0 && x < 94 ? 0 : null), 100, 10), isNull);
      expect(area(image(10, 10, 180, (_, y) => y == 0 ? 32 : null), 10, 10), {'x': 0, 'y': 1, 'w': 10, 'h': 9});
      expect(area(image(10, 10, 180, (_, y) => y == 0 ? 33 : null), 10, 10), isNull);
    });

    test('returns null for a dark scene', () {
      expect(area(image(8, 8, 0), 800, 800), isNull);
      expect(area(image(10, 10, 0, (x, y) => x >= 2 && x < 8 && y >= 3 && y < 7 ? 200 : null), 1000, 1000), isNull);
    });

    test('rounds inwards', () {
      expect(area(image(3, 3, 200, (_, y) => y == 0 ? 0 : null), 100, 100), {'x': 0, 'y': 34, 'w': 100, 'h': 66});
    });

    test('rejects bad sizes', () {
      expect(codeOf(() => detectActiveArea(const LumaImage(0, 1, []), 10, 10)), 'INVALID_RANGE');
      expect(codeOf(() => detectActiveArea(const LumaImage(2, 2, [0]), 10, 10)), 'INVALID_RANGE');
    });
  });

  group('stereoPan', () {
    const sr = 1000;
    List<double> constant(int n, double v) => List.filled(n, v);

    test('returns null for mono saved as stereo and for silence', () {
      final s = [for (var i = 0; i < 1000; i++) math.sin(i / 10)];
      expect(stereoPan(s, s, sr, [500000]), isNull);
      expect(stereoPan(s, [for (final v in s) v * 0.99], sr, [500000]), isNull);
      expect(stereoPan(constant(100, 0), constant(100, 0), sr, [0]), isNull);
    });

    test('gives -1 for the left, 1 for the right and weighs energy', () {
      final left = [...constant(500, 0.5), ...constant(500, 0)];
      final right = [...constant(500, 0), ...constant(500, 0.5)];
      expect(stereoPan(left, right, sr, [200000, 800000]), [-1, 1]);
      expect(stereoPan(constant(1000, 0.6), constant(1000, 0.8), sr, [500000])![0], closeTo(0.28, 1e-12));
    });

    test('reads 100 ms on each side, gives 0 for silence and clips at the ends', () {
      final left = constant(1000, 0)..[0] = 0.5;
      final right = [...constant(500, 0), ...constant(500, 0.5)];
      expect(stereoPan(left, right, sr, [200000, 450000]), [0, 1]);
      expect(stereoPan(constant(100, 0.5), constant(100, 0), sr, [0, 100000, 5000000]), [-1, -1, 0]);
    });

    test('rejects bad input', () {
      expect(codeOf(() => stereoPan([1], [1, 2], sr, [])), 'INVALID_RANGE');
      expect(codeOf(() => stereoPan([1], [0], 0, [])), 'INVALID_RANGE');
      expect(codeOf(() => stereoPan([1], [0], sr, [-1])), 'INVALID_RANGE');
    });
  });
}
