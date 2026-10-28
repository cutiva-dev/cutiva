# @cutiva/react

React bindings for [Cutiva](https://github.com/cutiva-dev/cutiva), the open-source video editing SDK: `useCutiva`, `useProject`, `usePreview` and a `<Timeline>` with drag to reorder, trim handles and thumbnails.

```bash
npm install @cutiva/core @cutiva/web @cutiva/react
```

```tsx
import { useState } from "react";
import { Timeline, useCutiva, usePreview } from "@cutiva/react";
import "@cutiva/react/styles.css";

export function Editor() {
  const { editor, engine } = useCutiva({ settings: { width: 1920, height: 1080 } });
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const { preview, timeUs } = usePreview(engine, canvas);
  return (
    <>
      <canvas ref={setCanvas} />
      <Timeline editor={editor} timeUs={timeUs} onSeek={(t) => preview?.seek(t)} thumbnail={engine.thumbnail} />
    </>
  );
}
```

Works with React 18 and 19. Docs: [cutiva.dev/docs](https://cutiva.dev/docs). License: Apache-2.0.
