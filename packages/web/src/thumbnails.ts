import { CanvasSink, EncodedPacketSink, type InputVideoTrack } from "mediabunny";

export type Thumbnail = HTMLCanvasElement | OffscreenCanvas;

/** Thumbnail height in pixels; width follows the video's aspect ratio. */
const HEIGHT = 96;

/**
 * Small frames of one video asset for timeline strips. Each thumbnail shows the keyframe at or
 * before the requested time, so it costs one frame decode and is shared by every request in the
 * same GOP. Times are in seconds, like Mediabunny's.
 */
export class ThumbnailServer {
  private readonly sink: CanvasSink;
  private readonly packets: EncodedPacketSink;
  /** By keyframe timestamp. */
  private readonly cache = new Map<number, Promise<Thumbnail | null>>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(track: InputVideoTrack) {
    const height = Math.min(HEIGHT, track.displayHeight);
    const width = Math.max(1, Math.round((height * track.displayWidth) / track.displayHeight));
    this.sink = new CanvasSink(track, { width, height, fit: "fill", poolSize: 0 });
    this.packets = new EncodedPacketSink(track);
  }

  thumbnailAt(time: number): Promise<Thumbnail | null> {
    // Decode one at a time; a strip asks for many thumbnails at once.
    const result = this.queue.then(async () => {
      const key = (await this.packets.getKeyPacket(time, { metadataOnly: true })) ?? (await this.packets.getFirstPacket({ metadataOnly: true }));
      if (!key) return null;
      let thumb = this.cache.get(key.timestamp);
      if (!thumb) {
        thumb = this.sink
          .getCanvas(key.timestamp)
          .then((w) => w?.canvas ?? null)
          .catch(() => null);
        this.cache.set(key.timestamp, thumb);
      }
      return thumb;
    });
    this.queue = result.catch(() => undefined);
    return result;
  }
}
