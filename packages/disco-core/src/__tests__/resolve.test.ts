import { test } from "node:test";
import assert from "node:assert/strict";

import { resolve } from "../resolve";
import { applyControls, resolveControls, stripControls, isControlId } from "../controls";
import { profileDocument } from "../profile";
import { parseSpec, type DashboardSpec } from "../spec";
import type { Row } from "../algebra";

/**
 * Late binding.
 *
 * These are the scenarios the whole feature exists for: the data changed shape
 * between two runs and the dashboard has to cope without a human editing it,
 * without lying, and without losing the author's intent.
 */

const DAY = 86_400_000;
const AS_OF = Date.parse("2026-08-09T00:00:00Z");

/** A dataset with `categories` distinct values spread over `days`. */
function estate(categories: number, days: number): Record<string, Row[]> {
  const rows: Row[] = [];
  for (let d = 0; d < days; d++) {
    for (let c = 0; c < categories; c++) {
      rows.push({
        ts: new Date(AS_OF - (days - d) * DAY).toISOString(),
        plan: `plan_${c}`,
        amount: 100 + c * 10 + d,
      });
    }
  }
  return { raw: rows };
}

const profileOf = (base: Record<string, Row[]>) =>
  profileDocument({ raw: base.raw }, "artifact.json", 0);

const spec = (over: Partial<DashboardSpec> = {}): DashboardSpec =>
  parseSpec({
    $schema: "disco/v1",
    id: "t",
    title: "T",
    intent: "late binding",
    dataset: { source: "artifact.json", mode: "client", rowCount: 100 },
    controls: [],
    derivations: [{ op: "groupBy", id: "by_plan", from: "raw", by: ["plan"], agg: { amount: "sum" } }],
    blocks: [
      { kind: "pie", id: "share", span: 4, from: "by_plan", category: "plan", value: "amount" },
    ],
    notes: [],
    ...over,
  });

/* ------------------------------------------------------------------ *
 * Growth
 * ------------------------------------------------------------------ */

test("a donut whose categories outgrow the palette becomes a bar, and says so", () => {
  const base = estate(9, 3);
  const authored = spec();

  const r = resolve(authored, profileOf(base), base, { now: AS_OF });

  const block = r.spec.blocks.find((b) => b.id === "share")!;
  assert.equal(block.kind, "bar", "the donut should have been converted");

  const repair = r.repairs.find((x) => x.ruleId === "pie.too_many_categories");
  assert.ok(repair, "the conversion must be surfaced, not silent");
  assert.match(repair!.note, /bar/i);
  assert.match(repair!.because, /9 categories/);
});

test("the authored spec is never mutated, so the donut returns when the data shrinks", () => {
  // The single most important property: a repair is a view, not an edit. If
  // resolve wrote back, a chart converted during one noisy run could never
  // recover, and the dashboard would ratchet permanently downhill.
  const authored = spec();
  const frozen = JSON.stringify(authored);

  const wide = estate(9, 3);
  const r1 = resolve(authored, profileOf(wide), wide, { now: AS_OF });
  assert.equal(r1.spec.blocks[0].kind, "bar");
  assert.equal(JSON.stringify(authored), frozen, "resolve mutated the spec it was given");

  const narrow = estate(4, 3);
  const r2 = resolve(authored, profileOf(narrow), narrow, { now: AS_OF });
  assert.equal(r2.spec.blocks[0].kind, "pie", "the donut must come back once it fits again");
  assert.equal(r2.repairs.length, 0);
});

test("resolve reaches a fixpoint quickly and never loops", () => {
  const base = estate(40, 3);
  const r = resolve(spec(), profileOf(base), base, { now: AS_OF });
  // Every repair steps down a ladder, so the violation set shrinks. Anything
  // that needed all three passes would mean something is oscillating.
  assert.ok(r.repairs.length > 0);
  assert.ok(r.unresolved.filter((i) => i.level === "error").length === 0, "a repairable spec should end clean");
});

test("a repair that hides data is marked lossy", () => {
  // 40 categories cannot be shown; the tail is rolled into Other. A reader must
  // be able to tell that from a chart that simply has 12 categories.
  const base = estate(40, 3);
  const r = resolve(spec(), profileOf(base), base, { now: AS_OF });
  const rolled = r.repairs.find((x) => x.lossy);
  assert.ok(rolled, "rolling a tail into Other hides rows and must say so");
});

/* ------------------------------------------------------------------ *
 * Controls
 * ------------------------------------------------------------------ */

const withTimeControl = () =>
  spec({
    controls: [
      {
        kind: "timeRange",
        id: "range",
        table: "raw",
        field: "ts",
        presets: ["last_7d", "last_30d", "all"],
        default: "last_7d",
        anchor: "data_max",
      },
    ],
  } as Partial<DashboardSpec>);

