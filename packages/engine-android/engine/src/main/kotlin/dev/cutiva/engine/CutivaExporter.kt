package dev.cutiva.engine

import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.audio.SpeedProvider
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.Presentation
import androidx.media3.transformer.Composition
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.ProgressHolder
import androidx.media3.transformer.Transformer
import kotlin.math.ceil

/** What an export produced, read from the finished file's encoder output. */
data class ExportSummary(
    val durationMs: Long,
    val fileSizeBytes: Long,
    val width: Int,
    val height: Int,
    val videoFrameCount: Int,
    val videoMimeType: String?,
    val audioMimeType: String?,
)

/** A running export. */
fun interface ExportTask {
    /** Stop the export. The listener then gets `onError` with `EXPORT_CANCELLED`. */
    fun cancel()
}

/**
 * Exports a [RenderPlan] to an MP4 (H.264 + AAC) with Media3 Transformer and the device's encoders.
 *
 * Supported today: one video layer (gaps show black), any number of audio segments mixed together,
 * speed, volume and fades. Plans with more than one video layer fail with `UNSUPPORTED_FEATURE`.
 */
@UnstableApi
class CutivaExporter(context: Context, private val looper: Looper = Looper.getMainLooper()) {
    private val context = context.applicationContext
    private val handler = Handler(looper)

    interface Listener {
        /** Fraction done, from 0 to 1, about ten times a second. */
        fun onProgress(fraction: Float) {}
        fun onCompleted(summary: ExportSummary)
        fun onError(error: CutivaException)
    }

