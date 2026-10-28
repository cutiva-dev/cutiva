import { EncodedPacketSink, VideoSampleSink, type InputVideoTrack, type VideoSample } from "mediabunny";

/** A decoded preview frame. Times are in seconds. */
export interface Frame {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  timestamp: number;
  duration: number;
}

interface Cached {
  frame: Frame;
  used: number;
}

/** Evicted canvases kept for reuse, per asset. */
const SPARE_CANVASES = 8;

/** Memory shared by the frame caches of several assets; the least recently used frame goes first. */
export class FrameBudget {
  clock = 0;
  bytes = 0;
  readonly servers = new Set<FrameServer>();
  constructor(readonly limitBytes = 192 * 1024 * 1024) {}

  /** Evict until under the limit. */
  trim(): void {
    while (this.bytes > this.limitBytes) {
      let victim: FrameServer | null = null;
      let oldest = Infinity;
      for (const s of this.servers) {
        const used = s.oldestUse();
        if (used < oldest) {
          oldest = used;
          victim = s;
        }
      }
      if (!victim) return;
      victim.evictOldest();
    }
  }
}

/**
 * Preview frames for one video asset. Seeking decodes from the previous keyframe, which is slow on
 * long-GOP phone video, so this keeps one decoder running forward and caches every frame it decodes:
 * playback and forward scrubs continue the running decoder, and going back over seen frames is a
 * cache hit. Times are in seconds, like Mediabunny's.
 */
export class FrameServer {
  private readonly sink: VideoSampleSink;
  private readonly packets: EncodedPacketSink;
  private readonly width: number;
  private readonly height: number;
  private readonly frameBytes: number;
  /** Sorted by timestamp. */
  private cached: Cached[] = [];
  /** Evicted canvases, reused so playback doesn't allocate (and garbage-collect) a canvas per frame. */
  private spare: Frame["canvas"][] = [];
  private decoder: { samples: AsyncGenerator<VideoSample>; last: number } | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    track: InputVideoTrack,
    maxWidth: number,
    private readonly budget = new FrameBudget(),
  ) {
    this.width = Math.min(maxWidth, track.displayWidth);
    this.height = Math.max(1, Math.round((this.width * track.displayHeight) / track.displayWidth));
    this.sink = new VideoSampleSink(track);
    this.packets = new EncodedPacketSink(track);
    this.frameBytes = this.width * this.height * 4;
    budget.servers.add(this);
  }

  /** The frame shown at `time` seconds, or null before the first frame. Calls run one at a time. */
  frameAt(time: number): Promise<Frame | null> {
    const result = this.queue.then(() => this.load(time));
    this.queue = result.catch(() => undefined);
    return result;
  }

  /** Stop decoding and drop the cache. */
  dispose(): void {
    void this.decoder?.samples.return(undefined);
    this.decoder = null;
    this.budget.bytes -= this.cached.length * this.frameBytes;
    this.cached = [];
    this.spare = [];
    this.budget.servers.delete(this);
  }

  /** @internal Last use of this server's least recently used frame, or Infinity when empty. */
  oldestUse(): number {
    let oldest = Infinity;
    for (const c of this.cached) if (c.used < oldest) oldest = c.used;
    return oldest;
  }

  /** @internal */
  evictOldest(): void {
    let index = -1;
    let oldest = Infinity;
    this.cached.forEach((c, i) => {
      if (c.used < oldest) {
        oldest = c.used;
        index = i;
      }
    });
    if (index < 0) return;
    const [evicted] = this.cached.splice(index, 1);
    this.recycle(evicted!.frame.canvas);
    this.budget.bytes -= this.frameBytes;
  }

  private async load(time: number): Promise<Frame | null> {
    const hit = this.lookup(time);
    if (hit) return hit;

    const key = (await this.packets.getKeyPacket(time, { metadataOnly: true })) ?? (await this.packets.getFirstPacket({ metadataOnly: true }));
    if (!key) return null;
    // Continuing is cheaper than seeking unless a keyframe lies between the decoder and the target.
    if (!this.decoder || time < this.decoder.last || key.timestamp > this.decoder.last) {
      void this.decoder?.samples.return(undefined);
      this.decoder = { samples: this.sink.samples(key.timestamp), last: -Infinity };
    }

    let latest: Frame | null = null;
    for (;;) {
      const next = await this.decoder.samples.next();
      if (next.done) {
        this.decoder = null;
        return latest ?? this.lookup(time, true);
      }
      const frame = this.toFrame(next.value);
      this.decoder.last = frame.timestamp;
      this.store(frame);
      latest = frame;
      if (time < frame.timestamp + frame.duration) return frame;
    }
  }

  /** Cached frame covering `time`; with `orBefore`, the closest earlier one (for times past the end). */
  private lookup(time: number, orBefore = false): Frame | null {
    let lo = 0;
    let hi = this.cached.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.cached[mid]!.frame.timestamp <= time) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    const entry = this.cached[found];
    if (!entry) return null;
    if (!orBefore && time >= entry.frame.timestamp + entry.frame.duration) return null;
    entry.used = ++this.budget.clock;
    return entry.frame;
  }

  /** Draw a decoded sample into a (reused) canvas and release the sample. */
  private toFrame(sample: VideoSample): Frame {
    const canvas =
      this.spare.pop() ??
      (typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(this.width, this.height)
        : Object.assign(document.createElement("canvas"), { width: this.width, height: this.height }));
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    sample.drawWithFit(ctx, { fit: "fill" });
    const frame = { canvas, timestamp: sample.timestamp, duration: sample.duration };
    sample.close();
    return frame;
  }

  private recycle(canvas: Frame["canvas"]): void {
    if (this.spare.length < SPARE_CANVASES) this.spare.push(canvas);
  }

  private store(frame: Frame): void {
    let i = this.cached.length;
    while (i > 0 && this.cached[i - 1]!.frame.timestamp >= frame.timestamp) i--;
    if (this.cached[i]?.frame.timestamp === frame.timestamp) {
      this.recycle(this.cached[i]!.frame.canvas);
      this.cached[i] = { frame, used: ++this.budget.clock };
      return;
    }
    this.cached.splice(i, 0, { frame, used: ++this.budget.clock });
    this.budget.bytes += this.frameBytes;
    this.budget.trim();
  }
}
