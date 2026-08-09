import { test } from "node:test";
import assert from "node:assert/strict";

import { History, applyPatch, dedupe, gc, parsePatch, type Patch, type PatchContext } from "../patch";
import { profileDocument } from "../profile";
import { parseSpec, type Block, type DashboardSpec } from "../spec";
import type { Row } from "../algebra";

/**
 * The edit protocol.
 *
 * The property these tests exist to hold is that a patch is a transaction: it
 * commits whole or leaves nothing behind. Everything else — the garbage
 * collection, the deduplication, the undo — is in service of a spec that is
 * still coherent after an agent has been editing it for an hour.
 */

const AS_OF = Date.parse("2026-08-09T00:00:00Z");
const DAY = 86_400_000;

const rows: Row[] = Array.from({ length: 60 }, (_, i) => ({
  ts: new Date(AS_OF - (60 - i) * DAY).toISOString(),
  plan: `plan_${i % 4}`,
  region: `r${i % 3}`,
  amount: 100 + i,
}));

const base = { raw: rows };
const profile = profileDocument({ raw: rows }, "artifact.json", 0);

const ctx = (): PatchContext => ({ profile, base, rect: { w: 1440, h: 900 }, now: AS_OF });

const spec = (over: Record<string, unknown> = {}): DashboardSpec =>
  parseSpec({
    $schema: "disco/v1",
    id: "t",
    title: "T",
    intent: "patch",
    dataset: { source: "artifact.json", mode: "client", rowCount: rows.length },
    controls: [],
    derivations: [
      { op: "groupBy", id: "by_plan", from: "raw", by: ["plan"], agg: { amount: "sum" } },
      { op: "timeBucket", id: "monthly", from: "raw", field: "ts", unit: "month", agg: { amount: "sum" }, fillGaps: true },
    ],
    blocks: [
      {
        kind: "kpi", id: "total", span: 3, from: "raw", field: "amount", agg: "sum", format: "usd",
        compare: { mode: "previous", inverse: false },
        spark: { from: "monthly", x: "bucket", y: "amount" },
      },
      { kind: "bar", id: "by_plan_bar", span: 6, from: "by_plan", x: "plan", y: ["amount"] },
    ],
    notes: [],
    ...over,
  });

const patch = (ops: Patch["ops"], intent = "test"): Patch => ({ $schema: "disco/patch/v1", intent, ops });

const donut: Block = {
  kind: "pie", id: "share", span: 4, from: "by_plan", category: "plan", value: "amount",
  donut: true, format: "usd",
} as Block;

/* ------------------------------------------------------------------ *
 * Transactional behaviour
 * ------------------------------------------------------------------ */

test("a valid patch commits and the result validates", () => {
  const r = applyPatch(spec(), patch([{ op: "addBlock", block: donut }]), ctx());
  assert.equal(r.ok, true, r.ok ? "" : r.reason);
  if (!r.ok) return;
  assert.ok(r.spec.blocks.some((b) => b.id === "share"));
  assert.equal(r.resolved.unresolved.filter((i) => i.level === "error").length, 0);
});

test("a patch that fails partway leaves the original byte-identical", () => {
  // THE property. Five ops, the third impossible. If ops were applied in place
  // the first two would survive and the spec would reference a block that the
  // rest of the patch never finished setting up.
  const original = spec();
  const frozen = JSON.stringify(original);

  const r = applyPatch(
    original,
    patch([
      { op: "setSpan", id: "total", span: 4 },
      { op: "retitle", target: "by_plan_bar", title: "Revenue by plan" },
      { op: "updateBlock", id: "does_not_exist", set: { span: 6 } },
      { op: "addBlock", block: donut },
      { op: "addNote", text: "should never land" },
    ]),
    ctx(),
  );

  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.at, 2, "the failing op index must be reported so an agent can retry from it");
  assert.match(r.reason, /does_not_exist/);
  assert.equal(JSON.stringify(original), frozen, "the input spec was mutated by a rejected patch");
});

test("a rejected patch hands back the validator's own prose", () => {
  // The agent's retry depends on this being actionable rather than a stack trace.
  const r = applyPatch(spec(), patch([{ op: "rebind", blockId: "by_plan_bar", from: "nonexistent" }]), ctx());
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.ok(r.fixes.length > 20);
  assert.match(r.fixes, /ERROR|failed/);
});

