import Foundation

/** Left and right are treated as one channel when their difference holds less than this share of the energy (as `stereoPan`). */
private let monoEnergy = 1e-3

/** Speech loudness and pan are measured within this many µs on each side of a time (`stereoPan`, `voiceLevels` on the web). */
private let halfWindowUs: Int64 = 100_000

/** Nearest sample to `us`, halves up, as `sampleAt` in `@cutiva/core`. */
func sampleAt(_ us: Int64, _ sampleRate: Int) -> Int64 {
    let a = us * Int64(sampleRate) + 500_000
    let q = a / 1_000_000
    return (a % 1_000_000 != 0 && a < 0) ? q - 1 : q
}

/**
 * Speech loudness and stereo pan around given times, from samples fed in order, in one pass and
 * without keeping the audio. `pan()` gives what `stereoPan` in `@cutiva/core` gives for the same
 * samples; `voice()` what `voiceLevels` in `@cutiva/web` gives: the RMS of the first channel
 * within 100 ms on each side, over the 90th percentile of those RMS values, capped at 1.
 */
public final class AudioSignals {
    private let n: Int
    private var from: [Int64]
    private var to: [Int64]
    private var left: [Double]
    private var right: [Double]
    private var diff = 0.0
    private var total = 0.0
    private var index: Int64 = 0
    /** First window that may still contain the next sample (windows are sorted and of equal length). */
    private var first = 0

    public init(sampleRate: Int, timesUs: [Int64]) {
        precondition(sampleRate > 0, "sampleRate must be positive.")
        n = timesUs.count
        from = Array(repeating: 0, count: n)
        to = Array(repeating: 0, count: n)
        left = Array(repeating: 0, count: n)
        right = Array(repeating: 0, count: n)
        let half = sampleAt(halfWindowUs, sampleRate)
        for k in 0..<n {
            precondition(timesUs[k] >= 0 && (k == 0 || timesUs[k] > timesUs[k - 1]), "Times must be sorted and non-negative.")
            let mid = sampleAt(timesUs[k], sampleRate)
            from[k] = max(0, mid - half)
            to[k] = mid + half
        }
    }

    /** One sample frame: the first two channels (the same value twice for mono). */
    public func add(_ l: Float, _ r: Float) {
        let i = index
        index += 1
        let dl = Double(l)
        let dr = Double(r)
        diff += (dl - dr) * (dl - dr)
        total += dl * dl + dr * dr
        while first < n && to[first] <= i { first += 1 }
        var k = first
        while k < n && from[k] <= i {
            if i < to[k] {
                left[k] += dl * dl
                right[k] += dr * dr
            }
            k += 1
        }
    }

    /** Pan at each time, -1 (left) to 1 (right); nil when both channels carry the same signal. Silence gives 0. */
    public func pan() -> [Double]? {
        if total == 0 || diff <= monoEnergy * total { return nil }
        return (0..<n).map { k in left[k] + right[k] > 0 ? (right[k] - left[k]) / (right[k] + left[k]) : 0 }
    }

    /** Loudness at each time, 0 to 1. */
    public func voice() -> [Double] {
        let rms: [Double] = (0..<n).map { k in
            let len = min(to[k], index) - from[k]
            return len > 0 ? (left[k] / Double(len)).squareRoot() : 0
        }
        let sorted = rms.sorted()
        let p = Int((Double(n) * 0.9).rounded(.down))
        let ref = p < sorted.count ? sorted[p] : 0
        return rms.map { ref > 0 ? min(1, $0 / ref) : 0 }
    }
}

/** 16 bins each for red, green and blue of a 32 × 18 thumbnail's pixels (0xAARRGGBB), as `analyzeAsset` on the web. */
public func histogram(_ argb: [UInt32]) -> [Int] {
    var bins = [Int](repeating: 0, count: 48)
    for p in argb {
        bins[Int((p >> 16) & 0xff) >> 4] += 1
        bins[16 + (Int((p >> 8) & 0xff) >> 4)] += 1
        bins[32 + (Int(p & 0xff) >> 4)] += 1
    }
    return bins
}

/** Keep, for each pixel, the brightest luma (BT.601 weights, as on the web) seen so far. */
public func addPeak(_ argb: [UInt32], _ peak: inout [UInt8]) {
    for i in peak.indices {
        let p = argb[i]
        let y = (77 * Int((p >> 16) & 0xff) + 150 * Int((p >> 8) & 0xff) + 29 * Int(p & 0xff)) >> 8
        if y > Int(peak[i]) { peak[i] = UInt8(y) }
    }
}
