import type { Control, DashboardSpec, Derivation, RelativeRange } from "./spec";
import type { DatasetProfile } from "./types";

/**
 * Controls — what a reader may narrow without editing the spec.
 *
 * The whole design rests on one decision: a control compiles into a **single
 * filter derivation at the root of each table**, and every derivation that used
 * to read that table is rewritten to read the filter instead.
 *
 *     raw ──► ctl__raw (filter) ──► groupBy ──► topK ──► block
 *
 * Filtering anywhere else is subtly wrong in a way nobody notices. Filter a
 * chart's output and `topK`'s "Other" row still sums the rows you excluded;
 * filter the base outside the pipeline and a percentage-of-whole is a
 * percentage of the wrong whole. Injecting at the root means every aggregate
 * downstream recomputes against exactly the rows the reader can see, using the
 * same algebra that produced the unfiltered numbers.
 */

/** What the reader currently has selected, keyed by control id. */
export type ControlState = Record<string, string | string[] | undefined>;

export interface ResolvedControl {
  control: Control;
  /** The value in force — the default when the reader has chosen nothing. */
  value: string | string[];
  /** For a dimension control: the choices to offer, refreshed from live data. */
  options?: string[];
  /** For a time control: the window it resolved to, so the UI can label it. */
  window?: { from: string; to: string; label: string };
}

/**
 * Prefix for ids Disco mints rather than an author writing them.
 *
 * The double underscore reads as "internal" while staying inside the schema's
 * `^[a-z][a-z0-9_]*$` id rule — a leading underscore looks more obviously
 * generated but fails to parse, which made every control-filtered spec
 * invalid in a way that only surfaced downstream.
 */
export const CONTROL_PREFIX = "ctl__";

export const isControlId = (id: string) => id.startsWith(CONTROL_PREFIX);

const DAY = 86_400_000;

const RANGE_MS: Partial<Record<RelativeRange, number>> = {
  last_24h: DAY,
  last_7d: 7 * DAY,
  last_14d: 14 * DAY,
  last_30d: 30 * DAY,
  last_90d: 90 * DAY,
  last_12m: 365 * DAY,
};

const RANGE_LABEL: Record<RelativeRange, string> = {
  last_24h: "Last 24 hours",
  last_7d: "Last 7 days",
  last_14d: "Last 14 days",
  last_30d: "Last 30 days",
  last_90d: "Last 90 days",
  last_12m: "Last 12 months",
  mtd: "Month to date",
  qtd: "Quarter to date",
  ytd: "Year to date",
  all: "All data",
};

export const rangeLabel = (r: RelativeRange) => RANGE_LABEL[r];

/**
 * The instant a relative range counts back from.
 *
 * `data_max` — the newest timestamp actually present. This is the default
 * because a batch producer is nearly always behind the wall clock: anchoring
 * "last 24 hours" to `now` against a run produced 40 minutes ago quietly
 * excludes most of it, and against a run produced yesterday blanks the
 * dashboard entirely. Anchoring to the data means the label and the contents
 * agree.
 */
function anchorTime(control: Extract<Control, { kind: "timeRange" }>, profile: DatasetProfile, now: number): number {
  if (control.anchor === "now") return now;

  const table = profile.tables.find((t) => t.id === control.table || t.alias === control.table);
  const field = table?.fields.find((f) => f.name === control.field);
  const max = field?.temporal?.max;
  // No temporal statistics means the profiler could not read the field as a
  // date. Falling back to the clock is better than filtering everything out.
  return max ? Date.parse(max) : now;
}

function windowFor(
  control: Extract<Control, { kind: "timeRange" }>,
  value: RelativeRange,
  profile: DatasetProfile,
  now: number,
): { from: string; to: string; label: string } | null {
  if (value === "all") return null;

  const to = anchorTime(control, profile, now);
  const span = RANGE_MS[value];
  if (span !== undefined) {
    return { from: new Date(to - span).toISOString(), to: new Date(to).toISOString(), label: RANGE_LABEL[value] };
  }

  // Calendar-relative ranges are floored in UTC, so the same window resolves
  // identically wherever it is computed.
  const d = new Date(to);
  const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  if (value === "mtd") start.setUTCMonth(d.getUTCMonth());
  if (value === "qtd") start.setUTCMonth(Math.floor(d.getUTCMonth() / 3) * 3);

  return { from: start.toISOString(), to: new Date(to).toISOString(), label: RANGE_LABEL[value] };
}

