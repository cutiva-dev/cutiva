import 'dart:math' as math;

import 'errors.dart';
import 'reframe.dart';

// Signals for the reframe analysis, ported line for line from packages/core/src/reframe-signals.ts.
// The conformance fixtures conformance/fixtures/auto-reframe/signals-*.json pin the output.

/// A greyscale picture: `luma[y * width + x]`, 0 (black) to 255.
class LumaImage {
  final int width;
  final int height;
  final List<int> luma;
  const LumaImage(this.width, this.height, this.luma);
}

/// A pixel this dark or darker counts as black (video black is 16; compression adds noise).
const _barLuma = 32;

/// A row or column is a bar when this share of its pixels (in percent) is black.
const _barSharePct = 95;

/// Bars thinner than this share of the side (in percent) are ignored: edges, not bars.
const _barMinPct = 2;

/// With bars removed, at least this share of each side (in percent) must remain, else it is a dark scene.
const _areaMinPct = 50;

int _ceilDiv(int a, int b) => (a + b - 1) ~/ b;

void _check(bool ok, String message) {
  if (!ok) throw CutivaError(CutivaErrorCode.invalidRange, message);
}

/// Find burned-in black bars. [peak] holds, for each pixel, the brightest luma it had across the
/// sampled frames, at any size with the source's aspect. Returns the picture inside the bars in
/// source pixels, rounded inwards, or null when there are no bars (see the TypeScript docs).
CropRect? detectActiveArea(LumaImage peak, int sourceWidth, int sourceHeight) {
  final w = peak.width;
  final h = peak.height;
  final luma = peak.luma;
  for (final v in [w, h, sourceWidth, sourceHeight]) {
    _check(v >= 1, 'Sizes must be positive integers.');
  }
  _check(luma.length == w * h, 'luma must hold width × height values.');
  bool darkRow(int y) {
    var n = 0;
    for (var x = 0; x < w; x++) {
      if (luma[y * w + x] <= _barLuma) n++;
    }
    return n * 100 >= _barSharePct * w;
  }

  bool darkCol(int x) {
    var n = 0;
    for (var y = 0; y < h; y++) {
      if (luma[y * w + x] <= _barLuma) n++;
    }
    return n * 100 >= _barSharePct * h;
  }

  int run(int len, bool Function(int) dark, bool reverse) {
    var n = 0;
    while (n < len && dark(reverse ? len - 1 - n : n)) {
      n++;
    }
    return n * 100 >= _barMinPct * len ? n : 0;
  }

  final top = run(h, darkRow, false);
  final bottom = run(h, darkRow, true);
  final left = run(w, darkCol, false);
  final right = run(w, darkCol, true);
  if (top + bottom + left + right == 0) return null;
  if ((w - left - right) * 100 < _areaMinPct * w || (h - top - bottom) * 100 < _areaMinPct * h) return null;
  final x0 = _ceilDiv(left * sourceWidth, w);
  final x1 = (w - right) * sourceWidth ~/ w;
  final y0 = _ceilDiv(top * sourceHeight, h);
  final y1 = (h - bottom) * sourceHeight ~/ h;
  return CropRect(x0, y0, x1 - x0, y1 - y0);
}

/// Left and right are treated as one channel when their difference holds less than this share of the energy.
const _monoEnergy = 1e-3;

/// Pan is measured over this long on each side of a time.
const _panHalfWindowUs = 100000;

/// Nearest sample to [us] microseconds, halves up.
int _sampleAt(int us, int sampleRate) => (us * sampleRate + 500000) ~/ 1000000;

/// Where the sound comes from in the stereo field at each time, -1 (left) to 1 (right):
/// `(R − L) / (R + L)` of the energy within 100 ms on each side. Null when the two channels carry
/// the same signal (mono saved as stereo). Silence gives 0.
List<double>? stereoPan(List<double> left, List<double> right, int sampleRate, List<int> timesUs) {
  _check(sampleRate >= 1, 'sampleRate must be a positive integer.');
  _check(left.length == right.length, 'Both channels must have the same length.');
  var diff = 0.0;
  var total = 0.0;
  for (var i = 0; i < left.length; i++) {
    final l = left[i];
    final r = right[i];
    diff += (l - r) * (l - r);
    total += l * l + r * r;
  }
  if (total == 0 || diff <= _monoEnergy * total) return null;
  final half = _sampleAt(_panHalfWindowUs, sampleRate);
  return [
    for (final t in timesUs)
      () {
        _check(t >= 0, 'Times must be non-negative integers.');
        final mid = _sampleAt(t, sampleRate);
        final from = math.max(0, mid - half);
        final to = math.min(left.length, mid + half);
        var l = 0.0;
        var r = 0.0;
        for (var i = from; i < to; i++) {
          l += left[i] * left[i];
          r += right[i] * right[i];
        }
        return l + r > 0 ? (r - l) / (r + l) : 0.0;
      }(),
  ];
}