test("a block that would be invisible at this window size is rejected, not silently added", () => {
  // Adding something the user cannot see is worse than refusing: they asked for
  // a chart, got a success message, and see nothing.
  // 228px of content, under the scatter's 260px minimum. At 300 wide it
  // actually fits, which the first version of this test got wrong.
  const tiny: PatchContext = { ...ctx(), rect: { w: 260, h: 200 } };
  const scatter: Block = {
    kind: "scatter", id: "cloud", span: 6, from: "raw", x: "amount", y: "amount",
    xScale: "linear", yScale: "linear",
  } as Block;

  const r = applyPatch(spec(), patch([{ op: "addBlock", block: scatter }]), tiny);
  assert.equal(r.ok, false, "a scatter has no degraded form and cannot fit 260x200");
  if (r.ok) return;
  assert.match(r.issues[0].message, /does not fit/);
});

/* ------------------------------------------------------------------ *
 * Garbage collection
 * ------------------------------------------------------------------ */

test("removing a block sweeps the derivations only it used", () => {
  const r = applyPatch(spec(), patch([{ op: "removeBlock", id: "by_plan_bar" }]), ctx());
  assert.equal(r.ok, true, r.ok ? "" : r.reason);
  if (!r.ok) return;
  assert.ok(!r.spec.derivations.some((d) => d.id === "by_plan"), "by_plan is now unreachable and should be gone");
  assert.ok(r.spec.derivations.some((d) => d.id === "monthly"), "monthly is still the KPI's sparkline");
});

test("GC never sweeps a frame a KPI sparkline binds to", () => {
  // The exact bug that shipped once: `spark.from` is a second binding site, and
  // a collector that only walks `from` drops it.
  const swept = gc(spec(), ["raw"]);
  assert.ok(swept.derivations.some((d) => d.id === "monthly"), "the sparkline frame was collected as garbage");
});

test("a control's filter node is a root, not garbage", () => {
  const withControl = spec({
    derivations: [
      { op: "filter", id: "ctl__raw", from: "raw", where: [{ field: "amount", op: "gt", value: 0 }] },
      { op: "groupBy", id: "by_plan", from: "ctl__raw", by: ["plan"], agg: { amount: "sum" } },
      { op: "timeBucket", id: "monthly", from: "raw", field: "ts", unit: "month", agg: { amount: "sum" }, fillGaps: true },
    ],
  });

  const swept = gc(withControl, ["raw"]);
  assert.ok(swept.derivations.some((d) => d.id === "ctl__raw"));
});

/* ------------------------------------------------------------------ *
 * Deduplication
 * ------------------------------------------------------------------ */

test("adding a derivation the dashboard already has collapses to one", () => {
  // "Add revenue share by plan" when a by-plan grouping already exists must not
  // leave two identical groupBys that then drift apart.
  const r = applyPatch(
    spec(),
    patch([
      { op: "addDerivation", derivation: { op: "groupBy", id: "by_plan_again", from: "raw", by: ["plan"], agg: { amount: "sum" } } },
      { op: "addBlock", block: { ...donut, from: "by_plan_again" } as Block },
    ]),
    ctx(),
  );

  assert.equal(r.ok, true, r.ok ? "" : r.reason);
  if (!r.ok) return;

  const groupBys = r.spec.derivations.filter((d) => d.op === "groupBy");
  assert.equal(groupBys.length, 1, "two identical groupBys should have collapsed");
  const share = r.spec.blocks.find((b) => b.id === "share")!;
  assert.equal((share as { from: string }).from, groupBys[0].id, "and the block must follow the survivor");
});

test("derivations that differ only in aggregate do NOT merge", () => {
  // The dangerous direction. Merging these would make two charts silently show
  // the same numbers while claiming different ones.
  const both = spec({
    derivations: [
      { op: "groupBy", id: "sum_plan", from: "raw", by: ["plan"], agg: { amount: "sum" } },
      { op: "groupBy", id: "avg_plan", from: "raw", by: ["plan"], agg: { amount: "avg" } },
    ],
    blocks: [
      { kind: "bar", id: "a", span: 6, from: "sum_plan", x: "plan", y: ["amount"] },
      { kind: "bar", id: "b", span: 6, from: "avg_plan", x: "plan", y: ["amount"] },
    ],
  });

  assert.equal(dedupe(both).derivations.length, 2);
});

test("derivations differing only in id DO merge", () => {
  const twins = spec({
    derivations: [
      { op: "groupBy", id: "a_plan", from: "raw", by: ["plan"], agg: { amount: "sum" } },
      { op: "groupBy", id: "b_plan", from: "raw", by: ["plan"], agg: { amount: "sum" } },
    ],
    blocks: [
      { kind: "bar", id: "a", span: 6, from: "a_plan", x: "plan", y: ["amount"] },
      { kind: "bar", id: "b", span: 6, from: "b_plan", x: "plan", y: ["amount"] },
    ],
  });

  const out = dedupe(twins);
  assert.equal(out.derivations.length, 1);
  const froms = out.blocks.map((b) => (b as { from: string }).from);
  assert.deepEqual(new Set(froms), new Set([out.derivations[0].id]), "both blocks must point at the survivor");
});

