import Foundation

// Port of `face-tiles.ts` in @cutiva/web (and `FaceTiles.kt`): tiling for detectors that shrink the
// whole image (MediaPipe: 192 px), so small faces in a wide shot are found, and merging the same
// face seen twice.

/** A face box in frame pixels, with its mouth openness (0 closed to 1). */
public struct FaceBox: Equatable, Sendable {
    public let x: Double
    public let y: Double
    public let w: Double
    public let h: Double
    public let mouth: Double

    public init(x: Double, y: Double, w: Double, h: Double, mouth: Double) {
        self.x = x
        self.y = y
        self.w = w
        self.h = h
        self.mouth = mouth
    }
}

/** A square tile of a frame. */
public struct Tile: Equatable, Sendable {
    public let x: Int
    public let y: Int
    public let size: Int
}

private func overlap(_ a: FaceBox, _ b: FaceBox) -> Double {
    let ix = max(0, min(a.x + a.w, b.x + b.w) - max(a.x, b.x))
    let iy = max(0, min(a.y + a.h, b.y + b.h) - max(a.y, b.y))
    return ix * iy
}

/**
 * One face per person: boxes that overlap (IoU 0.3, or the smaller half inside the larger) are the
 * same face seen in two tiles; the largest box wins, since a face cut by a tile's edge is smaller.
 */
public func mergeFaces(_ boxes: [FaceBox]) -> [FaceBox] {
    var out: [FaceBox] = []
    // A stable sort, like Array.prototype.sort: equal areas keep their order.
    let sorted = boxes.enumerated().sorted { a, b in
        let x = a.element.w * a.element.h
        let y = b.element.w * b.element.h
        return x != y ? x > y : a.offset < b.offset
    }.map(\.element)
    for b in sorted {
        let same = out.contains { o in
            let inter = overlap(o, b)
            return inter / (o.w * o.h + b.w * b.h - inter) >= 0.3 || inter / min(o.w * o.h, b.w * b.h) >= 0.5
        }
        if !same { out.append(b) }
    }
    return out
}

/** JavaScript's Math.round: halves up. */
func jsRound(_ v: Double) -> Int { Int((v + 0.5).rounded(.down)) }

/**
 * Overlapping square tiles over a frame: side two thirds of the shorter side, spread evenly from
 * edge to edge at most two thirds of a side apart, so any face up to a third of a tile fits whole
 * in one of them. A 16:9 frame gets 4 × 2 tiles.
 */
public func faceTiles(_ width: Int, _ height: Int) -> [Tile] {
    let size = jsRound(Double(min(width, height)) * 2 / 3)
    func starts(_ len: Int) -> [Int] {
        let span = max(0, len - size)
        let count = Int((Double(span) / (Double(size) * 2 / 3)).rounded(.up)) + 1
        return (0..<count).map { i in count == 1 ? 0 : jsRound(Double(i) * Double(span) / Double(count - 1)) }
    }
    return starts(height).flatMap { y in starts(width).map { x in Tile(x: x, y: y, size: size) } }
}
