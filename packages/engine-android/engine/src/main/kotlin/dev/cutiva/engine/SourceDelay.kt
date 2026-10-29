package dev.cutiva.engine

import android.content.Context
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.inspector.MetadataRetriever
import java.util.concurrent.TimeUnit

/**
 * When Media3 cuts an AAC input at a point after 0, its audio comes out one AAC frame (1024 samples)
 * late, wherever the cut falls. Measured on Media3 1.11.1 (emulator, API 35): a clip starting at 0
 * is exact; starting at 10 ms, 250 ms, 1 s or 1.33 s, the sound is 21.4 ms late at 48 kHz. So clips
 * that start after 0 are cut one frame later. `ExportTest` checks this on every run.
 */
@UnstableApi
internal object SourceDelay {
    private const val AAC_FRAME_SAMPLES = 1024L

    /** How much later to cut audio from [uri] when a clip starts after 0, in microseconds. */
    fun us(context: Context, uri: String): Long {
        MetadataRetriever.Builder(context, MediaItem.fromUri(uri)).build().use { retriever ->
            val groups = retriever.retrieveTrackGroups().get(10, TimeUnit.SECONDS)
            for (g in 0 until groups.length) {
                val group = groups[g]
                if (group.type != C.TRACK_TYPE_AUDIO) continue
                val format = group.getFormat(0)
                if (format.sampleMimeType != MimeTypes.AUDIO_AAC || format.sampleRate <= 0) return 0
                return AAC_FRAME_SAMPLES * 1_000_000L / format.sampleRate
            }
        }
        return 0
    }
}