test("dedupe compares parents by shape, not by name", () => {
  // Two identically-defined parents under different names must let their
  // identical children collapse too — otherwise every agent edit compounds.
  const nested = spec({
    derivations: [
      { op: "filter", id: "f1", from: "raw", where: [{ field: "amount", op: "gt", value: 100 }] },
      { op: "filter", id: "f2", from: "raw", where: [{ field: "amount", op: "gt", value: 100 }] },
      { op: "groupBy", id: "g1", from: "f1", by: ["plan"], agg: { amount: "sum" } },
      { op: "groupBy", id: "g2", from: "f2", by: ["plan"], agg: { amount: "sum" } },
    ],
    blocks: [
      { kind: "bar", id: "a", span: 6, from: "g1", x: "plan", y: ["amount"] },
      { kind: "bar", id: "b", span: 6, from: "g2", x: "plan", y: ["amount"] },
    ],
  });

  assert.equal(dedupe(nested).derivations.length, 2, "one filter and one groupBy should remain");
});

test("dedupe is stable — the same duplicate always survives", () => {
  const twins = spec({
    derivations: [
      { op: "groupBy", id: "z_plan", from: "raw", by: ["plan"], agg: { amount: "sum" } },
      { op: "groupBy", id: "a_plan", from: "raw", by: ["plan"], agg: { amount: "sum" } },
    ],
    blocks: [{ kind: "bar", id: "a", span: 6, from: "z_plan", x: "plan", y: ["amount"] }],
  });

  // Lexically first wins, so a spec diff does not churn between runs.
  assert.equal(dedupe(twins).derivations[0].id, "a_plan");
});

/* ------------------------------------------------------------------ *
 * Undo
 * ------------------------------------------------------------------ */

test("undo restores the authored spec exactly", () => {
  const before = spec();
  const r = applyPatch(before, patch([{ op: "addBlock", block: donut }], "add a share chart"), ctx());
  assert.equal(r.ok, true);
  if (!r.ok) return;

  const history = new History();
  history.push({ intent: "add a share chart", before, after: r.spec });

  assert.deepEqual(history.undo(), before);
  assert.equal(history.depth, 0);
});

test("undo history stores the AUTHORED spec, so it cannot bake in a repair", () => {
  // A donut converted to a bar during a wide run must still be a donut in the
  // history. Storing the resolved spec would make that conversion permanent the
  // moment anyone undid past it.
  const authored = spec({
    blocks: [{ kind: "pie", id: "share", span: 4, from: "by_plan", category: "plan", value: "amount" }],
  });

  const r = applyPatch(authored, patch([{ op: "retitle", target: "$", title: "Renamed" }]), ctx());
  assert.equal(r.ok, true);
  if (!r.ok) return;

  const history = new History();
  history.push({ intent: "rename", before: authored, after: r.spec });

  const restored = history.undo()!;
  assert.equal(restored.blocks[0].kind, "pie", "the authored donut must survive in history");
});

test("the history stack is bounded", () => {
  const h = new History(3);
  for (let i = 0; i < 10; i++) h.push({ intent: `${i}`, before: spec(), after: spec() });
  assert.equal(h.depth, 3);
});

/* ------------------------------------------------------------------ *
 * Guards
 * ------------------------------------------------------------------ */

test("a block may not bind directly to a control's filter node", () => {
  // Control nodes are injected per render and stripped before writing. A block
  // bound to one would dangle the moment the reader cleared the filter.
  const r = applyPatch(spec(), patch([{ op: "rebind", blockId: "by_plan_bar", from: "ctl__raw" }]), ctx());
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /control/i);
});

test("reorderBlocks demands a full permutation", () => {
  const r = applyPatch(spec(), patch([{ op: "reorderBlocks", ids: ["total"] }]), ctx());
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /permutation/);
});