    /** Starts exporting [plan] to [outputPath]. Callbacks arrive on this exporter's looper. */
    fun export(plan: RenderPlan, outputPath: String, listener: Listener): ExportTask {
        var transformer: Transformer? = null
        var cancelled = false
        var done = false
        val progress = ProgressHolder()
        val poll = object : Runnable {
            override fun run() {
                val t = transformer ?: return
                if (done) return
                if (t.getProgress(progress) == Transformer.PROGRESS_STATE_AVAILABLE) listener.onProgress(progress.progress / 100f)
                handler.postDelayed(this, 100)
            }
        }
        val start = start@{ composition: Composition ->
            if (cancelled) return@start
            val t = Transformer.Builder(context)
                .setLooper(looper)
                .setVideoMimeType(MimeTypes.VIDEO_H264)
                .setAudioMimeType(MimeTypes.AUDIO_AAC)
                .setEncoderFactory(DelayCorrectingEncoderFactory(DefaultEncoderFactory.Builder(context).build()))
                .addListener(object : Transformer.Listener {
                    override fun onCompleted(composition: Composition, exportResult: ExportResult) {
                        done = true
                        listener.onProgress(1f)
                        listener.onCompleted(exportResult.toSummary())
                    }

                    override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) {
                        done = true
                        listener.onError(CutivaException("EXPORT_FAILED", "Export failed: ${exportException.errorCodeName}: ${exportException.message}", exportException))
                    }
                })
                .build()
            transformer = t
            t.start(composition, outputPath)
            handler.post(poll)
        }
        // Reading the inputs' formats does I/O, so build the composition off the looper.
        Thread({
            val composition = try {
                val delays = plan.audio.filter { it.sourceInUs > 0 }.map { it.uri }.distinct().associateWith { SourceDelay.us(context, it) }
                buildComposition(plan) { delays[it] ?: 0 }
            } catch (e: Exception) {
                val error = e as? CutivaException ?: CutivaException("EXPORT_FAILED", "Could not read the inputs: ${e.message}", e)
                handler.post {
                    if (!done && !cancelled) listener.onError(error)
                    done = true
                }
                return@Thread
            }
            handler.post { start(composition) }
        }, "cutiva-export-setup").start()
        return ExportTask {
            handler.post {
                if (done || cancelled) return@post
                cancelled = true
                done = true
                transformer?.cancel()
                listener.onError(CutivaException("EXPORT_CANCELLED", "Export was cancelled."))
            }
        }
    }

    companion object {
        /**
         * The Media3 composition for [plan]: one video sequence and one audio sequence per lane of
         * non-overlapping sounds. [sourceDelayUs] gives each input's AAC priming (see [SourceDelay]).
         */
        @JvmStatic
        @JvmOverloads
        fun buildComposition(plan: RenderPlan, sourceDelayUs: (uri: String) -> Long = { 0 }): Composition {
            if (plan.durationUs <= 0 || plan.video.isEmpty()) throw CutivaException("NOTHING_TO_EXPORT", "The project has no video to export.")
            if (plan.video.any { it.layer != plan.video[0].layer }) {
                throw CutivaException("UNSUPPORTED_FEATURE", "The Android engine exports one video layer for now; this project has several.")
            }

            // Media3 takes a whole frame rate as a maximum: sped-up clips drop frames down to it, like the web export.
            val maxFps = ceil(plan.settings.fps.num.toDouble() / plan.settings.fps.den).toInt()
            val video = EditedMediaItemSequence.Builder(setOf(C.TRACK_TYPE_VIDEO))
            for (slot in withGaps(plan.video, plan.durationUs, { it.startUs }, { it.endUs })) {
                when (slot) {
                    is Slot.Gap -> video.addGap(slot.durationUs)
                    is Slot.Item -> video.addItem(
                        item(slot.segment.uri, slot.segment.sourceInUs, slot.segment.sourceOutUs, slot.segment.speed)
                            .setRemoveAudio(true)
                            .setFrameRate(maxFps)
                            .build(),
                    )
                }
            }

            val audio = audioLanes(plan.audio).map { lane ->
                val sequence = EditedMediaItemSequence.Builder(setOf(C.TRACK_TYPE_AUDIO))
                for (slot in withGaps(lane, plan.durationUs, { it.startUs }, { it.endUs })) {
                    when (slot) {
                        is Slot.Gap -> sequence.addGap(slot.durationUs)
                        is Slot.Item -> {
                            val s = slot.segment
                            val gain = SegmentGainProcessor(s.endUs - s.startUs, s.volume, s.fadeInUs, s.fadeOutUs)
                            val shift = if (s.sourceInUs > 0) sourceDelayUs(s.uri) else 0
                            sequence.addItem(
                                item(s.uri, s.sourceInUs + shift, s.sourceOutUs + shift, s.speed)
                                    .setRemoveVideo(true)
                                    .setEffects(Effects(listOf(gain), emptyList()))
                                    .build(),
                            )
                        }
                    }
                }
                sequence.build()
            }

            val (width, height) = evenSize(plan.settings.width, plan.settings.height)
            return Composition.Builder(listOf(video.build()) + audio)
                .setEffects(Effects(emptyList(), listOf(Presentation.createForWidthAndHeight(width, height, Presentation.LAYOUT_SCALE_TO_FIT))))
                .build()
        }

        private fun item(uri: String, sourceInUs: Long, sourceOutUs: Long, speed: Double): EditedMediaItem.Builder {
            val mediaItem = MediaItem.Builder()
                .setUri(uri)
                .setClippingConfiguration(
                    MediaItem.ClippingConfiguration.Builder()
                        .setStartPositionUs(sourceInUs)
                        .setEndPositionUs(sourceOutUs)
                        .build(),
                )
                .build()
            val builder = EditedMediaItem.Builder(mediaItem)
            if (speed != 1.0) builder.setSpeed(ConstantSpeed(speed.toFloat()))
            return builder
        }
    }
}

private class ConstantSpeed(private val speed: Float) : SpeedProvider {
    override fun getSpeed(timeUs: Long): Float = speed
    override fun getNextSpeedChangeTimeUs(timeUs: Long): Long = C.TIME_UNSET
}

@UnstableApi
private fun ExportResult.toSummary() = ExportSummary(
    durationMs = approximateDurationMs,
    fileSizeBytes = fileSizeBytes,
    width = width,
    height = height,
    videoFrameCount = videoFrameCount,
    videoMimeType = videoMimeType,
    audioMimeType = audioMimeType,
)
