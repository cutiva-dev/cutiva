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
    delay = measure(codec, sampleRate).catch(() => 0);
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

/** Minimal AudioSpecificConfig for AAC-LC, for encoders that don't provide one. */
function aacDescription(sampleRate: number, channels: number): Uint8Array {
  const rates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
  const index = rates.indexOf(sampleRate);
  if (index < 0) throw new Error(`No AAC frequency index for ${sampleRate} Hz.`);
  const bits = (2 << 11) | (index << 7) | (channels << 3);
  return new Uint8Array([bits >> 8, bits & 0xff]);
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
      const ch = new Float32Array(d.numberOfFrames);
      d.copyTo(ch, { planeIndex: 0, format: "f32-planar" });
      decoded.push(ch);
      d.close();
    },
    error: () => undefined,
  });
  decoder.configure({
    codec: CODEC_STRINGS[codec],
    sampleRate,
    numberOfChannels: channels,
    ...(description ? { description } : codec === "aac" ? { description: aacDescription(sampleRate, channels) } : {}),
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