test("changing a block's kind drops the old kind's fields", () => {
  // Carrying `category` onto a bar chart is legal JSON the schema then rejects
  // with a message about a field the author never wrote.
  const r = applyPatch(
    spec({
      blocks: [{ kind: "pie", id: "share", span: 4, from: "by_plan", category: "plan", value: "amount" }],
    }),
    patch([{ op: "changeKind", id: "share", to: "bar", encoding: { x: "plan", y: ["amount"] } }]),
    ctx(),
  );

  assert.equal(r.ok, true, r.ok ? "" : r.reason);
  if (!r.ok) return;
  const block = r.spec.blocks.find((b) => b.id === "share")! as unknown as Record<string, unknown>;
  assert.equal(block.kind, "bar");
  assert.equal(block.category, undefined, "the pie's category field should not have survived");
});

test("changing a block's kind keeps its data binding", () => {
  // The bug this pins: `from` was treated as a kind-specific field and dropped,
  // so every changeKind produced a block with no data source — which would have
  // broken the donut-to-bar repair, the single most common one there is.
  const r = applyPatch(
    spec({
      derivations: [{ op: "groupBy", id: "by_plan", from: "raw", by: ["plan"], agg: { amount: "sum" } }],
      blocks: [{ kind: "pie", id: "share", span: 4, from: "by_plan", category: "plan", value: "amount" }],
    }),
    patch([{ op: "changeKind", id: "share", to: "bar", encoding: { x: "plan", y: ["amount"] } }]),
    ctx(),
  );

  assert.equal(r.ok, true, r.ok ? "" : `${r.reason}\n${r.fixes}`);
  if (!r.ok) return;
  assert.equal((r.spec.blocks[0] as { from: string }).from, "by_plan");
});

test("a control-filtered spec is valid disco/v1", () => {
  // Control ids are minted, and the schema's id rule is stricter than it looks:
  // a leading underscore fails to parse, which made every filtered spec quietly
  // invalid while the numbers still came out right.
  const filtered = spec({
    controls: [{ kind: "timeRange", id: "range", table: "raw", field: "ts", presets: ["last_7d", "all"], default: "last_7d", anchor: "data_max" }],
  });
  const r = applyPatch(filtered, patch([{ op: "addNote", text: "n" }]), ctx());
  assert.equal(r.ok, true, r.ok ? "" : `${r.reason}\n${r.fixes}`);
  if (!r.ok) return;
  assert.equal(r.resolved.unresolved.filter((i) => i.level === "error").length, 0);
  assert.ok(r.resolved.filtered, "the control should actually be filtering");
});

/* ------------------------------------------------------------------ *
 * The untrusted boundary
 * ------------------------------------------------------------------ */

/**
 * `applyPatch` takes a typed `Patch`, which the compiler cannot guarantee once
 * the patch arrives over HTTP from a model. These cover the parse that stands
 * in front of it.
 */

test("a well-formed patch parses", () => {
  const r = parsePatch({ $schema: "disco/patch/v1", intent: "note it", ops: [{ op: "addNote", text: "hello" }] });
  assert.equal(r.ok, true);
});

test("an unknown op is rejected with a path, not a crash", () => {
  const r = parsePatch({ $schema: "disco/patch/v1", intent: "x", ops: [{ op: "deleteEverything" }] });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.fixes, /ops\.0/, "the failure must name the operation that was wrong");
});

test("a patch missing its schema tag is rejected", () => {
  // Without this, an arbitrary JSON object with an `ops` array would be applied.
  const r = parsePatch({ intent: "x", ops: [{ op: "addNote", text: "hi" }] });
  assert.equal(r.ok, false);
});

test("an empty op list is rejected", () => {
  // A patch that changes nothing still enters the undo history and costs the
  // user a step, so it is a malformed request rather than a no-op.
  const r = parsePatch({ $schema: "disco/patch/v1", intent: "x", ops: [] });
  assert.equal(r.ok, false);
});

test("a block inside addBlock is validated, not waved through", () => {
  const r = parsePatch({
    $schema: "disco/patch/v1",
    intent: "add a pie",
    ops: [{ op: "addBlock", block: { kind: "pie", id: "p", span: 4, from: "by_plan" } }],
  });
  assert.equal(r.ok, false, "the pie is missing `category` and `value`");
  if (r.ok) return;
  assert.match(r.fixes, /ops\.0\.block/);
});

test("the parse rejects a patch that applyPatch would have failed on obscurely", () => {
  // The regression this exists for: a malformed op reached `applyOp`, threw,
  // and the rejection named `undefined` as the failing operation — which is
  // exactly the prose the agent gets handed back for its retry.
  const bad = parsePatch({ $schema: "disco/patch/v1", intent: "x", ops: [{ id: "a" }] });
  assert.equal(bad.ok, false);
  if (bad.ok) return;
  assert.doesNotMatch(bad.fixes, /undefined/);
});
