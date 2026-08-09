import { buildBaseTables, profileDocument, withAliases } from "./profile";
import { chooseMode, recommend } from "./recommend";
import { resolve, type Resolved } from "./resolve";
import { solveLayout, layoutHints, type Layout, type Rect } from "./layout";
import { applyPatch, History, type Patch, type PatchResult } from "./patch";
import { parseSpec, type Block, type DashboardSpec, type Derivation } from "./spec";
import type { ControlState } from "./controls";
import type { Row } from "./algebra";
import type { DatasetProfile } from "./types";

/**
 * The substrate API.
 *
 * Disco's role in the OS is not to be another dashboard app — it is the thing
 * other apps call when they have data and a question. SREonCall hands over
 * incident data and gets a live, editable dashboard back; FinOps does the same
 * for spend. Neither has to know what a block is.
 *
 * Deliberately outside the desktop verb table. That protocol moves windows and
 * has no verb that writes app data, and adding one would let any agent with
 * window permissions rewrite a dashboard's contents. Disco's patch surface is
 * app-internal by construction: you get a handle, and the handle is the only
 * way in.
 */

export interface RenderRequest {
  /** Any JSON with at least one array of records. Tables are discovered by key. */
  data: unknown;
  /** What the dashboard should answer. Used as the title when no spec is given. */
  question?: string;
  /** The rectangle it must fit. Layout is solved against this, not a viewport. */
  rect: Rect;
  /** A pinned spec to rebind. Omit to compose one from the recommender. */
  spec?: DashboardSpec | unknown;
  /** Explicit, never read from the clock inside — see the note on determinism. */
  now: number;
  state?: ControlState;
}

export interface DashboardHandle {
  spec: DashboardSpec;
  resolved: Resolved;
  layout: Layout;
  profile: DatasetProfile;
  /** Apply a typed edit. Commits whole or rejects whole. */
  patch(patch: Patch): PatchResult;
  /** Undo the last committed patch, or `null` if there is nothing to undo. */
  undo(): DashboardHandle | null;
  /** Re-solve for a new rectangle without touching the spec or the data. */
  reflow(rect: Rect): DashboardHandle;
  /** Re-bind the same spec to a newer document. */
  rebind(data: unknown, now: number): DashboardHandle;
}

/**
 * Compose a spec from the recommender when the caller has no opinion.
 *
 * Deliberately conservative — four headline tiles, a trend, two breakdowns and
 * the detail. A caller who wants something specific passes a spec; this is the
 * floor, not the ceiling.
 */
function compose(profile: DatasetProfile, question: string): DashboardSpec {
  const table = profile.tables[0];
  const candidates = recommend(table);

  const take = (kind: string, n: number) => candidates.filter((c) => c.block.kind === kind).slice(0, n);
  const chosen = [
    ...take("kpi", 4),
    ...take("timeseries", 1),
    ...take("bar", 2),
    ...take("table", 1),
  ];

  const derivations = [...new Map(chosen.flatMap((c) => c.derivations).map((d) => [d.id, d])).values()] as Derivation[];

  return parseSpec({
    $schema: "disco/v1",
    id: "generated",
    title: question,
    subtitle: `${table.rowCount.toLocaleString("en-US")} records · ${table.fields.length} fields`,
    intent: question,
    dataset: { source: "inline", mode: chooseMode(table.rowCount), rowCount: table.rowCount },
    controls: [],
    derivations,
    blocks: chosen.map((c) => c.block) as Block[],
    notes: profile.warnings,
  });
}

function build(
  spec: DashboardSpec,
  profile: DatasetProfile,
  base: Record<string, Row[]>,
  rect: Rect,
  now: number,
  state: ControlState,
  history: History,
  data: unknown,
): DashboardHandle {
  const resolved = resolve(spec, profile, base, { now, state });
  const layout = solveLayout(resolved.spec.blocks, rect, layoutHints(resolved.spec.blocks, resolved.frames));

  return {
    spec,
    resolved,
    layout,
    profile,

    patch(patch: Patch): PatchResult {
      const result = applyPatch(spec, patch, { profile, base, rect, now });
      // Only a committed patch enters the history. A rejected one changed
      // nothing, so recording it would make undo skip a step that never
      // happened.
      if (result.ok) history.push({ intent: patch.intent, before: spec, after: result.spec });
      return result;
    },

    undo() {
      const previous = history.undo();
      return previous ? build(previous, profile, base, rect, now, state, history, data) : null;
    },

    reflow(next: Rect) {
      // The spec and the data are untouched, so this is only the solver running
      // again — which is why it is cheap enough for a resize drag.
      return build(spec, profile, base, next, now, state, history, data);
    },

    rebind(nextData: unknown, nextNow: number) {
      const nextProfile = profileDocument(nextData, "inline", 0);
      const nextBase = withAliases(buildBaseTables(nextData, nextProfile, { aliases: false }), nextProfile);
      // The SPEC carries over. A new run adapts the encoding through `resolve`;
      // it does not recompose, or every edit the caller made would be lost each
      // time the producer dropped a document.
      return build(spec, nextProfile, nextBase, rect, nextNow, state, history, nextData);
    },
  };
}

/**
 * Render data into a dashboard.
 *
 * The entry point another app calls. Everything after this — repairs, layout,
 * edits — happens through the returned handle.
 */
export function discoRender(request: RenderRequest): DashboardHandle {
  const profile = profileDocument(request.data, "inline", 0);
  const base = withAliases(buildBaseTables(request.data, profile, { aliases: false }), profile);

  const spec = request.spec
    ? parseSpec(request.spec)
    : compose(profile, request.question ?? "Overview");

  return build(spec, profile, base, request.rect, request.now, request.state ?? {}, new History(), request.data);
}
