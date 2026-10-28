import { clipDurationUs, CutivaError, findClip, formatTimecode, type Us } from "@cutiva/core";
import { Timeline, useCutiva, usePreview, useProject } from "@cutiva/react";
import type { Capabilities, ExportJob } from "@cutiva/web";
import { useEffect, useRef, useState } from "react";

const MEDIA_ACCEPT = "video/*,audio/*";

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function App() {
  const { editor, engine } = useCutiva({ settings: { width: 1920, height: 1080 } });
  const project = useProject(editor);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const { preview, timeUs, playing } = usePreview(engine, canvas);
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [job, setJob] = useState<{ job: ExportJob; ratio: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const mediaInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const relinkInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void engine.capabilities().then(setCaps);
  }, [engine]);

  const missing = engine.media.missing(project.assets);
  const selectedClip = (() => {
    try {
      return selected ? findClip(project, selected).clip : null;
    } catch {
      return null;
    }
  })();

  const fail = (e: unknown) => setMessage({ tone: "error", text: e instanceof Error ? e.message : String(e) });
  const run = (fn: () => void) => {
    try {
      fn();
      setMessage(null);
    } catch (e) {
      fail(e);
    }
  };

  async function importFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    for (const file of Array.from(files)) {
      try {
        await engine.importFile(file);
      } catch (e) {
        fail(e);
      }
    }
    setBusy(false);
  }

  async function relinkFiles(files: FileList | null) {
    if (!files) return;
    let linked = 0;
    for (const f of Array.from(files)) if (await engine.relink(f)) linked++;
    setMessage({ tone: linked ? "info" : "error", text: linked ? `Linked ${linked} file(s).` : "None of those files match this project's media." });
    preview?.seek(timeUs);
  }

  async function openProject(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    run(() => undefined);
    try {
      editor.load(await file.text());
      setSelected(null);
      if (engine.media.missing(editor.project.assets).length) {
        setMessage({ tone: "info", text: "Project opened. Link its media files to preview and export." });
      }
    } catch (e) {
      fail(e);
    }
  }

  function split() {
    if (!selectedClip) return setMessage({ tone: "info", text: "Select a clip, move the playhead inside it, then split." });
    run(() => {
      const { rightId } = editor.dispatch({ type: "clip.split", clipId: selectedClip.id, atUs: timeUs });
      setSelected(rightId);
    });
  }

  function startExport() {
    const j = engine.export({ resolution: "1080p" });
    setJob({ job: j, ratio: 0 });
    j.on("progress", (p) => setJob((cur) => (cur ? { ...cur, ratio: p.ratio } : cur)));
    j.done
      .then((blob) => {
        download(blob, "cutiva-export.mp4");
        setMessage({ tone: "info", text: "Export finished." });
      })
      .catch((e) => {
        if (e instanceof CutivaError && e.code === "EXPORT_CANCELLED") setMessage({ tone: "info", text: "Export cancelled." });
        else fail(e);
      })
      .finally(() => setJob(null));
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, select, textarea, [role=slider]")) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) editor.redo();
        else editor.undo();
      } else if (e.key === " " && preview) {
        e.preventDefault();
        if (preview.playing) preview.pause();
        else void preview.play();
      } else if (e.key.toLowerCase() === "s" && !mod) split();
      else if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        run(() => editor.dispatch({ type: "clip.remove", clipId: selected, ripple: true }));
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const empty = project.assets.length === 0;

  return (
    <div className="app">
      <header className="bar">
        <div className="brand">
          <img src="/cutiva-mark.svg" alt="" width={28} height={28} />
          <span>cutiva</span>
          <span className="tag">playground</span>
        </div>
        <div className="actions">
          <button type="button" onClick={() => editor.undo()} disabled={!editor.canUndo}>Undo</button>
          <button type="button" onClick={() => editor.redo()} disabled={!editor.canRedo}>Redo</button>
          <span className="sep" />
          <button type="button" onClick={() => projectInput.current?.click()}>Open project</button>
          <button
            type="button"
            disabled={empty}
            onClick={() => download(new Blob([JSON.stringify(editor.toJSON(), null, 2)], { type: "application/json" }), "project.cutiva.json")}
          >
            Save project
          </button>
          <button type="button" className="primary" disabled={empty || !!job || !caps?.exportMp4 || missing.length > 0} onClick={startExport}>
            Export MP4
          </button>
        </div>
      </header>

      {caps && !caps.exportMp4 && (
        <p className="banner">This browser can't encode H.264 yet, so export is off. Preview still works. Use Chrome or Edge to export.</p>
      )}
      {missing.length > 0 && (
        <p className="banner">
          {missing.length} media file(s) need linking: {missing.map((a) => a.name).join(", ")}.{" "}
          <button type="button" className="link" onClick={() => relinkInput.current?.click()}>Link files</button>
        </p>
      )}
      {message && <p className={`banner banner--${message.tone}`} role="status">{message.text}</p>}

      <main className="stage">
        <section className="viewer">
          <div className="screen" style={{ aspectRatio: `${project.settings.width} / ${project.settings.height}` }}>
            <canvas ref={setCanvas} aria-label="Video preview" />
            {empty && (
              <div className="empty">
                <p>Import video or audio to start editing.</p>
                <button type="button" className="primary" onClick={() => mediaInput.current?.click()} disabled={busy}>
                  {busy ? "Importing…" : "Import media"}
                </button>
                <p className="hint">Files stay on this device.</p>
              </div>
            )}
          </div>
          <div className="transport">
            <button type="button" className="play" onClick={() => (playing ? preview?.pause() : void preview?.play())} disabled={empty} aria-label={playing ? "Pause" : "Play"}>
              {playing ? (
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" /><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" /></svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z" fill="currentColor" /></svg>
              )}
            </button>
            <span className="tc">
              {formatTimecode(timeUs)} <span className="muted">/ {formatTimecode(editor.durationUs)}</span>
            </span>
            <span className="grow" />
            <button type="button" onClick={() => mediaInput.current?.click()} disabled={busy}>Add media</button>
            <button type="button" onClick={split} disabled={!selectedClip}>Split at playhead</button>
            <button
              type="button"
              disabled={!selectedClip}
              onClick={() => {
                if (!selectedClip) return;
                run(() => editor.dispatch({ type: "clip.remove", clipId: selectedClip.id, ripple: true }));
                setSelected(null);
              }}
            >
              Delete clip
            </button>
          </div>
        </section>

        <aside className="inspector" aria-label="Clip settings">
          {selectedClip ? (
            <>
              <h2>{project.assets.find((a) => a.id === selectedClip.assetId)?.name}</h2>
              <dl>
                <dt>Starts</dt>
                <dd>{formatTimecode(selectedClip.startUs)}</dd>
                <dt>Length</dt>
                <dd>{formatTimecode(clipDurationUs(selectedClip))}</dd>
              </dl>
              <label>
                Volume <span className="muted">{Math.round(selectedClip.volume * 100)}%</span>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  value={selectedClip.volume}
                  onChange={(e) => run(() => editor.dispatch({ type: "clip.setVolume", clipId: selectedClip.id, volume: Number(e.target.value) }))}
                />
              </label>
              <label>
                Speed
                <select value={selectedClip.speed} onChange={(e) => run(() => editor.dispatch({ type: "clip.setSpeed", clipId: selectedClip.id, speed: Number(e.target.value) }))}>
                  {[0.5, 1, 1.5, 2].map((s) => (
                    <option key={s} value={s}>{s}×</option>
                  ))}
                </select>
              </label>
              <FadeControls
                key={selectedClip.id}
                onApply={(inUs, outUs) => run(() => editor.dispatch({ type: "clip.setFade", clipId: selectedClip.id, inUs, outUs }))}
              />
            </>
          ) : (
            <p className="muted">Select a clip on the timeline to adjust volume, speed and fades.</p>
          )}
          <p className="shortcuts muted">Space play · S split · Delete remove · Ctrl/⌘ Z undo</p>
        </aside>
      </main>

      <Timeline
        editor={editor}
        timeUs={timeUs}
        onSeek={(t: Us) => preview?.seek(t)}
        selectedClipId={selected}
        onSelect={setSelected}
        onError={(e) => setMessage({ tone: "error", text: e.message })}
        thumbnail={engine.thumbnail}
      />

      {job && (
        <div className="export" role="dialog" aria-label="Exporting">
          <p>Exporting MP4… {Math.round(job.ratio * 100)}%</p>
          <progress max={1} value={job.ratio} />
          <button type="button" onClick={() => job.job.cancel()}>Cancel</button>
        </div>
      )}

      <input ref={mediaInput} aria-label="Import media files" type="file" accept={MEDIA_ACCEPT} multiple hidden onChange={(e) => { void importFiles(e.target.files); e.target.value = ""; }} />
      <input ref={projectInput} aria-label="Open project file" type="file" accept=".json,application/json" hidden onChange={(e) => { void openProject(e.target.files); e.target.value = ""; }} />
      <input ref={relinkInput} aria-label="Link media files" type="file" accept={MEDIA_ACCEPT} multiple hidden onChange={(e) => { void relinkFiles(e.target.files); e.target.value = ""; }} />
    </div>
  );
}

function FadeControls({ onApply }: { onApply: (inUs: number, outUs: number) => void }) {
  const [fadeIn, setFadeIn] = useState(0);
  const [fadeOut, setFadeOut] = useState(0);
  return (
    <fieldset>
      <legend>Audio fades (seconds)</legend>
      <label>
        In
        <input type="number" min={0} step={0.5} value={fadeIn} onChange={(e) => setFadeIn(Number(e.target.value))} />
      </label>
      <label>
        Out
        <input type="number" min={0} step={0.5} value={fadeOut} onChange={(e) => setFadeOut(Number(e.target.value))} />
      </label>
      <button type="button" onClick={() => onApply(Math.round(fadeIn * 1e6), Math.round(fadeOut * 1e6))}>Apply fades</button>
    </fieldset>
  );
}
