package dev.cutiva.expo

import android.content.Context
import android.os.Looper
import androidx.media3.common.util.UnstableApi
import dev.cutiva.engine.CutivaException
import dev.cutiva.engine.CutivaExporter
import dev.cutiva.engine.ExportSummary
import dev.cutiva.engine.ExportTask
import dev.cutiva.engine.RenderPlan
import dev.cutiva.engine.reframe.AnalyzeOptions
import dev.cutiva.engine.reframe.FaceModel
import dev.cutiva.engine.reframe.MediaPipeFaceDetector
import dev.cutiva.engine.reframe.ReframeAnalyzer
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/**
 * The native side of `@cutiva/expo` (ADR 0007): analysis for auto-reframe and export of a render
 * plan, on the Cutiva Android engine. Planning happens in JavaScript with `@cutiva/core`; this only
 * measures and draws. Errors reject with the engine's stable codes (`MODEL_LOAD_FAILED`,
 * `NO_VIDEO_TRACK`, `ANALYSIS_CANCELLED`, `EXPORT_FAILED`, ...).
 */
@UnstableApi
class CutivaModule : Module() {
    private val cancelled = ConcurrentHashMap<String, AtomicBoolean>()
    private val exports = ConcurrentHashMap<String, ExportTask>()

    private val context: Context
        get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

    private fun progress(job: String, ratio: Double, stage: String) =
        sendEvent("onProgress", mapOf("job" to job, "ratio" to ratio, "stage" to stage))

    private fun reject(promise: Promise, e: Throwable) {
        val code = (e as? CutivaException)?.code ?: "UNKNOWN"
        promise.reject(code, e.message ?: code, e)
    }

    override fun definition() = ModuleDefinition {
        Name("Cutiva")
        Events("onProgress")

        /** Measures a video for auto-reframe; resolves with the measurements as JSON text. */
        AsyncFunction("analyze") { uri: String, options: Map<String, Any?>, job: String, promise: Promise ->
            val flag = AtomicBoolean(false).also { cancelled[job] = it }
            val ctx = context
            thread(name = "cutiva-analyze") {
                try {
                    val model = FaceModel.load(ctx) { progress(job, it, "model") }
                    val opts = AnalyzeOptions(
                        fps = (options["fps"] as? Number)?.toInt() ?: 5,
                        width = (options["width"] as? Number)?.toInt() ?: 640,
                        fromUs = (options["fromUs"] as? Number)?.toLong() ?: 0,
                        toUs = (options["toUs"] as? Number)?.toLong() ?: -1,
                    )
                    val m = MediaPipeFaceDetector(ctx, model).use { detector ->
                        ReframeAnalyzer(ctx).analyze(uri, detector, opts, { r, stage -> progress(job, r, stage) }, { flag.get() })
                    }
                    promise.resolve(m.toJson().toString())
                } catch (e: Throwable) {
                    reject(promise, e)
                } finally {
                    cancelled.remove(job)
                }
            }
        }

        /** Exports a render plan (JSON from `renderPlan`) to an MP4; resolves with its file URI and size. */
        AsyncFunction("export") { planJson: String, outputPath: String?, job: String, promise: Promise ->
            val ctx = context
            val plan = try {
                RenderPlan.fromJson(planJson)
            } catch (e: Throwable) {
                reject(promise, e)
                return@AsyncFunction
            }
            val out = outputPath?.takeIf { it.isNotEmpty() }?.removePrefix("file://")
                ?: File(ctx.cacheDir, "cutiva-${System.currentTimeMillis()}.mp4").absolutePath
            val task = CutivaExporter(ctx, Looper.getMainLooper()).export(plan, out, object : CutivaExporter.Listener {
                override fun onProgress(fraction: Float) = progress(job, fraction.toDouble(), "export")

                override fun onCompleted(summary: ExportSummary) {
                    exports.remove(job)
                    promise.resolve(mapOf("uri" to File(out).toURI().toString(), "durationMs" to summary.durationMs, "fileSizeBytes" to summary.fileSizeBytes))
                }

                override fun onError(error: CutivaException) {
                    exports.remove(job)
                    reject(promise, error)
                }
            })
            exports[job] = task
        }

        /** Stops a running analysis or export; its promise rejects with `ANALYSIS_CANCELLED` or `EXPORT_CANCELLED`. */
        Function("cancel") { job: String ->
            cancelled[job]?.set(true)
            exports.remove(job)?.cancel()
        }
    }
}
