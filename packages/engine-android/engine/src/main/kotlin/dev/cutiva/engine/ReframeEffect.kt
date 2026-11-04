package dev.cutiva.engine

import android.content.Context
import android.opengl.GLES20
import androidx.media3.common.util.GlProgram
import androidx.media3.common.util.GlUtil
import androidx.media3.common.util.Size
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.BaseGlShaderProgram
import androidx.media3.effect.GlEffect
import androidx.media3.effect.GlShaderProgram
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** Width the wide layout's background is shrunk to before it is stretched back: the blur (as `draw.ts`). */
private const val BLUR_W = 32

/** How much the wide layout's background is darkened (as `draw.ts`). */
private const val BLUR_DIM = 0.35f

/**
 * Draws a reframed clip's frames at the output size, the way `drawLayer` in `@cutiva/web` does:
 * the crop rectangle filling the frame; a split's two regions filling the top and bottom halves; or
 * wide, the area letterboxed over a blurred, darkened copy that covers the frame. [sourceTimeUs]
 * turns a frame's presentation time into the source time the keys are in.
 */
@UnstableApi
internal class ReframeEffect(
    private val keys: List<CropKey>,
    private val sourceWidth: Int,
    private val sourceHeight: Int,
    private val outWidth: Int,
    private val outHeight: Int,
    private val sourceTimeUs: (presentationTimeUs: Long) -> Long,
) : GlEffect {
    override fun toGlShaderProgram(context: Context, useHdr: Boolean): GlShaderProgram =
        ReframeShaderProgram(keys, sourceWidth, sourceHeight, outWidth, outHeight, sourceTimeUs, useHdr)
}

