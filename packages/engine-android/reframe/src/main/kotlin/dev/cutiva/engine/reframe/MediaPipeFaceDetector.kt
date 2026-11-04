package dev.cutiva.engine.reframe

import android.content.Context
import android.graphics.Bitmap
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarker
import dev.cutiva.engine.CutivaException
import java.io.Closeable
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

/** Finds faces in one frame, in the frame's own pixels, with how open each mouth is (0 to 1). */
fun interface FaceDetector {
    fun detect(frame: Bitmap): List<FaceBox>
}

/**
 * A face detector on MediaPipe Face Landmarker (Apache-2.0), built like `@cutiva/web/mediapipe`:
 * the whole frame plus overlapping tiles ([faceTiles]), merged ([mergeFaces]); the mouth is the gap
 * between the inner lips (landmarks 13 and 14) over the face's height. Frames never leave the
 * device. Note: MediaPipe's Android library sends anonymous usage statistics (task name, latency,
 * device model) to Google; no images or results. Throws `MODEL_LOAD_FAILED` when MediaPipe can't start.
 */
class MediaPipeFaceDetector @JvmOverloads constructor(
    context: Context,
    model: ByteArray,
    maxFaces: Int = 6,
    private val tiles: Boolean = true,
) : FaceDetector, Closeable {
    private val landmarker: FaceLandmarker = try {
        val buffer = ByteBuffer.allocateDirect(model.size).order(ByteOrder.nativeOrder()).put(model).apply { rewind() }
        FaceLandmarker.createFromOptions(
            context,
            FaceLandmarker.FaceLandmarkerOptions.builder()
                .setBaseOptions(BaseOptions.builder().setModelAssetBuffer(buffer).build())
                .setRunningMode(RunningMode.IMAGE)
                .setNumFaces(maxFaces)
                .setOutputFaceBlendshapes(false)
                .build(),
        )
    } catch (e: Exception) {
        throw CutivaException("MODEL_LOAD_FAILED", "MediaPipe didn't start: ${e.message}", e)
    }

    /** Faces in [image], placed at ([ox], [oy]) in the frame. */
    private fun facesIn(image: Bitmap, ox: Int, oy: Int): List<FaceBox> {
        val w = image.width.toDouble()
        val h = image.height.toDouble()
        return landmarker.detect(BitmapImageBuilder(image).build()).faceLandmarks().map { points ->
            var minX = 1.0
            var minY = 1.0
            var maxX = 0.0
            var maxY = 0.0
            for (p in points) {
                minX = min(minX, p.x().toDouble())
                minY = min(minY, p.y().toDouble())
                maxX = max(maxX, p.x().toDouble())
                maxY = max(maxY, p.y().toDouble())
            }
            val fh = (maxY - minY) * h
            val upper = points.getOrNull(13)
            val lower = points.getOrNull(14)
            val gap = if (upper != null && lower != null) hypot((upper.x() - lower.x()) * w, (upper.y() - lower.y()) * h) else 0.0
            FaceBox(ox + minX * w, oy + minY * h, (maxX - minX) * w, fh, if (fh > 0) min(1.0, gap / fh) else 0.0)
        }
    }

    override fun detect(frame: Bitmap): List<FaceBox> {
        val boxes = facesIn(frame, 0, 0).toMutableList()
        if (tiles) {
            for (t in faceTiles(frame.width, frame.height)) {
                val tile = Bitmap.createBitmap(frame, t.x, t.y, t.size, t.size)
                boxes += facesIn(tile, t.x, t.y)
                tile.recycle()
            }
        }
        return mergeFaces(boxes)
    }

    override fun close() = landmarker.close()
}