/**
 * Resolve each control against the live profile and the reader's selection.
 *
 * Dimension options are refreshed from the profile rather than read from the
 * spec, so a value that appears in a later run shows up in the filter on its
 * own — a spec written last week does not have to know about it.
 */
export function resolveControls(
  spec: DashboardSpec,
  profile: DatasetProfile,
  state: ControlState,
  now: number,
): ResolvedControl[] {
  return spec.controls.map((control) => {
    if (control.kind === "timeRange") {
      const chosen = (state[control.id] as RelativeRange | undefined) ?? control.default;
      const value = control.presets.includes(chosen) ? chosen : control.default;
      return { control, value, window: windowFor(control, value, profile, now) ?? undefined };
    }

    const table = profile.tables.find((t) => t.id === control.table || t.alias === control.table);
    const field = table?.fields.find((f) => f.name === control.field);
    const live = field?.categorical?.topValues.map((v) => v.value) ?? [];
    const options = control.values.length > 0 ? control.values : live;

    const raw = state[control.id] ?? control.default;
    const selected = Array.isArray(raw) ? raw : raw ? [raw] : [];
    // A stale selection — a value that vanished between runs — is dropped
    // rather than left filtering everything out.
    const value = selected.filter((v) => options.length === 0 || options.includes(v));

    return { control, value, options };
  });
}

type Predicate = { field: string; op: string; value?: unknown };

/**
 * Compile the active controls into the spec the pipeline actually runs.
 *
 * Returns a spec with one `ctl__<table>` filter derivation per affected table
 * and every downstream `from` rewritten to point at it. The authored spec is
 * never mutated: controls are a view over it, not an edit to it, so clearing a
 * filter restores the original exactly.
 */
export function applyControls(
  spec: DashboardSpec,
  resolved: ResolvedControl[],
): { spec: DashboardSpec; filtered: boolean } {
  const byTable = new Map<string, Predicate[]>();

  for (const r of resolved) {
    const { control } = r;

    if (control.kind === "timeRange") {
      if (!r.window) continue;
      const list = byTable.get(control.table) ?? [];
      list.push(
        { field: control.field, op: "gte", value: r.window.from },
        { field: control.field, op: "lte", value: r.window.to },
      );
      byTable.set(control.table, list);
      continue;
    }

    const values = r.value as string[];
    if (values.length === 0) continue;
    const list = byTable.get(control.table) ?? [];
    // `in` rather than a chain of `eq`s, so multi-select is one predicate and
    // single-select is just the one-element case of it.
    list.push({ field: control.field, op: "in", value: values });
    byTable.set(control.table, list);
  }

  if (byTable.size === 0) return { spec, filtered: false };

  const injected: Derivation[] = [];
  const rename = new Map<string, string>();

  for (const [table, where] of byTable) {
    const id = `${CONTROL_PREFIX}${table}`;
    injected.push({ op: "filter", id, from: table, where } as Derivation);
    rename.set(table, id);
  }

  const repoint = <T extends { from: string }>(d: T): T =>
    rename.has(d.from) ? { ...d, from: rename.get(d.from)! } : d;

  return {
    spec: {
      ...spec,
      // The filter nodes come first so `runPipeline` can resolve them before
      // anything that now depends on them.
      derivations: [...injected, ...spec.derivations.map(repoint)],
      blocks: spec.blocks.map((b) => (b.kind === "text" ? b : repoint(b as { from: string } & typeof b))),
    },
    filtered: true,
  };
}

/**
 * Strip everything `applyControls` injected.
 *
 * A control-filtered spec is a runtime view. Writing one to disk would bake a
 * reader's momentary selection into the authored dashboard, and the next run
 * would filter twice.
 */
export function stripControls(spec: DashboardSpec): DashboardSpec {
  const rename = new Map<string, string>();
  for (const d of spec.derivations) {
    if (isControlId(d.id)) rename.set(d.id, d.from);
  }
  if (rename.size === 0) return spec;

  const repoint = <T extends { from: string }>(d: T): T =>
    rename.has(d.from) ? { ...d, from: rename.get(d.from)! } : d;

  return {
    ...spec,
    derivations: spec.derivations.filter((d) => !isControlId(d.id)).map(repoint),
    blocks: spec.blocks.map((b) => (b.kind === "text" ? b : repoint(b as { from: string } & typeof b))),
  };
}
