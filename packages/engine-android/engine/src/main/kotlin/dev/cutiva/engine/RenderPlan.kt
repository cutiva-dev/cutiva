package dev.cutiva.engine

import org.json.JSONException
import org.json.JSONObject

/** A frame rate as a fraction, like 30000/1001. */
data class Fps(val num: Int, val den: Int)

data class PlanSettings(val width: Int, val height: Int, val fps: Fps, val sampleRate: Int)

/** One video clip on the timeline. All times are integer microseconds. */
data class VideoSegment(
    /** Position among the video tracks: 0 is the bottom, higher layers draw on top. */
    val layer: Int,
    val trackId: String,
    val clipId: String,
    val assetId: String,
    val uri: String,
    /** Visible during `[startUs, endUs)` on the timeline. */
    val startUs: Long,
    val endUs: Long,
    val sourceInUs: Long,
    val sourceOutUs: Long,
    val speed: Double,
)

/** One piece of sound on the timeline. Fades are in timeline time. */
data class AudioSegment(
    val clipId: String,
    val assetId: String,
    val uri: String,
    val startUs: Long,
    val endUs: Long,
    val sourceInUs: Long,
    val sourceOutUs: Long,
    val speed: Double,
    val volume: Double,
    val fadeInUs: Long,
    val fadeOutUs: Long,
)

/**
 * What plays where, as computed by `renderPlan(project)` in `@cutiva/core` or `cutiva_core` (ADR 0004).
 * The engine renders it as is and applies no edit rules of its own.
 */
data class RenderPlan(
    val durationUs: Long,
    val settings: PlanSettings,
    val video: List<VideoSegment>,
    val audio: List<AudioSegment>,
) {
    companion object {
        /** Parse the JSON that `renderPlan` produces. Throws [CutivaException] with `INVALID_PROJECT`. */
        @JvmStatic
        fun fromJson(json: String): RenderPlan =
            try {
                parse(JSONObject(json))
            } catch (e: JSONException) {
                throw CutivaException("INVALID_PROJECT", "Invalid render plan: ${e.message}", e)
            }

        private fun parse(o: JSONObject): RenderPlan {
            val s = o.getJSONObject("settings")
            val fps = s.getJSONObject("fps")
            val video = o.getJSONArray("video")
            val audio = o.getJSONArray("audio")
            return RenderPlan(
                durationUs = o.getLong("durationUs"),
                settings = PlanSettings(s.getInt("width"), s.getInt("height"), Fps(fps.getInt("num"), fps.getInt("den")), s.getInt("sampleRate")),
                video = List(video.length()) { i ->
                    val v = video.getJSONObject(i)
                    VideoSegment(
                        layer = v.getInt("layer"),
                        trackId = v.getString("trackId"),
                        clipId = v.getString("clipId"),
                        assetId = v.getString("assetId"),
                        uri = v.getString("uri"),
                        startUs = v.getLong("startUs"),
                        endUs = v.getLong("endUs"),
                        sourceInUs = v.getLong("sourceInUs"),
                        sourceOutUs = v.getLong("sourceOutUs"),
                        speed = v.getDouble("speed"),
                    )
                },
                audio = List(audio.length()) { i ->
                    val a = audio.getJSONObject(i)
                    AudioSegment(
                        clipId = a.getString("clipId"),
                        assetId = a.getString("assetId"),
                        uri = a.getString("uri"),
                        startUs = a.getLong("startUs"),
                        endUs = a.getLong("endUs"),
                        sourceInUs = a.getLong("sourceInUs"),
                        sourceOutUs = a.getLong("sourceOutUs"),
                        speed = a.getDouble("speed"),
                        volume = a.getDouble("volume"),
                        fadeInUs = a.getLong("fadeInUs"),
                        fadeOutUs = a.getLong("fadeOutUs"),
                    )
                },
            )
        }
    }
}
