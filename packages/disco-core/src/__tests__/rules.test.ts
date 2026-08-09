import { test } from "node:test";
import assert from "node:assert/strict";

import { RULES, type Repair, type Rule, type RuleContext } from "../rules";
import { LIMITS, aggFor } from "../limits";
import { validate } from "../validate";
import type { Row } from "../algebra";
import type { DatasetProfile } from "../types";

/**
 * The rule table.
 *
 * The claim this file exists to prove is the one the whole design rests on:
 * a rule's message, its prose fix and its executable repair come from the same
 * measured facts, so they cannot disagree. Asserting that is not a matter of
 * reading the code — it is applying each repair and checking the violation is
 * actually gone.
 */

const rows: Row[] = [
  { ts: "2026-01-05T00:00:00Z", region: "EMEA", amount: 100, pct: 10, dur: 20, running: 1 },
  { ts: "2026-02-05T00:00:00Z", region: "APAC", amount: -50, pct: 20, dur: 90, running: 2 },
  { ts: "2026-03-05T00:00:00Z", region: "LATAM", amount: 0, pct: 30, dur: 5, running: 3 },
];

const many = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({ cat: `c${i}`, v: i + 1, ts: "2026-01-01T00:00:00Z" }));

const profile: DatasetProfile = {
  $schema: "disco/profile/v1",
  source: "x.json",
  bytes: 0,
  generatedBy: "disco-profiler@1",
  warnings: [],
  tables: [{
    id: "raw", path: "$", rowCount: 3, scanned: 3, grain: [],
    timeFields: ["ts"], measures: ["running", "pct", "dur"], dimensions: ["region"],
    fields: [
      { name: "running", jsonTypes: ["number"], semantic: "quantitative", role: "measure",
        count: 3, nullCount: 0, nullFraction: 0, distinct: 3, uniqueness: 1, examples: [],
        numeric: { min: 1, max: 3, mean: 2, median: 2, p05: 1, p95: 3, stddev: 1, skew: 0, zeros: 0, negatives: 0, integral: true, monotonic: true } },
      { name: "pct", jsonTypes: ["number"], semantic: "quantitative", role: "measure", unit: "percent",
        count: 3, nullCount: 0, nullFraction: 0, distinct: 3, uniqueness: 1, examples: [] },
      { name: "dur", jsonTypes: ["number"], semantic: "quantitative", role: "measure", unit: "ms",
        count: 3, nullCount: 0, nullFraction: 0, distinct: 3, uniqueness: 1, examples: [] },
    ],
  }],
};

const spec = (over: Record<string, unknown>) => ({
  $schema: "disco/v1", id: "t", title: "T", intent: "rules",
  dataset: { source: "x.json", mode: "client", rowCount: 3 },
  derivations: [], blocks: [], notes: [], ...over,
});

/** One spec per repairable rule, chosen so exactly that rule fires. */
const REPAIRABLE: Array<{ ruleId: string; base: Record<string, Row[]>; spec: unknown; profile?: DatasetProfile }> = [
  {
    ruleId: "pie.too_many_categories",
    base: { raw: many(9) },
    spec: spec({ blocks: [{ kind: "pie", id: "p", span: 4, from: "raw", category: "cat", value: "v", donut: true, format: "number" }] }),
  },
  {
    ruleId: "pie.negative_values",
    base: { raw: rows },
    spec: spec({ blocks: [{ kind: "pie", id: "p", span: 4, from: "raw", category: "region", value: "amount", donut: true, format: "usd" }] }),
  },
  {
    ruleId: "bar.too_many_series",
    base: { raw: rows },
    spec: spec({ blocks: [{ kind: "bar", id: "b", span: 6, from: "raw", x: "region", y: ["amount", "pct", "dur", "running", "amount", "pct", "dur"], orientation: "vertical", stack: false, format: "number" }] }),
  },
  {
    ruleId: "timeseries.too_many_series",
    base: { raw: rows },
    spec: spec({ blocks: [{ kind: "timeseries", id: "ts", span: 8, from: "raw", x: "ts", y: ["amount", "pct", "dur", "running", "amount", "pct", "dur"], mark: "line", stack: false, format: "number", connectNulls: false, yScale: "linear" }] }),
  },
  {
    ruleId: "timeseries.stack_single_series",
    base: { raw: rows },
    spec: spec({ blocks: [{ kind: "timeseries", id: "ts", span: 8, from: "raw", x: "ts", y: ["amount"], mark: "area", stack: true, format: "usd", connectNulls: false, yScale: "linear" }] }),
  },
  {
    ruleId: "timeseries.log_scale_nonpositive",
    base: { raw: rows },
    spec: spec({ blocks: [{ kind: "timeseries", id: "ts", span: 8, from: "raw", x: "ts", y: ["amount"], mark: "line", stack: false, format: "usd", connectNulls: false, yScale: "log" }] }),
  },
  {
    ruleId: "table.needs_virtualization",
    base: { raw: many(400) },
    spec: spec({ blocks: [{ kind: "table", id: "tb", span: 12, from: "raw", columns: [{ field: "cat" }], pageSize: 25, virtualize: false }] }),
  },
  {
    ruleId: "kpi.sum_monotonic",
    base: { raw: rows }, profile,
    spec: spec({ blocks: [{ kind: "kpi", id: "k", span: 3, from: "raw", field: "running", agg: "sum", format: "number", compare: { mode: "none", inverse: false } }] }),
  },
  {
    ruleId: "kpi.sum_percent",
    base: { raw: rows }, profile,
    spec: spec({ blocks: [{ kind: "kpi", id: "k", span: 3, from: "raw", field: "pct", agg: "sum", format: "percent", compare: { mode: "none", inverse: false } }] }),
  },
  {
    ruleId: "kpi.sum_duration",
    base: { raw: rows }, profile,
    spec: spec({ blocks: [{ kind: "kpi", id: "k", span: 3, from: "raw", field: "dur", agg: "sum", format: "ms", compare: { mode: "none", inverse: false } }] }),
  },
  {
    ruleId: "spec.client_mode_too_many_rows",
    base: { raw: rows },
    spec: spec({ dataset: { source: "x.json", mode: "client", rowCount: 40_000 }, blocks: [{ kind: "kpi", id: "k", span: 3, from: "raw", field: "amount", agg: "sum", format: "usd", compare: { mode: "none", inverse: false } }] }),
  },
];

