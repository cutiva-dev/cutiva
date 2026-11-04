package dev.cutiva.engine.reframe

import android.util.Log
import androidx.media3.common.util.UnstableApi
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * Opt-in: analyses a real video with MediaPipe and writes the measurements to the test app's cache
 * (`real-analysis.json`), to compare with the web's analysis of the same file. Skipped unless the
 * runner gets `-e video <uri>`; real footage is never committed (see fixtures/manifest.json).
 */
@UnstableApi
@RunWith(AndroidJUnit4::class)
class RealVideoBenchmark {
    @Test
    fun analyseRealVideo() {
        val uri = InstrumentationRegistry.getArguments().getString("video")
        assumeTrue("pass -e video <uri> to run", uri != null)
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val start = System.nanoTime()
        val m = MediaPipeFaceDetector(context, FaceModel.load(context)).use { ReframeAnalyzer(context).analyze(uri!!, it) }
        val seconds = (System.nanoTime() - start) / 1e9
        File(context.cacheDir, "real-analysis.json").writeText(m.toJson().toString())
        Log.i("CutivaBenchmark", "analysed ${m.durationUs / 1e6} s of video in $seconds s, ${m.frames.size} frames, ${m.frames.sumOf { it.faces.size }} faces")
    }
}
