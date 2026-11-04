import { createEditor, editReframeTrack, planReframe, renderPlan, type Project, type ReframeEdit, type ReframePlanResult, type ReframeTrack, type RenderPlan } from "@cutiva/core";
import type { ReframeAnalysis } from "./measurements.js";

export interface PlanOptions {
  /** Output size. Default 1080 x 1920 (9:16); only the aspect ratio matters for the framing. */
  width?: number;
  height?: number;
  /**
   * The Reframe Track of an earlier result, to keep its people, names and corrections (locked
   * segments are never changed by re-planning). Combine with `edits` to correct a framing.
   */
  track?: ReframeTrack;
  /** Corrections applied to `track` (or to a fresh plan) first: focus a person, split, wide, camera style. */
  edits?: ReframeEdit[];
}

const size = (o: PlanOptions) => ({ width: o.width ?? 1080, height: o.height ?? 1920 });

/** Plans the framing of an analysed video with `planReframe` from `@cutiva/core`. Pure and fast: no decoding. */
export function planVideo(analysis: ReframeAnalysis, options: PlanOptions = {}): ReframePlanResult {
  const { width, height } = size(options);
  const input = {
    sourceWidth: analysis.width,
    sourceHeight: analysis.height,
    outputWidth: width,
    outputHeight: height,
    durationUs: analysis.durationUs,
    frames: analysis.frames,
    cuts: analysis.cuts,
    ...(analysis.activeArea ? { activeArea: analysis.activeArea } : {}),
  };
  let track = options.track;
  if (options.edits?.length) {
    // Edits refer to segments and people of a track, so a fresh plan is made first when there is none.
    track = options.edits.reduce(editReframeTrack, track ?? planReframe(input).track);
  }
  return planReframe({ ...input, ...(track ? { track } : {}) });
}

/**
 * A one-clip project that shows the analysed part of `uri` with the planned framing, and its render
 * plan for the native engine. The project (CPF) can be saved and opened in any Cutiva editor.
 */
export function reframedProject(uri: string, analysis: ReframeAnalysis, plan: ReframePlanResult, options: Pick<PlanOptions, "width" | "height"> = {}): { project: Project; plan: RenderPlan } {
  const editor = createEditor({ settings: size(options) });
  const name = decodeURIComponent(uri.split("/").pop() ?? "video");
  const { assetId } = editor.dispatch({
    type: "asset.add",
    asset: { id: "ast_video", kind: "video", name, uri, durationUs: analysis.durationUs, width: analysis.width, height: analysis.height, hasAudio: analysis.hasAudio },
  });
  const { clipId } = editor.dispatch({ type: "clip.add", assetId, trackId: "auto", startUs: 0, sourceInUs: analysis.fromUs, sourceOutUs: analysis.toUs });
  editor.dispatch({ type: "clip.setReframe", clipId, keys: plan.keys, track: plan.track });
  return { project: editor.project, plan: renderPlan(editor.project) };
}
