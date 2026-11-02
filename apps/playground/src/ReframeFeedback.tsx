import { formatTimecode, reframeKeys, type Clip, type Project, type Us } from "@cutiva/core";
import type { AutoReframeClipResult } from "@cutiva/web";
import { useEffect, useState } from "react";

type Verdict = "good" | "wrong";

/**
 * What a feedback report holds. Numbers only: face boxes, mouth openness, speech levels and crop
 * keys. No video, no images, no file names. The maintainer replays these through `autoReframe` to
 * tune it and to turn bad cases into regression tests.
 */
export interface ReframeFeedbackReport {
  version: 1;
  createdAt: string;
  userAgent: string;
  overall: "good" | "ok" | "bad";
  comment: string;
  settings: { sourceWidth: number; sourceHeight: number; outputWidth: number; outputHeight: number; zoom: number; sourceInUs: Us; sourceOutUs: Us };
  analysis: AutoReframeClipResult["analysis"];
  /** What auto-reframe produced. */
  auto: { keys: AutoReframeClipResult["keys"]; people: { id: string; shot: number; speakingUs: Us }[] };
  /** The clip's keys when the report was sent, after any hand fixes. */
  final: AutoReframeClipResult["keys"];
  /** A verdict per framing change, by the source time where it starts. */
  ratings: { atUs: Us; verdict: Verdict }[];
}

/** Served by the website next to /play. Local dev has no API, so sending falls back to a file. */
const ENDPOINT = "/api/reframe-feedback";

function downloadJson(report: ReframeFeedbackReport) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(report)], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `reframe-feedback-${Date.now()}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface Props {
  project: Project;
  clip: Clip;
  result: AutoReframeClipResult;
  zoom: number;
  onSeek: (t: Us) => void;
}

/** Rate each framing change, then send the numbers so auto-reframe can be tuned. */
export function ReframeFeedback({ project, clip, result, zoom, onSeek }: Props) {
  const [ratings, setRatings] = useState<Record<number, Verdict>>({});
  const [overall, setOverall] = useState<ReframeFeedbackReport["overall"] | null>(null);
  const [comment, setComment] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "saved">("idle");

  useEffect(() => {
    setRatings({});
    setState("idle");
  }, [result]);

  const asset = project.assets.find((a) => a.id === clip.assetId)!;
  const toTimeline = (sourceUs: Us) => clip.startUs + Math.round((Math.max(sourceUs, clip.sourceInUs) - clip.sourceInUs) / clip.speed);
  // Every framing the viewer sees: the one at the clip's start, then each cut inside the clip.
  const cuts = result.keys.filter((k) => k.cut && k.atUs < clip.sourceOutUs);
  const atStart = cuts.filter((k) => k.atUs <= clip.sourceInUs).pop();
  const segments = [...(atStart ? [atStart] : []), ...cuts.filter((k) => k.atUs > clip.sourceInUs)];

  async function send() {
    if (!overall) return;
    const report: ReframeFeedbackReport = {
      version: 1,
      createdAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      overall,
      comment: comment.slice(0, 2000),
      settings: {
        sourceWidth: asset.width!,
        sourceHeight: asset.height!,
        outputWidth: project.settings.width,
        outputHeight: project.settings.height,
        zoom,
        sourceInUs: clip.sourceInUs,
        sourceOutUs: clip.sourceOutUs,
      },
      analysis: result.analysis,
      auto: { keys: result.keys, people: result.people.map(({ id, shot, speakingUs }) => ({ id, shot, speakingUs })) },
      final: reframeKeys(clip) ?? [],
      ratings: Object.entries(ratings).map(([atUs, verdict]) => ({ atUs: Number(atUs), verdict })),
    };
    setState("sending");
    try {
      const res = await fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(report) });
      if (!res.ok) throw new Error(String(res.status));
      setState("sent");
    } catch {
      // No server (local dev) or no database yet: keep the report as a file instead.
      downloadJson(report);
      setState("saved");
    }
  }

  return (
    <div className="feedback">
      <p className="small">Framing changes: is each one on the right person?</p>
      <ol className="changes">
        {segments.map((k) => {
          const t = toTimeline(k.atUs);
          return (
            <li key={k.atUs}>
              <button type="button" className="link" onClick={() => onSeek(t)}>
                {formatTimecode(t).slice(3, 11)}
              </button>
              {(["good", "wrong"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`chip${ratings[k.atUs] === v ? " is-on" : ""}`}
                  aria-pressed={ratings[k.atUs] === v}
                  onClick={() => setRatings((r) => ({ ...r, [k.atUs]: v }))}
                >
                  {v === "good" ? "Right" : "Wrong"}
                </button>
              ))}
            </li>
          );
        })}
      </ol>
      <fieldset className="overall">
        <legend>Overall</legend>
        {(["good", "ok", "bad"] as const).map((v) => (
          <button key={v} type="button" className={`chip${overall === v ? " is-on" : ""}`} aria-pressed={overall === v} onClick={() => setOverall(v)}>
            {v === "good" ? "Good" : v === "ok" ? "Needs fixes" : "Bad"}
          </button>
        ))}
      </fieldset>
      <label>
        What went wrong? <span className="muted">(optional)</span>
        <textarea rows={2} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} />
      </label>
      <button type="button" disabled={!overall || state === "sending" || state === "sent"} onClick={() => void send()}>
        {state === "sending" ? "Sending…" : state === "sent" ? "Thanks, sent" : "Send feedback"}
      </button>
      {state === "saved" && <p className="small" role="status">Couldn't reach the server, so the report was saved as a file. Send it to the maintainer.</p>}
      <p className="muted small">
        Sends face positions, mouth movement, speech levels and the framing, as numbers. No video, images or file names. Fix a framing by dragging the window first: your fixes are part of the report.
      </p>
    </div>
  );
}
