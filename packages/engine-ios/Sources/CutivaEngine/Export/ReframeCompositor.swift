import AVFoundation
import CoreImage
import CoreVideo

/** Width the wide layout's background is shrunk to before it is stretched back: the blur (as `draw.ts`). */
private let blurWidth: CGFloat = 32

/** How much the wide layout's background is darkened (as `draw.ts`). */
private let blurDim: CGFloat = 0.35

/**
 * What the compositor draws during one stretch of the timeline: a video segment (letterboxed, or
 * reframed by its crop keys) or, without one, black.
 */
final class CutivaInstruction: NSObject, AVVideoCompositionInstructionProtocol {
    let timeRange: CMTimeRange
    let enablePostProcessing = false
    let containsTweening = true
    let requiredSourceTrackIDs: [NSValue]?
    let passthroughTrackID = kCMPersistentTrackID_Invalid

    let segment: VideoSegment?
    let trackID: CMPersistentTrackID
    /** The source track's `preferredTransform`: turns coded frames into the display orientation crop keys are in. */
    let transform: CGAffineTransform
    let outputSize: CGSize

    init(timeRange: CMTimeRange, segment: VideoSegment?, trackID: CMPersistentTrackID, transform: CGAffineTransform, outputSize: CGSize) {
        self.timeRange = timeRange
        self.segment = segment
        self.trackID = trackID
        self.transform = transform
        self.outputSize = outputSize
        requiredSourceTrackIDs = segment == nil ? [] : [NSNumber(value: trackID)]
    }
}

/**
 * Draws each output frame with Core Image the way `drawLayer` in `@cutiva/web` (and the Android
 * engine's `ReframeEffect`) does: a plain clip letterboxed; a reframed one as its crop rectangle
 * filling the frame, a split's two regions filling the top and bottom halves, or wide (the area
 * letterboxed over a blurred, darkened copy that covers the frame). Colour math runs on the raw
 * pixel values, as a canvas does.
 */
final class CutivaCompositor: NSObject, AVVideoCompositing {
    private static let context = CIContext(options: [.workingColorSpace: NSNull(), .outputColorSpace: NSNull(), .cacheIntermediates: false])

