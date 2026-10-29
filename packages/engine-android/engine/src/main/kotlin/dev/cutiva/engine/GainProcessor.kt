package dev.cutiva.engine

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor.AudioFormat
import androidx.media3.common.audio.AudioProcessor.StreamMetadata
import androidx.media3.common.audio.AudioProcessor.UnhandledAudioFormatException
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.common.util.UnstableApi
import java.nio.ByteBuffer

/**
 * Applies a segment's volume and fades. Runs after the speed change, so positions are timeline time.
 * Volume can go up to 4; 16-bit samples are clipped instead of wrapping around.
 */
@UnstableApi
internal class SegmentGainProcessor(
    private val durationUs: Long,
    private val volume: Double,
    private val fadeInUs: Long,
    private val fadeOutUs: Long,
) : BaseAudioProcessor() {
    private var frame = 0L

    override fun onConfigure(inputAudioFormat: AudioFormat): AudioFormat {
        if (inputAudioFormat.encoding != C.ENCODING_PCM_16BIT && inputAudioFormat.encoding != C.ENCODING_PCM_FLOAT) {
            throw UnhandledAudioFormatException(inputAudioFormat)
        }
        return inputAudioFormat
    }

    override fun isActive(): Boolean = super.isActive() && (volume != 1.0 || fadeInUs > 0 || fadeOutUs > 0)

    override fun queueInput(inputBuffer: ByteBuffer) {
        val format = inputAudioFormat
        val frames = inputBuffer.remaining() / format.bytesPerFrame
        val out = replaceOutputBuffer(inputBuffer.remaining())
        repeat(frames) {
            val gain = gainAt(frame * 1_000_000L / format.sampleRate, durationUs, volume, fadeInUs, fadeOutUs)
            repeat(format.channelCount) {
                if (format.encoding == C.ENCODING_PCM_16BIT) {
                    val v = inputBuffer.getShort() * gain
                    out.putShort(v.coerceIn(Short.MIN_VALUE.toDouble(), Short.MAX_VALUE.toDouble()).toInt().toShort())
                } else {
                    out.putFloat((inputBuffer.getFloat() * gain).toFloat())
                }
            }
            frame++
        }
        out.flip()
    }

    override fun onFlush(streamMetadata: StreamMetadata) {
        frame = streamMetadata.positionOffsetUs * inputAudioFormat.sampleRate / 1_000_000L
    }

    override fun onReset() {
        frame = 0
    }
}
