# @cutiva/core

The headless part of [Cutiva](https://github.com/cutiva-dev/cutiva), the open-source video editing SDK: the CPF project format, edit commands with undo/redo, and timeline resolution. Pure TypeScript with no dependencies and no DOM, so it runs in browsers, Node and workers.

```bash
npm install @cutiva/core
```

```ts
import { createEditor, resolveVideoAt } from "@cutiva/core";

const editor = createEditor({ settings: { width: 1920, height: 1080 } });
editor.dispatch({ type: "asset.add", asset: { id: "ast_1", kind: "video", name: "intro.mp4", uri: "file://intro.mp4", durationUs: 20_000_000, hasAudio: true } });
const { clipId } = editor.dispatch({ type: "clip.add", assetId: "ast_1" });
editor.dispatch({ type: "clip.split", clipId, atUs: 12_000_000 });
editor.undo();

resolveVideoAt(editor.project, 5_000_000); // what to draw at 5 s
JSON.stringify(editor.toJSON()); // a CPF document
```

All times are integer microseconds. Every edit is a serializable command; a failed edit leaves the project untouched and throws a `CutivaError` with a stable `code`.

Docs: [cutiva.dev/docs](https://cutiva.dev/docs). License: Apache-2.0.
