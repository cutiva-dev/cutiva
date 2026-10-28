/** Audio codecs export can use, with their WebCodecs codec strings. */
export type ExportAudioCodec = "aac" | "opus";
const CODEC_STRINGS: Record<ExportAudioCodec, string> = { aac: "mp4a.40.2", opus: "opus" };
const PROBE_FRAMES = 8192;
const MAX_LAG = 4096;
const WINDOW = 2048;

const cache = new Map<string, Promise<number>>();

/**
 * Audio encoders prepend "priming" samples (2112 with Apple's AAC encoder) and WebCodecs passes
 * them through, so encoded audio plays late unless the muxer is told to skip them with an edit
 * list. The amount depends on the codec and the platform encoder, so measure it once per codec and
 * sample rate: encode a known noise burst, decode it the way a player would (Opus pre-skip
 * included), and find where it lands in presentation time.
 * Returns the delay in samples, or 0 when it can't be measured.
 */
export function encoderDelay(codec: ExportAudioCodec, sampleRate: number): Promise<number> {
  const key = `${codec}@${sampleRate}`;
  let delay = cache.get(key);
  if (!delay) {
    delay = measure(codec, sampleRate).catch((error: unknown) => {
      console.warn(`Cutiva: could not measure the ${codec} encoder delay; exported audio may start a few tens of ms late.`, error);
      return 0;
    });
    cache.set(key, delay);
  }
  return delay;
}

function noise(frames: number): Float32Array {
  const out = new Float32Array(frames);
  let seed = 0x2545f491;
  for (let i = 0; i < frames; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    out[i] = (seed / 0xffffffff - 0.5) * 0.8;
  }
  return out;
}

/** AudioSpecificConfig for AAC-LC. */
function aacDescription(sampleRate: number, channels: number): Uint8Array {
  const rates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
  const index = rates.indexOf(sampleRate);
  if (index < 0) throw new Error(`No AAC frequency index for ${sampleRate} Hz.`);
  const bits = (2 << 11) | (index << 7) | (channels << 3);
  return new Uint8Array([bits >> 8, bits & 0xff]);
}

/**
 * The first channel of decoded audio as floats. Safari's AudioData.copyTo can't convert between
 * sample formats, so read the decoder's own format and convert here.
 */
function firstChannel(data: AudioData): Float32Array {
  const frames = data.numberOfFrames;
  const out = new Float32Array(frames);
  try {
    data.copyTo(out, { planeIndex: 0, format: "f32-planar" });
    return out;
  } catch {
    // Fall through to a copy in the native format.
  }
  const format = data.format;
  if (!format) throw new Error("Decoded audio has no sample format.");
  const stride = format.endsWith("-planar") ? 1 : data.numberOfChannels;
  const bytes = new ArrayBuffer(data.allocationSize({ planeIndex: 0 }));
  data.copyTo(bytes, { planeIndex: 0 });
  const read: (i: number) => number = format.startsWith("f32")
    ? ((v) => (i) => v[i]!)(new Float32Array(bytes))
    : format.startsWith("s16")
      ? ((v) => (i) => v[i]! / 32768)(new Int16Array(bytes))
      : format.startsWith("s32")
        ? ((v) => (i) => v[i]! / 2147483648)(new Int32Array(bytes))
        : ((v) => (i) => (v[i]! - 128) / 128)(new Uint8Array(bytes));
  for (let i = 0; i < frames; i++) out[i] = read(i * stride);
  return out;
}

async function measure(codec: ExportAudioCodec, sampleRate: number): Promise<number> {
  if (typeof AudioEncoder === "undefined" || typeof AudioDecoder === "undefined") return 0;
  const channels = 2;
  const config = { codec: CODEC_STRINGS[codec], sampleRate, numberOfChannels: channels, bitrate: 128_000 };
  if (!(await AudioEncoder.isConfigSupported(config)).supported) return 0;

  const input = noise(PROBE_FRAMES);
  const chunks: EncodedAudioChunk[] = [];
  let description: AllowSharedBufferSource | undefined;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      chunks.push(chunk);
      description ??= meta?.decoderConfig?.description;
    },
    error: () => undefined,
  });
  encoder.configure(config);
  const planar = new Float32Array(PROBE_FRAMES * channels);
  for (let c = 0; c < channels; c++) planar.set(input, c * PROBE_FRAMES);
  const data = new AudioData({ format: "f32-planar", sampleRate, numberOfChannels: channels, numberOfFrames: PROBE_FRAMES, timestamp: 0, data: planar });
  encoder.encode(data);
  data.close();
  await encoder.flush();
  encoder.close();
  if (!chunks.length) return 0;

  const decoded: Float32Array[] = [];
  const decoder = new AudioDecoder({
    output: (d) => {
      decoded.push(firstChannel(d));
      d.close();
    },
    error: () => undefined,
  });
  decoder.configure({
    codec: CODEC_STRINGS[codec],
    sampleRate,
    numberOfChannels: channels,
    // For AAC, describe the stream ourselves: the encoder was set to AAC-LC, and Safari's encoder
    // reports a description its own decoder rejects ("InternalAudioDecoderCocoa decoding failed").
    ...(codec === "aac" ? { description: aacDescription(sampleRate, channels) } : description ? { description } : {}),
  });
  for (const c of chunks) decoder.decode(c);
  await decoder.flush();
  decoder.close();

  const output = new Float32Array(decoded.reduce((n, d) => n + d.length, 0));
  let at = 0;
  for (const d of decoded) {
    output.set(d, at);
    at += d.length;
  }

  // Cross-correlate a window from the middle of the burst, away from the start transient.
  let bestLag = -1;
  let best = 0;
  let energyIn = 0;
  for (let i = 0; i < WINDOW; i++) energyIn += input[WINDOW + i]! ** 2;
  for (let lag = 0; lag <= MAX_LAG && WINDOW * 2 + lag <= output.length; lag++) {
    let dot = 0;
    let energyOut = 0;
    for (let i = 0; i < WINDOW; i++) {
      const o = output[WINDOW + lag + i]!;
      dot += input[WINDOW + i]! * o;
      energyOut += o * o;
    }
    const score = energyOut > 0 ? dot / Math.sqrt(energyIn * energyOut) : 0;
    if (score > best) {
      best = score;
      bestLag = lag;
    }
  }
  if (bestLag < 0 || best < 0.5) return 0;

  // Encoders that already stamp the first chunk before zero have compensated by that much.
  const firstTimestampSamples = Math.round((chunks[0]!.timestamp * sampleRate) / 1e6);
  return Math.max(0, bestLag + firstTimestampSamples);
}
