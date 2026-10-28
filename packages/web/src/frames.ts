import { CanvasSink, EncodedPacketSink, type InputVideoTrack, type WrappedCanvas } from "mediabunny";

interface Cached {
  frame: WrappedCanvas;
  used: number;
}

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
  private readonly sink: CanvasSink;
  private readonly packets: EncodedPacketSink;
  private readonly frameBytes: number;
  /** Sorted by timestamp. */
  private cached: Cached[] = [];
  private decoder: { frames: AsyncGenerator<WrappedCanvas>; last: number } | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    track: InputVideoTrack,
    maxWidth: number,
    private readonly budget = new FrameBudget(),
  ) {
    const width = Math.min(maxWidth, track.displayWidth);
    const height = Math.max(1, Math.round((width * track.displayHeight) / track.displayWidth));
    // No pool: every decoded frame keeps its own canvas so it can stay in the cache.
    this.sink = new CanvasSink(track, { width, poolSize: 0 });
    this.packets = new EncodedPacketSink(track);
    this.frameBytes = width * height * 4;
    budget.servers.add(this);
  }

  /** The frame shown at `time` seconds, or null before the first frame. Calls run one at a time. */
  frameAt(time: number): Promise<WrappedCanvas | null> {
    const result = this.queue.then(() => this.load(time));
    this.queue = result.catch(() => undefined);
    return result;
  }

  /** Stop decoding and drop the cache. */
  dispose(): void {
    void this.decoder?.frames.return(undefined);
    this.decoder = null;
    this.budget.bytes -= this.cached.length * this.frameBytes;
    this.cached = [];
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
    this.cached.splice(index, 1);
    this.budget.bytes -= this.frameBytes;
  }

  private async load(time: number): Promise<WrappedCanvas | null> {
    const hit = this.lookup(time);
    if (hit) return hit;

    const key = (await this.packets.getKeyPacket(time, { metadataOnly: true })) ?? (await this.packets.getFirstPacket({ metadataOnly: true }));
    if (!key) return null;
    // Continuing is cheaper than seeking unless a keyframe lies between the decoder and the target.
    if (!this.decoder || time < this.decoder.last || key.timestamp > this.decoder.last) {
      void this.decoder?.frames.return(undefined);
      this.decoder = { frames: this.sink.canvases(key.timestamp), last: -Infinity };
    }

    let latest: WrappedCanvas | null = null;
    for (;;) {
      const next = await this.decoder.frames.next();
      if (next.done) {
        this.decoder = null;
        return latest ?? this.lookup(time, true);
      }
      const frame = next.value;
      this.decoder.last = frame.timestamp;
      this.store(frame);
      latest = frame;
      if (time < frame.timestamp + frame.duration) return frame;
    }
  }

  /** Cached frame covering `time`; with `orBefore`, the closest earlier one (for times past the end). */
  private lookup(time: number, orBefore = false): WrappedCanvas | null {
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

  private store(frame: WrappedCanvas): void {
    let i = this.cached.length;
    while (i > 0 && this.cached[i - 1]!.frame.timestamp >= frame.timestamp) i--;
    if (this.cached[i]?.frame.timestamp === frame.timestamp) {
      this.cached[i] = { frame, used: ++this.budget.clock };
      return;
    }
    this.cached.splice(i, 0, { frame, used: ++this.budget.clock });
    this.budget.bytes += this.frameBytes;
    this.budget.trim();
  }
}
