package dev.cutiva.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class EncoderDelayTest {
    @Test
    fun findsWhereTheBurstLands() {
        val input = EncoderDelay.noise(8192)
        for (delay in listOf(0, 1024, 1600, 2048, 2112)) {
            val output = FloatArray(delay) + input.map { it * 0.7f }.toFloatArray()
            assertEquals(delay, EncoderDelay.bestLag(input, output))
        }
    }

    @Test
    fun givesUpOnSilence() {
        assertNull(EncoderDelay.bestLag(EncoderDelay.noise(8192), FloatArray(12_000)))
    }

    @Test
    fun noiseIsTheSameEveryTime() {
        assertEquals(EncoderDelay.noise(16).toList(), EncoderDelay.noise(16).toList())
    }
}