test("every repairable rule has a case that actually triggers it", () => {
  // Without this, a repair could quietly stop firing and the round-trip test
  // below would keep passing while testing nothing.
  for (const c of REPAIRABLE) {
    const r = validate(c.spec, c.base, c.profile);
    const fired = r.violations?.some((v) => v.rule.id === c.ruleId);
    assert.ok(fired, `"${c.ruleId}" did not fire — got ${r.violations?.map((v) => v.rule.id).join(", ") || "nothing"}`);
  }
});

test("a repair clears the violation it was emitted for", () => {
  // THE test. If message, fix and repair could drift apart, this is where it
  // shows: the repair would be applied and `detect` would still return a
  // violation, because the fix and the code disagreed about what was wrong.
  for (const c of REPAIRABLE) {
    const result = validate(c.spec, c.base, c.profile);
    const found = result.violations?.find((v) => v.rule.id === c.ruleId);
    assert.ok(found, `${c.ruleId} did not fire`);

    const { rule, violation } = found!;
    assert.ok(rule.repair, `${c.ruleId} is in the repairable list but has no repair`);

    let minted = 0;
    const ctx: RuleContext = {
      spec: (c.spec as { blocks: unknown[] }) as never,
      frames: result.frames ?? new Map(),
      profile: c.profile,
      frameIds: new Set(Object.keys(c.base)),
      filtered: false,
      mintId: (p) => `${p}_${++minted}`,
      canRewriteDerivations: true,
    };

    const repair = rule.repair!(violation, ctx) as Repair | null;
    assert.ok(repair, `${c.ruleId} produced no repair`);
    assert.ok(repair!.ops.length > 0, `${c.ruleId} produced an empty repair`);
    assert.ok(repair!.note.length > 8, `${c.ruleId} repaired without saying what it did`);

    // Apply the encoding-only ops by hand — patch.ts does not exist yet, and
    // this test must not wait for it to prove the invariant.
    const applied = structuredClone(c.spec) as {
      blocks: Array<Record<string, unknown>>;
      dataset: Record<string, unknown>;
    };
    for (const op of repair!.ops) {
      if (op.op === "updateBlock") {
        const b = applied.blocks.find((x) => x.id === op.id);
        Object.assign(b!, op.set as object);
      } else if (op.op === "setMode") {
        applied.dataset.mode = op.mode;
      } else if (op.op === "changeKind") {
        const b = applied.blocks.find((x) => x.id === op.id);
        Object.assign(b!, { kind: op.to }, op.encoding as object);
      }
    }

    // Ops that rewrite derivations need the patch engine's GC and rebinding, so
    // they are checked in patch.test.ts instead of half-simulated here.
    const structural = repair!.ops.some((o) => o.op === "addDerivation" || o.op === "rebind");
    if (structural) continue;

    const after = validate(applied, c.base, c.profile);
    const still = after.violations?.some((v) => v.rule.id === c.ruleId);
    assert.ok(!still, `${c.ruleId} still fires after its own repair was applied`);
  }
});