test("a time control filters at the root, so downstream shares stay correct", () => {
  // The reason controls inject a root filter rather than filtering outputs:
  // a groupBy downstream must aggregate only the rows the reader can see, or
  // every share is a share of the wrong whole.
  const base = estate(4, 30);
  const profile = profileOf(base);

  const all = resolve(withTimeControl(), profile, base, { now: AS_OF, state: { range: "all" } });
  const week = resolve(withTimeControl(), profile, base, { now: AS_OF, state: { range: "last_7d" } });

  const total = (r: typeof all) =>
    [...r.frames.values()]
      .find((fr) => fr.id === "by_plan")!
      .rows.reduce((a, x) => a + Number(x.amount), 0);

  assert.ok(total(week) < total(all), "the narrowed window must aggregate fewer rows");
  assert.ok(total(week) > 0, "and must not filter everything out");
});

test("relative windows anchor to the data, not the wall clock", () => {
  // A batch producer is nearly always behind. Anchoring "last 7 days" to `now`
  // against a run produced last week blanks every block — and the label would
  // still cheerfully say "Last 7 days".
  const base = estate(4, 30);
  const profile = profileOf(base);
  const staleClock = AS_OF + 90 * DAY;

  const r = resolve(withTimeControl(), profile, base, { now: staleClock, state: { range: "last_7d" } });
  const rows = [...r.frames.values()].find((f) => f.id === "by_plan")!.rows;

  assert.ok(rows.length > 0, "anchoring to data_max must still find rows 90 days after the fact");
});

test("controls are stripped back out, so a filtered view is never persisted", () => {
  const authored = withTimeControl();
  const controls = resolveControls(authored, profileOf(estate(4, 30)), { range: "last_7d" }, AS_OF);
  const { spec: filtered } = applyControls(authored, controls);

  assert.ok(filtered.derivations.some((d) => isControlId(d.id)), "a filter node should have been injected");

  const stripped = stripControls(filtered);
  assert.deepEqual(
    stripped.derivations.map((d) => ({ id: d.id, from: d.from })),
    authored.derivations.map((d) => ({ id: d.id, from: d.from })),
    "stripping must restore the authored graph exactly",
  );
});

test("an unselected control changes nothing at all", () => {
  const authored = spec();
  const controls = resolveControls(authored, profileOf(estate(4, 3)), {}, AS_OF);
  const { spec: out, filtered } = applyControls(authored, controls);
  assert.equal(filtered, false);
  assert.equal(out, authored, "with nothing selected the spec should pass through untouched");
});

test("a dimension filter offers values from the live profile, not the spec", () => {
  // A value that first appears in this run must be selectable in this run. A
  // spec written last week cannot be expected to know about it.
  const base = estate(5, 3);
  const authored = spec({
    controls: [{ kind: "dimension", id: "plan", table: "raw", field: "plan", mode: "single", values: [], default: [] }],
  } as Partial<DashboardSpec>);

  const controls = resolveControls(authored, profileOf(base), {}, AS_OF);
  assert.ok((controls[0].options?.length ?? 0) >= 5, "options should come from the profile");
});

test("a selection that vanished between runs is dropped, not left filtering everything out", () => {
  const base = estate(3, 3);
  const authored = spec({
    controls: [{ kind: "dimension", id: "plan", table: "raw", field: "plan", mode: "single", values: [], default: [] }],
  } as Partial<DashboardSpec>);

  // plan_9 existed in an earlier, wider run.
  const controls = resolveControls(authored, profileOf(base), { plan: ["plan_9"] }, AS_OF);
  assert.deepEqual(controls[0].value, [], "a stale selection must not survive into the filter");

  const { filtered } = applyControls(authored, controls);
  assert.equal(filtered, false, "and must therefore not filter at all");
});

/* ------------------------------------------------------------------ *
 * Determinism
 * ------------------------------------------------------------------ */

test("resolve is deterministic — same inputs, same spec and same repairs", () => {
  const base = estate(9, 3);
  const profile = profileOf(base);

  const a = resolve(spec(), profile, base, { now: AS_OF });
  const b = resolve(spec(), profile, base, { now: AS_OF });

  assert.deepEqual(a.spec, b.spec);
  assert.deepEqual(a.repairs, b.repairs);
});

test("resolve reads no clock of its own", () => {
  // `now` is a parameter precisely so this is testable and so server and client
  // cannot disagree. A resolver that read the clock would produce a different
  // window on each side of hydration.
  const base = estate(4, 30);
  const profile = profileOf(base);

  const early = resolve(withTimeControl(), profile, base, { now: AS_OF, state: { range: "last_7d" } });
  const late = resolve(withTimeControl(), profile, base, { now: AS_OF + 5 * DAY, state: { range: "last_7d" } });

  // Anchored to data_max, so the wall clock moving must not change the window.
  assert.deepEqual(early.controls[0].window, late.controls[0].window);
});
