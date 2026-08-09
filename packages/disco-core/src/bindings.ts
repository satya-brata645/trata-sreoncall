import { seriesFields, type Block, type DashboardSpec } from "./spec";

/**
 * Where a block reaches into the data.
 *
 * This exists because "which frames does this block need?" was answered
 * independently in three places, and one of them was wrong: the materializer
 * collected `block.from` and forgot that a KPI *also* binds `spark.from`, so
 * server-mode dashboards shipped without their sparkline frames — which
 * silently killed the period-over-period delta too, since the delta is derived
 * from the spark frame.
 *
 * A block kind added later will have exactly one place to declare its binding
 * sites, and the validator, the materializer and the patch garbage collector
 * all pick it up for free.
 */

/** Every frame id a block reads from. */
export function frameBindings(block: Block): string[] {
  if (block.kind === "text") return [];
  const out = [block.from];
  // The only second binding site in the catalog today. Keep this exhaustive.
  if (block.kind === "kpi" && block.spark) out.push(block.spark.from);
  return out;
}

/**
 * Every field a block reads, paired with the frame it reads it from.
 *
 * Returning pairs rather than bare names matters for KPIs: `field` lives in
 * `from` while the spark's `x`/`y` live in `spark.from`, and checking a spark
 * field against the value frame would report a phantom error.
 */
export function fieldBindings(block: Block): Array<{ frame: string; field: string }> {
  const at = (frame: string, fields: Array<string | undefined>) =>
    fields.filter((f): f is string => !!f).map((field) => ({ frame, field }));

  switch (block.kind) {
    case "kpi":
      return [
        // The chrome fields read from the value row, so they belong to `from`
        // — not to the spark frame, which has one row per bucket and none of
        // these columns.
        ...at(block.from, [
          block.field,
          block.labelField, block.unitField, block.deltaField, block.inverseField,
          block.breachField, block.basisField, block.meaningField,
        ]),
        ...(block.spark ? at(block.spark.from, [block.spark.x, block.spark.y]) : []),
      ];
    case "timeseries":
      return at(block.from, [block.x, ...seriesFields(block)]);
    case "bar":
      return at(block.from, [block.x, ...block.y]);
    case "pie":
      return at(block.from, [block.category, block.value]);
    case "scatter":
      return at(block.from, [block.x, block.y, block.size, block.colorBy]);
    case "histogram":
      return at(block.from, [block.x, block.y]);
    case "heatmap":
      return at(block.from, [block.x, block.y, block.value]);
    case "table":
      return at(block.from, block.columns.map((c) => c.field));
    case "funnel":
      return at(block.from, [block.stage, block.value, block.attrition, block.reasonField, block.duration, block.detail]);
    case "radar":
      // The axes ARE columns, so every one of them is a binding site.
      return at(block.from, [block.entity, ...block.axes]);
    case "radial":
      return at(block.from, [block.category, block.value]);
    case "callout":
      return at(block.from, [block.titleField, block.detailField, block.severityField, block.metaField, block.rankField]);
    case "text":
      return [];
  }
}

/**
 * Frame ids reachable from any block, following `from` edges up the derivation
 * DAG. This is the mark phase of the patch collector, and the set the
 * materializer ships.
 */
export function reachableFrames(spec: DashboardSpec, baseIds: string[] = []): Set<string> {
  const byId = new Map(spec.derivations.map((d) => [d.id, d]));
  const seen = new Set<string>(baseIds);
  const queue: string[] = spec.blocks.flatMap(frameBindings);

  while (queue.length > 0) {
    const id = queue.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const d = byId.get(id);
    if (d) queue.push(d.from);
  }

  return seen;
}