test("a repair that hides data says so", () => {
  // `lossy` drives the badge that tells a reader a chart is showing less than
  // it appears to. Getting it wrong makes a truncated chart look complete.
  const lossyRules = ["bar.too_many_series", "timeseries.too_many_series"];
  for (const c of REPAIRABLE.filter((x) => lossyRules.includes(x.ruleId))) {
    const result = validate(c.spec, c.base, c.profile);
    const found = result.violations?.find((v) => v.rule.id === c.ruleId)!;
    const ctx = {
      spec: c.spec as never, frames: result.frames ?? new Map(), profile: c.profile,
      frameIds: new Set(Object.keys(c.base)), filtered: false,
      mintId: (p: string) => p, canRewriteDerivations: true,
    } as RuleContext;
    assert.equal(found.rule.repair!(found.violation, ctx)!.lossy, true, `${c.ruleId} drops data but is not marked lossy`);
  }
});

test("no repair is available in server mode where derivations cannot be rewritten", () => {
  // Server mode ships frames, not rows, so there is nothing to re-run a
  // rewritten pipeline against. Pretending otherwise would produce a spec whose
  // derivations reference data the browser does not have.
  const c = REPAIRABLE.find((x) => x.ruleId === "pie.too_many_categories")!;
  const result = validate(c.spec, c.base);
  const found = result.violations?.find((v) => v.rule.id === c.ruleId)!;

  const ctx = (canRewriteDerivations: boolean) => ({
    spec: c.spec as never, frames: result.frames ?? new Map(), profile: undefined,
    frameIds: new Set(Object.keys(c.base)), filtered: false,
    mintId: (p: string) => p, canRewriteDerivations,
  }) as RuleContext;

  // 9 categories is within bar range, so the encoding-only repair still works.
  assert.ok(found.rule.repair!(found.violation, ctx(false)), "an encoding-only repair works in server mode");

  // 30 categories needs a topK derivation, which server mode cannot add.
  const wide = validate(
    spec({ blocks: [{ kind: "pie", id: "p", span: 4, from: "raw", category: "cat", value: "v", donut: true, format: "number" }] }),
    { raw: many(30) },
  );
  const wideFound = wide.violations?.find((v) => v.rule.id === "pie.too_many_categories")!;
  const wideCtx = { ...ctx(false), frames: wide.frames ?? new Map() };
  assert.equal(wideFound.rule.repair!(wideFound.violation, wideCtx), null, "a derivation-rewriting repair is unavailable in server mode");
});

test("the aggregate repair sets exactly what the fix string promised", () => {
  // These two came from separate code paths before the rule table. The message
  // said `agg: "last"` and nothing guaranteed the repair agreed.
  for (const c of REPAIRABLE.filter((x) => x.ruleId.startsWith("kpi.sum_"))) {
    const result = validate(c.spec, c.base, c.profile);
    const found = result.violations?.find((v) => v.rule.id === c.ruleId)!;
    const promised = found.rule.fix(found.violation)!;
    const ctx = {
      spec: c.spec as never, frames: result.frames ?? new Map(), profile: c.profile,
      frameIds: new Set(Object.keys(c.base)), filtered: false,
      mintId: (p: string) => p, canRewriteDerivations: true,
    } as RuleContext;
    const agg = found.rule.repair!(found.violation, ctx)!.ops[0].set as { agg: string };

    assert.ok(promised.includes(`"${agg.agg}"`), `fix says ${promised} but the repair set "${agg.agg}"`);

    // And the value both used came from aggFor against the same profiled
    // field, so neither the prose nor the repair can drift from the profiler.
    const fieldName = (found.violation.facts as { field: string }).field;
    const profiled = profile.tables[0].fields.find((f) => f.name === fieldName)!;
    assert.equal(agg.agg, aggFor(profiled), `repair set "${agg.agg}" but aggFor(${fieldName}) says "${aggFor(profiled)}"`);
  }
});

test("every rule declares a scope the sequencer can act on", () => {
  const kinds = new Set(["kpi", "timeseries", "bar", "pie", "scatter", "histogram", "heatmap", "table", "text"]);
  for (const r of RULES) {
    if (r.scope === "$") continue;
    assert.ok(r.scope.length > 0, `${r.id} has an empty scope and would never run`);
    for (const k of r.scope) assert.ok(kinds.has(k), `${r.id} scopes to unknown kind "${k}"`);
  }
});

test("rule ids are unique", () => {
  const seen = new Set<string>();
  for (const r of RULES as Rule[]) {
    assert.ok(!seen.has(r.id), `duplicate rule id ${r.id}`);
    seen.add(r.id);
  }
});

test("the perceptual limits a rule cites are the ones it enforces", () => {
  // A message that names a threshold different from the one it checks is worse
  // than no message: it sends the reader to fix the wrong number.
  const c = REPAIRABLE.find((x) => x.ruleId === "pie.too_many_categories")!;
  const r = validate(c.spec, c.base);
  const issue = r.issues.find((i) => i.ruleId === "pie.too_many_categories")!;
  assert.match(issue.message, new RegExp(`above ${LIMITS.PIE_MAX_CATEGORIES}`));
});
