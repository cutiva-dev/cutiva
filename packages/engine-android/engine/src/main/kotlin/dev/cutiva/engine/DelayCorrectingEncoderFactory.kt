package dev.cutiva.engine

import android.media.metrics.LogSessionId
import androidx.media3.common.Format
import androidx.media3.common.util.UnstableApi
import androidx.media3.transformer.Codec

/**
 * Wraps an encoder factory so audio encoders report their measured priming as the output format's
 * encoder delay. Media3 uses that value both to shift audio timestamps and to write the MP4 edit list.
 */
@UnstableApi
internal class DelayCorrectingEncoderFactory(private val inner: Codec.EncoderFactory) : Codec.EncoderFactory by inner {
    override fun createForAudioEncoding(format: Format, logSessionId: LogSessionId?): Codec {
        val codec = inner.createForAudioEncoding(format, logSessionId)
        val delay = EncoderDelay.samples(codec.name, format.sampleRate, format.channelCount) ?: return codec
        return object : Codec by codec {
            override fun getOutputFormat(): Format? = codec.outputFormat?.buildUpon()?.setEncoderDelay(delay)?.build()
        }
    }
}
