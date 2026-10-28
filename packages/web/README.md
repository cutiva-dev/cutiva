# @cutiva/web

The browser engine of [Cutiva](https://github.com/cutiva-dev/cutiva), the open-source video editing SDK: import local files, preview on a canvas with sound, show timeline thumbnails, and export MP4 (H.264 + AAC) on the user's device. Built on [Mediabunny](https://mediabunny.dev), WebCodecs and Web Audio.

```bash
npm install @cutiva/core @cutiva/web
```

```ts
import { createEditor } from "@cutiva/core";
import { createWebEngine } from "@cutiva/web";

const editor = createEditor({ settings: { width: 1920, height: 1080 } });
const engine = createWebEngine(editor);

const { clipId } = await engine.importFile(file);
editor.dispatch({ type: "clip.split", clipId: clipId!, atUs: 12_000_000 });

const preview = engine.createPreview(canvas);
await preview.play();

if ((await engine.capabilities()).exportMp4) {
  const job = engine.export({ resolution: "1080p" });
  job.on("progress", (p) => console.log(Math.round(p.ratio * 100), "%"));
  const mp4: Blob = await job.done;
}
```

E2E-tested in Chrome, Firefox and WebKit on macOS; real Safari, Windows and Linux need testing. Export needs H.264 encoding in WebCodecs. Audio is AAC, or Opus where the browser can't encode AAC (Firefox); `capabilities().audioCodec` says which.

Docs: [cutiva.dev/docs](https://cutiva.dev/docs). License: Apache-2.0. Mediabunny is MPL-2.0.