    let sourcePixelBufferAttributes: [String: any Sendable]? = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
    let requiredPixelBufferAttributesForRenderContext: [String: any Sendable] = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]

    override init() { super.init() }

    func renderContextChanged(_ newRenderContext: AVVideoCompositionRenderContext) {}

    func startRequest(_ request: AVAsynchronousVideoCompositionRequest) {
        guard let out = request.renderContext.newPixelBuffer() else {
            request.finish(with: CutivaError("EXPORT_FAILED", "No output frame buffer."))
            return
        }
        let instruction = request.videoCompositionInstruction as? CutivaInstruction
        let size = request.renderContext.size
        var image = CIImage(color: .black).cropped(to: CGRect(origin: .zero, size: size))
        if let instruction, let segment = instruction.segment, let buffer = request.sourceFrame(byTrackID: instruction.trackID) {
            let source = Self.upright(CIImage(cvPixelBuffer: buffer), instruction.transform)
            let timelineUs = Int64((request.compositionTime.seconds * 1e6).rounded())
            image = Self.draw(source, segment, timelineUs, size).composited(over: image)
        }
        Self.context.render(image, to: out, bounds: CGRect(origin: .zero, size: size), colorSpace: nil)
        request.finish(withComposedVideoFrame: out)
    }

    func cancelAllPendingVideoCompositionRequests() {}

    /** The coded frame turned to its display orientation, with its extent at the origin. */
    static func upright(_ image: CIImage, _ t: CGAffineTransform) -> CIImage {
        if t.isIdentity { return image }
        // preferredTransform works in top-left-origin coordinates; Core Image is bottom-left. Flip, apply, flip back.
        let h = image.extent.height
        let flipIn = CGAffineTransform(a: 1, b: 0, c: 0, d: -1, tx: 0, ty: h)
        let turned = image.transformed(by: flipIn.concatenating(t))
        let bounds = turned.extent
        let flipOut = CGAffineTransform(a: 1, b: 0, c: 0, d: -1, tx: -bounds.minX, ty: bounds.maxY)
        return turned.transformed(by: flipOut)
    }

    /** A rectangle given with a top-left origin in a picture of `height`, in Core Image's bottom-left coordinates. */
    private static func flipped(_ r: CGRect, _ height: CGFloat) -> CGRect {
        CGRect(x: r.minX, y: height - r.maxY, width: r.width, height: r.height)
    }

    /** `src` of `image` (top-left coordinates) stretched onto `dst` of a frame of `size` (top-left coordinates). */
    private static func quad(_ image: CIImage, _ src: CGRect, _ dst: CGRect, _ size: CGSize) -> CIImage {
        let s = flipped(src, image.extent.height)
        let d = flipped(dst, size.height)
        let t = CGAffineTransform(translationX: -s.minX, y: -s.minY)
            .concatenating(CGAffineTransform(scaleX: d.width / s.width, y: d.height / s.height))
            .concatenating(CGAffineTransform(translationX: d.minX, y: d.minY))
        // Clamp so the edges sample the picture rather than transparency, then keep only the target rectangle.
        return image.cropped(to: s).clampedToExtent().transformed(by: t).cropped(to: d)
    }

    static func draw(_ source: CIImage, _ segment: VideoSegment, _ timelineUs: Int64, _ size: CGSize) -> CIImage {
        let fw = size.width
        let fh = size.height
        let full = CGRect(origin: .zero, size: size)
        guard let keys = segment.crop, !keys.isEmpty, let sw = segment.sourceWidth, let sh = segment.sourceHeight, sw > 0, sh > 0 else {
            // Letterbox: the whole picture fitted inside the frame.
            let iw = source.extent.width
            let ih = source.extent.height
            let scale = min(fw / iw, fh / ih)
            let w = iw * scale
            let h = ih * scale
            return quad(source, CGRect(x: 0, y: 0, width: iw, height: ih), CGRect(x: (fw - w) / 2, y: (fh - h) / 2, width: w, height: h), size)
        }
        let s = sourceTimeAt(segment, timelineUs)
        let sx = source.extent.width / CGFloat(sw)
        let sy = source.extent.height / CGFloat(sh)
        func scaled(_ r: CropRect) -> CGRect { CGRect(x: CGFloat(r.x) * sx, y: CGFloat(r.y) * sy, width: CGFloat(r.w) * sx, height: CGFloat(r.h) * sy) }
        switch layoutAt(keys, s) {
        case nil:
            return quad(source, scaled(cropAt(keys, s)), full, size)
        case let .split(top, bottom):
            let topH = (fh / 2).rounded(.toNearestOrAwayFromZero)
            return quad(source, scaled(top), CGRect(x: 0, y: 0, width: fw, height: topH), size)
                .composited(over: quad(source, scaled(bottom), CGRect(x: 0, y: topH, width: fw, height: fh - topH), size))
        case let .wide(area):
            return drawWide(source, scaled(area), size)
        }
    }

    private static func drawWide(_ source: CIImage, _ area: CGRect, _ size: CGSize) -> CIImage {
        let fw = size.width
        let fh = size.height
        // Background: the part of the area with the frame's aspect, centred ("cover"), shrunk to
        // `blurWidth` wide with a filtered downscale, stretched back with bilinear sampling and darkened.
        let frameAspect = fw / fh
        let cw = area.width / area.height > frameAspect ? area.height * frameAspect : area.width
        let ch = area.width / area.height > frameAspect ? area.height : area.width / frameAspect
        let cover = CGRect(x: area.minX + (area.width - cw) / 2, y: area.minY + (area.height - ch) / 2, width: cw, height: ch)
        let coverCI = flipped(cover, source.extent.height)
        let smallH = max(1, (blurWidth * fh / fw).rounded())
        let picked = source.cropped(to: coverCI).transformed(by: CGAffineTransform(translationX: -coverCI.minX, y: -coverCI.minY))
        let shrink = CIFilter(name: "CILanczosScaleTransform", parameters: [
            kCIInputImageKey: picked.clampedToExtent(),
            kCIInputScaleKey: smallH / ch,
            kCIInputAspectRatioKey: (blurWidth / cw) / (smallH / ch),
        ])!.outputImage!.cropped(to: CGRect(x: 0, y: 0, width: blurWidth, height: smallH))
        let back = shrink.clampedToExtent()
            .transformed(by: CGAffineTransform(scaleX: fw / blurWidth, y: fh / smallH))
            .cropped(to: CGRect(origin: .zero, size: size))
        let gain = 1 - blurDim
        let dimmed = back.applyingFilter("CIColorMatrix", parameters: [
            "inputRVector": CIVector(x: gain, y: 0, z: 0, w: 0),
            "inputGVector": CIVector(x: 0, y: gain, z: 0, w: 0),
            "inputBVector": CIVector(x: 0, y: 0, z: gain, w: 0),
        ])
        // Foreground: the whole area, letterboxed.
        let scale = min(fw / area.width, fh / area.height)
        let w = area.width * scale
        let h = area.height * scale
        return quad(source, area, CGRect(x: (fw - w) / 2, y: (fh - h) / 2, width: w, height: h), size).composited(over: dimmed)
    }
}
