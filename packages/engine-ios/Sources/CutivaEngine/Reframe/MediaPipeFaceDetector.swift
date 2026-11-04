#if canImport(MediaPipeTasksVision) && canImport(UIKit)
import CoreGraphics
import Foundation
import MediaPipeTasksVision
import UIKit

/**
 * A face detector on MediaPipe Face Landmarker (Apache-2.0), built like `@cutiva/web/mediapipe` and
 * the Android engine's: the whole frame plus overlapping tiles (`faceTiles`), merged (`mergeFaces`);
 * the mouth is the gap between the inner lips (landmarks 13 and 14) over the face's height. Frames
 * never leave the device. Compiled only where the app links `MediaPipeTasksVision` (the
 * `@cutiva/expo` pod). Throws `MODEL_LOAD_FAILED` when MediaPipe can't start.
 */
public final class MediaPipeFaceDetector: FaceDetector {
    private let landmarker: FaceLandmarker
    private let tiles: Bool

    /** `model` is the file `FaceModel.load` returns. */
    public init(model: URL, maxFaces: Int = 6, tiles: Bool = true) throws {
        self.tiles = tiles
        let options = FaceLandmarkerOptions()
        options.baseOptions.modelAssetPath = model.path
        options.runningMode = .image
        options.numFaces = maxFaces
        options.outputFaceBlendshapes = false
        do {
            landmarker = try FaceLandmarker(options: options)
        } catch {
            throw CutivaError("MODEL_LOAD_FAILED", "MediaPipe didn't start: \(error.localizedDescription)")
        }
    }

    /** Faces in `image`, placed at (`ox`, `oy`) in the frame. */
    private func faces(in image: CGImage, ox: Int, oy: Int) throws -> [FaceBox] {
        let w = Double(image.width)
        let h = Double(image.height)
        let result = try landmarker.detect(image: try MPImage(uiImage: UIImage(cgImage: image)))
        return result.faceLandmarks.map { points in
            var minX = 1.0, minY = 1.0, maxX = 0.0, maxY = 0.0
            for p in points {
                minX = min(minX, Double(p.x))
                minY = min(minY, Double(p.y))
                maxX = max(maxX, Double(p.x))
                maxY = max(maxY, Double(p.y))
            }
            let fh = (maxY - minY) * h
            var gap = 0.0
            if points.count > 14 {
                let upper = points[13]
                let lower = points[14]
                gap = hypot(Double(upper.x - lower.x) * w, Double(upper.y - lower.y) * h)
            }
            return FaceBox(x: Double(ox) + minX * w, y: Double(oy) + minY * h, w: (maxX - minX) * w, h: fh, mouth: fh > 0 ? min(1, gap / fh) : 0)
        }
    }

    public func detect(_ frame: CGImage) throws -> [FaceBox] {
        var boxes = try faces(in: frame, ox: 0, oy: 0)
        if tiles {
            for t in faceTiles(frame.width, frame.height) {
                guard let tile = frame.cropping(to: CGRect(x: t.x, y: t.y, width: t.size, height: t.size)) else { continue }
                boxes += try faces(in: tile, ox: t.x, oy: t.y)
            }
        }
        return mergeFaces(boxes)
    }
}
#endif