@UnstableApi
private class ReframeShaderProgram(
    private val keys: List<CropKey>,
    private val sourceWidth: Int,
    private val sourceHeight: Int,
    private val outWidth: Int,
    private val outHeight: Int,
    private val sourceTimeUs: (Long) -> Long,
    useHdr: Boolean,
) : BaseGlShaderProgram(useHdr, 1) {
    private val program = GlProgram(VERTEX, FRAGMENT).apply {
        setBufferAttribute("aFramePosition", GlUtil.getNormalizedCoordinateBounds(), GlUtil.HOMOGENEOUS_COORDINATE_VECTOR_SIZE)
    }
    private var inputWidth = 0
    private var inputHeight = 0

    /** The blur's halving chain: textures and their framebuffers, largest first, ending at [BLUR_W] wide. */
    private class Target(val tex: Int, val fbo: Int, val w: Int, val h: Int)
    private var chain: List<Target> = emptyList()

    override fun configure(inputWidth: Int, inputHeight: Int): Size {
        this.inputWidth = inputWidth
        this.inputHeight = inputHeight
        return Size(outWidth, outHeight)
    }

    private fun blurChain(): List<Target> {
        if (chain.isNotEmpty()) return chain
        // Halve from about the widest background the input can give down to BLUR_W, so each pass
        // averages 2 × 2 pixels with bilinear sampling and nothing aliases (a canvas does the same).
        val widest = min(inputWidth.toDouble(), inputHeight * outWidth.toDouble() / outHeight)
        var w = BLUR_W
        val widths = mutableListOf(w)
        while (w * 2 <= widest) {
            w *= 2
            widths.add(0, w)
        }
        chain = widths.map { tw ->
            val th = max(1, (tw.toDouble() * outHeight / outWidth).roundToInt())
            val tex = GlUtil.createTexture(tw, th, false)
            Target(tex, GlUtil.createFboForTexture(tex), tw, th)
        }
        return chain
    }

    /** Draws [src] (texture pixels of a [texW] × [texH] texture, top-left origin) into [dst] (pixels of a [fbW] × [fbH] target). */
    private fun quad(tex: Int, texW: Int, texH: Int, src: FloatArray, fbW: Int, fbH: Int, dst: FloatArray, gain: Float) {
        val (sx, sy, sw, sh) = src
        val (dx, dy, dw, dh) = dst
        program.use()
        program.setSamplerTexIdUniform("uTexSampler", tex, 0)
        // Texture rows run bottom to top in GL: v = 1 is the picture's top.
        program.setFloatsUniform("uSrc", floatArrayOf(sx / texW, 1 - (sy + sh) / texH, (sx + sw) / texW, 1 - sy / texH))
        program.setFloatsUniform("uDst", floatArrayOf(2 * dx / fbW - 1, 1 - 2 * (dy + dh) / fbH, 2 * (dx + dw) / fbW - 1, 1 - 2 * dy / fbH))
        program.setFloatUniform("uGain", gain)
        program.bindAttributesAndUniforms()
        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
        GlUtil.checkGlError()
    }

    override fun drawFrame(inputTexId: Int, presentationTimeUs: Long) {
        val s = sourceTimeUs(presentationTimeUs)
        val sx = inputWidth.toFloat() / sourceWidth
        val sy = inputHeight.toFloat() / sourceHeight
        fun scaled(r: CropRect) = floatArrayOf(r.x * sx, r.y * sy, r.w * sx, r.h * sy)
        val out = floatArrayOf(0f, 0f, outWidth.toFloat(), outHeight.toFloat())
        when (val layout = layoutAt(keys, s)) {
            null -> quad(inputTexId, inputWidth, inputHeight, scaled(cropAt(keys, s)), outWidth, outHeight, out, 1f)
            is CropLayout.Split -> {
                val topH = (outHeight / 2.0).roundToInt().toFloat()
                quad(inputTexId, inputWidth, inputHeight, scaled(layout.top), outWidth, outHeight, floatArrayOf(0f, 0f, outWidth.toFloat(), topH), 1f)
                quad(inputTexId, inputWidth, inputHeight, scaled(layout.bottom), outWidth, outHeight, floatArrayOf(0f, topH, outWidth.toFloat(), outHeight - topH), 1f)
            }
            is CropLayout.Wide -> drawWide(inputTexId, scaled(layout.area), out)
        }
    }

    private fun drawWide(inputTexId: Int, area: FloatArray, out: FloatArray) {
        val (ax, ay, aw, ah) = area
        val fw = outWidth.toFloat()
        val fh = outHeight.toFloat()
        // Background: the part of the area with the frame's aspect, centred ("cover").
        val frameAspect = fw / fh
        val cw = if (aw / ah > frameAspect) ah * frameAspect else aw
        val ch = if (aw / ah > frameAspect) ah else aw / frameAspect
        val outFbo = IntArray(1).also { GLES20.glGetIntegerv(GLES20.GL_FRAMEBUFFER_BINDING, it, 0) }[0]
        var prev: Target? = null
        for (t in blurChain()) {
            GlUtil.focusFramebufferUsingCurrentContext(t.fbo, t.w, t.h)
            val dst = floatArrayOf(0f, 0f, t.w.toFloat(), t.h.toFloat())
            if (prev == null) {
                quad(inputTexId, inputWidth, inputHeight, floatArrayOf(ax + (aw - cw) / 2, ay + (ah - ch) / 2, cw, ch), t.w, t.h, dst, 1f)
            } else {
                quad(prev.tex, prev.w, prev.h, floatArrayOf(0f, 0f, prev.w.toFloat(), prev.h.toFloat()), t.w, t.h, dst, 1f)
            }
            prev = t
        }
        GlUtil.focusFramebufferUsingCurrentContext(outFbo, outWidth, outHeight)
        val small = prev!!
        quad(small.tex, small.w, small.h, floatArrayOf(0f, 0f, small.w.toFloat(), small.h.toFloat()), outWidth, outHeight, out, 1 - BLUR_DIM)
        // Foreground: the whole area, letterboxed.
        val scale = min(fw / aw, fh / ah)
        val w = aw * scale
        val h = ah * scale
        quad(inputTexId, inputWidth, inputHeight, area, outWidth, outHeight, floatArrayOf((fw - w) / 2, (fh - h) / 2, w, h), 1f)
    }

    override fun release() {
        super.release()
        for (t in chain) {
            GlUtil.deleteFbo(t.fbo)
            GlUtil.deleteTexture(t.tex)
        }
        chain = emptyList()
        program.delete()
    }

    private companion object {
        const val VERTEX = """
            attribute vec4 aFramePosition;
            uniform vec4 uSrc;
            uniform vec4 uDst;
            varying vec2 vTexCoord;
            void main() {
              vec2 t = (aFramePosition.xy + 1.0) * 0.5;
              gl_Position = vec4(mix(uDst.xy, uDst.zw, t), 0.0, 1.0);
              vTexCoord = mix(uSrc.xy, uSrc.zw, t);
            }
        """
        const val FRAGMENT = """
            precision highp float;
            uniform sampler2D uTexSampler;
            uniform float uGain;
            varying vec2 vTexCoord;
            void main() {
              vec4 c = texture2D(uTexSampler, vTexCoord);
              gl_FragColor = vec4(c.rgb * uGain, 1.0);
            }
        """
    }
}
