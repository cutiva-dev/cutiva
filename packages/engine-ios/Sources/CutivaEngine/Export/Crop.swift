import Foundation

/** A rectangle of the source, in integer source pixels. */
public struct CropRect: Codable, Equatable, Sendable {
    public let x: Int
    public let y: Int
    public let w: Int
    public let h: Int

    public init(_ x: Int, _ y: Int, _ w: Int, _ h: Int) {
        self.x = x
        self.y = y
        self.w = w
        self.h = h
    }
}

/** How a crop key fills the frame besides its single rectangle (`CropLayout` in `@cutiva/core`). */
public enum CropLayout: Equatable, Sendable, Codable {
    /** Two regions of the source: `top` fills the top half of the frame, `bottom` the bottom half. */
    case split(top: CropRect, bottom: CropRect)
    /** The whole `area` fitted inside the frame, over a blurred, darkened copy of it that covers the frame. */
    case wide(area: CropRect)

    private enum Keys: String, CodingKey { case kind, regions, area }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        switch try c.decode(String.self, forKey: .kind) {
        case "split":
            let regions = try c.decode([CropRect].self, forKey: .regions)
            guard regions.count == 2 else { throw CutivaError("INVALID_PROJECT", "A split layout needs two regions.") }
            self = .split(top: regions[0], bottom: regions[1])
        case "wide":
            self = .wide(area: try c.decode(CropRect.self, forKey: .area))
        case let kind:
            throw CutivaError("INVALID_PROJECT", "Unknown crop layout \"\(kind)\".")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Keys.self)
        switch self {
        case let .split(top, bottom):
            try c.encode("split", forKey: .kind)
            try c.encode([top, bottom], forKey: .regions)
        case let .wide(area):
            try c.encode("wide", forKey: .kind)
            try c.encode(area, forKey: .area)
        }
    }
}

/** One crop key of a render plan segment, in source time. */
public struct CropKey: Codable, Equatable, Sendable {
    public let atUs: Int64
    public let rect: CropRect
    public let cut: Bool
    public let layout: CropLayout?

    public init(atUs: Int64, rect: CropRect, cut: Bool = false, layout: CropLayout? = nil) {
        self.atUs = atUs
        self.rect = rect
        self.cut = cut
        self.layout = layout
    }

    private enum Keys: String, CodingKey { case atUs, rect, cut, layout }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        atUs = try c.decode(Int64.self, forKey: .atUs)
        rect = try c.decode(CropRect.self, forKey: .rect)
        cut = try c.decodeIfPresent(Bool.self, forKey: .cut) ?? false
        layout = try c.decodeIfPresent(CropLayout.self, forKey: .layout)
    }
}

/** Index of the key in effect at `sourceUs`: the last at or before it, or -1 before the first. */
private func keyIndex(_ keys: [CropKey], _ sourceUs: Int64) -> Int {
    var i = -1
    while i + 1 < keys.count && keys[i + 1].atUs <= sourceUs { i += 1 }
    return i
}

/** floor(a / b) for b > 0. */
private func floorDiv(_ a: Int64, _ b: Int64) -> Int64 {
    let q = a / b
    return (a % b != 0 && a < 0) ? q - 1 : q
}

/**
 * The crop rectangle at a source time, as `cropAt` in `@cutiva/core`: before the first key, the first
 * key's; after the last, the last key's. Between two keys the edges glide linearly (rounded half up),
 * unless the later key is a cut, which holds the earlier rectangle until it.
 */
public func cropAt(_ keys: [CropKey], _ sourceUs: Int64) -> CropRect {
    precondition(!keys.isEmpty, "cropAt needs at least one key.")
    let i = keyIndex(keys, sourceUs)
    if i < 0 { return keys[0].rect }
    let a = keys[i]
    guard i + 1 < keys.count, !keys[i + 1].cut else { return a.rect }
    let b = keys[i + 1]
    let dt = b.atUs - a.atUs
    let u = sourceUs - a.atUs
    let v = b.atUs - sourceUs
    // floor((2(p·v + q·u) + dt) / (2·dt)), exact in Int64: p, q are pixels and dt a few seconds of µs.
    func lerp(_ p: Int, _ q: Int) -> Int { Int(floorDiv(2 * (Int64(p) * v + Int64(q) * u) + dt, 2 * dt)) }
    let x = lerp(a.rect.x, b.rect.x)
    let y = lerp(a.rect.y, b.rect.y)
    return CropRect(x, y, lerp(a.rect.x + a.rect.w, b.rect.x + b.rect.w) - x, lerp(a.rect.y + a.rect.h, b.rect.y + b.rect.h) - y)
}

/** The layout at a source time (layouts never glide), as `layoutAt` in `@cutiva/core`. Nil for a single window. */
public func layoutAt(_ keys: [CropKey], _ sourceUs: Int64) -> CropLayout? {
    guard !keys.isEmpty else { return nil }
    return keys[max(0, keyIndex(keys, sourceUs))].layout
}

/**
 * The source time shown at a timeline time inside a segment, as `resolveVideoAt` in `@cutiva/core`:
 * `sourceInUs + round((t − startUs) × speed)`, halves up.
 */
public func sourceTimeAt(_ segment: VideoSegment, _ timelineUs: Int64) -> Int64 {
    segment.sourceInUs + Int64((Double(timelineUs - segment.startUs) * segment.speed + 0.5).rounded(.down))
}
