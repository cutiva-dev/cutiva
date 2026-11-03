import { formatTimecode, reframeKeys, type Clip, type Project, type Us } from "@cutiva/core";
import type { AutoReframeClipResult } from "@cutiva/web";
import { useEffect, useState } from "react";

type Verdict = "good" | "wrong";

/**
 * What a feedback report holds. Numbers only: face boxes, mouth openness, speech levels and crop
 * keys. No video, no images, no file names. People attach it to a GitHub issue; the maintainer replays
 * it through `autoReframe` to tune it and to turn bad cases into regression tests.
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

const NEW_ISSUE = "https://github.com/cutiva-dev/cutiva/issues/new";
/** GitHub drops prefilled issue URLs past ~8 KB, so the issue carries a summary and the file the rest. */
const MAX_COMMENT_IN_URL = 1000;

function downloadJson(report: ReframeFeedbackReport, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(report)], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const OVERALL = { good: "Good", ok: "Needs fixes", bad: "Bad" } as const;

/** A new-issue link with a short summary; the full report goes in the attached file. */
export function issueUrl(report: ReframeFeedbackReport, fileName: string): string {
  const s = report.settings;
  const wrong = report.ratings.filter((r) => r.verdict === "wrong").length;
  const comment = report.comment.trim();
  const body = [
    `**Overall:** ${OVERALL[report.overall]}`,
    `**Framing changes rated:** ${report.ratings.length} (${wrong} wrong)`,
    `**Source:** ${s.sourceWidth}×${s.sourceHeight} → **output:** ${s.outputWidth}×${s.outputHeight}, zoom ${s.zoom}`,
    `**Browser:** ${report.userAgent}`,
    "",
    "**What went wrong:**",
    comment ? (comment.length > MAX_COMMENT_IN_URL ? `${comment.slice(0, MAX_COMMENT_IN_URL)}… (full text in the file)` : comment) : "_(nothing written)_",
    "",
    `**Report:** drag \`${fileName}\` (just downloaded) into this box. It holds numbers only: face boxes, mouth movement, speech levels and crop keys. No video, images or file names.`,
  ].join("\n");
  const q = new URLSearchParams({ title: `Auto-reframe feedback: ${OVERALL[report.overall].toLowerCase()}`, body });
  return `${NEW_ISSUE}?${q}`;
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
  const [state, setState] = useState<"idle" | "opened">("idle");

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

  function send() {
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
    const name = `reframe-feedback-${Date.now()}.json`;
    downloadJson(report, name);
    window.open(issueUrl(report, name), "_blank", "noopener");
    setState("opened");
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
      <button type="button" disabled={!overall} onClick={send}>
        Report on GitHub
      </button>
      {state === "opened" && (
        <p className="small" role="status">
          The report downloaded and a GitHub issue opened in a new tab. Drag the file into the issue and submit it. Blocked pop-up?{" "}
          <a href={NEW_ISSUE} target="_blank" rel="noreferrer">
            Open a new issue
          </a>
          .
        </p>
      )}
      <p className="muted small">
        Downloads a report of face positions, mouth movement, speech levels and the framing, as numbers, then opens a public GitHub issue for it (you need a GitHub account). No video, images or file names. Fix a framing by dragging the window first: your fixes are part of the report.
      </p>
    </div>
  );
}
