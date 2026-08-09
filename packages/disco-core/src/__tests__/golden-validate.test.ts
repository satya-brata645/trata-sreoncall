import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { formatIssues, validate } from "../validate";
import type { Row } from "../algebra";
import type { DatasetProfile } from "../types";

/**
 * The golden corpus.
 *
 * The rule-table extraction rewrites how the validator is *organised* without
 * changing what it *says*. These snapshots are the contract: message text,
 * issue level, `fix:` prose, the order issues come out in, and the exact
 * whitespace `formatIssues` produces.
 *
 * The whitespace matters more than it looks. `formatIssues` output is pasted
 * back to the composer as a retry prompt, so "ERROR" against "warn " with its
 * trailing space, and the nine-space `fix:` indent, are part of the interface
 * an agent reads — not incidental formatting.
 *
 * Written before the refactor, run after it. A diff here is a behaviour change,
 * which the refactor is not allowed to make.
 */

const rows: Row[] = [
  { ts: "2026-01-05T00:00:00Z", region: "EMEA", plan: "pro", amount: 100, pct: 10, dur: 20 },
  { ts: "2026-02-05T00:00:00Z", region: "APAC", plan: "free", amount: -50, pct: 20, dur: 90 },
  { ts: "2026-03-05T00:00:00Z", region: "LATAM", plan: "pro", amount: 0, pct: 30, dur: 5 },
];

const many = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({ cat: `c${i}`, v: i + 1, ts: `2026-01-01T00:00:00Z` }));

const profile: DatasetProfile = {
  $schema: "disco/profile/v1",
  source: "x.json",
  bytes: 0,
  generatedBy: "disco-profiler@1",
  warnings: [],
  tables: [
    {
      id: "raw",
      path: "$",
      rowCount: 3,
      scanned: 3,
      grain: [],
      timeFields: ["ts"],
      measures: ["amount", "pct", "dur", "running"],
      dimensions: ["region", "plan"],
      fields: [
        {
          name: "running", jsonTypes: ["number"], semantic: "quantitative", role: "measure",
          count: 3, nullCount: 0, nullFraction: 0, distinct: 3, uniqueness: 1, examples: [],
          numeric: { min: 1, max: 3, mean: 2, median: 2, p05: 1, p95: 3, stddev: 1, skew: 0, zeros: 0, negatives: 0, integral: true, monotonic: true },
        },
        {
          name: "pct", jsonTypes: ["number"], semantic: "quantitative", role: "measure", unit: "percent",
          count: 3, nullCount: 0, nullFraction: 0, distinct: 3, uniqueness: 1, examples: [],
        },
        {
          name: "dur", jsonTypes: ["number"], semantic: "quantitative", role: "measure", unit: "ms",
          count: 3, nullCount: 0, nullFraction: 0, distinct: 3, uniqueness: 1, examples: [],
        },
      ],
    },
  ],
};

const spec = (over: Record<string, unknown>) => ({
  $schema: "disco/v1",
  id: "t",
  title: "T",
  intent: "golden",
  dataset: { source: "x.json", mode: "client", rowCount: rows.length },
  derivations: [],
  blocks: [],
  notes: [],
  ...over,
});

const kpi = (over: Record<string, unknown> = {}) => ({
  kind: "kpi", id: "k1", span: 3, from: "raw", field: "amount",
  agg: "sum", format: "usd", compare: { mode: "none", inverse: false }, ...over,
});

/** Every case, named so a diff says which rule changed. */
const CASES: Array<{ name: string; spec: unknown; base: Record<string, Row[]>; profile?: DatasetProfile }> = [
  { name: "valid spec", base: { raw: rows }, spec: spec({ blocks: [kpi(), { kind: "text", id: "t1", span: 12, body: "note", tone: "neutral" }] }) },

  { name: "schema violation", base: { raw: rows }, spec: { $schema: "nope", blocks: [] } },

  { name: "duplicate derivation id", base: { raw: rows }, spec: spec({
    derivations: [
      { op: "sort", id: "d", from: "raw", by: "amount", dir: "desc" },
      { op: "sort", id: "d", from: "raw", by: "amount", dir: "asc" },
    ],
    blocks: [kpi()],
  }) },

  { name: "block id collides with derivation", base: { raw: rows }, spec: spec({
    derivations: [{ op: "sort", id: "k1", from: "raw", by: "amount", dir: "desc" }],
    blocks: [kpi()],
  }) },

  { name: "unknown frame", base: { raw: rows }, spec: spec({ blocks: [kpi({ from: "nope" })] }) },

  { name: "unknown spark frame", base: { raw: rows }, spec: spec({
    blocks: [kpi({ spark: { from: "missing", x: "ts", y: "amount" } })],
  }) },

  { name: "broken derivation graph", base: { raw: rows }, spec: spec({
    derivations: [
      { op: "sort", id: "a", from: "b", by: "amount", dir: "desc" },
      { op: "sort", id: "b", from: "a", by: "amount", dir: "desc" },
    ],
    blocks: [kpi({ from: "a" })],
  }) },

  { name: "empty frame", base: { raw: [] }, spec: spec({ blocks: [kpi()] }) },

  { name: "missing field", base: { raw: rows }, spec: spec({ blocks: [kpi({ field: "nope" })] }) },

  { name: "pie too many categories", base: { raw: many(9) }, spec: spec({
    blocks: [{ kind: "pie", id: "p", span: 4, from: "raw", category: "cat", value: "v", donut: true, format: "number" }],
  }) },

  { name: "pie with negatives", base: { raw: rows }, spec: spec({
    blocks: [{ kind: "pie", id: "p", span: 4, from: "raw", category: "region", value: "amount", donut: true, format: "usd" }],
  }) },

  { name: "bar too many categories", base: { raw: many(30) }, spec: spec({
    blocks: [{ kind: "bar", id: "b", span: 6, from: "raw", x: "cat", y: ["v"], orientation: "vertical", stack: false, format: "number" }],
  }) },

  { name: "timeseries too many points", base: { raw: many(600) }, spec: spec({
    blocks: [{ kind: "timeseries", id: "ts", span: 8, from: "raw", x: "ts", y: ["v"], mark: "line", stack: false, format: "number", connectNulls: false, yScale: "linear" }],
  }) },

  { name: "timeseries stacked single series", base: { raw: rows }, spec: spec({
    blocks: [{ kind: "timeseries", id: "ts", span: 8, from: "raw", x: "ts", y: ["amount"], mark: "area", stack: true, format: "usd", connectNulls: false, yScale: "linear" }],
  }) },

  { name: "timeseries log scale over zero", base: { raw: rows }, spec: spec({
    blocks: [{ kind: "timeseries", id: "ts", span: 8, from: "raw", x: "ts", y: ["amount"], mark: "line", stack: false, format: "usd", connectNulls: false, yScale: "log" }],
  }) },

  { name: "table needs virtualization", base: { raw: many(400) }, spec: spec({
    blocks: [{ kind: "table", id: "tb", span: 12, from: "raw", columns: [{ field: "cat" }], pageSize: 25, virtualize: false }],
  }) },

  { name: "scatter overplot", base: { raw: many(6000) }, spec: spec({
    blocks: [{ kind: "scatter", id: "sc", span: 6, from: "raw", x: "v", y: "v", xScale: "linear", yScale: "linear" }],
  }) },

  { name: "kpi sums a running total", base: { raw: rows }, profile, spec: spec({
    blocks: [kpi({ field: "running", agg: "sum" })],
  }) },

  { name: "kpi sums a percentage", base: { raw: rows }, profile, spec: spec({
    blocks: [kpi({ field: "pct", agg: "sum" })],
  }) },

  { name: "kpi sums a duration", base: { raw: rows }, profile, spec: spec({
    blocks: [kpi({ field: "dur", agg: "sum" })],
  }) },

  { name: "too sparse", base: { raw: rows }, spec: spec({
    blocks: [{ kind: "text", id: "t1", span: 2, body: "hi", tone: "neutral" }],
  }) },

  { name: "too many kpis", base: { raw: rows }, spec: spec({
    blocks: Array.from({ length: 8 }, (_, i) => kpi({ id: `k${i}` })),
  }) },

  { name: "client mode too many rows", base: { raw: rows }, spec: spec({
    dataset: { source: "x.json", mode: "client", rowCount: 40_000 },
    blocks: [kpi()],
  }) },
];

test("validator output is byte-identical across the rule-table refactor", () => {
  const snapshot = CASES.map((c) => {
    const r = validate(c.spec, c.base, c.profile);
    return {
      case: c.name,
      ok: r.ok,
      // Order is part of the contract: the composer reads issues[0] first.
      issues: r.issues.map((i) => ({ level: i.level, where: i.where, message: i.message, fix: i.fix })),
      // Whitespace is part of the contract: this string is a retry prompt.
      formatted: formatIssues(r.issues),
    };
  });

  // Every case must produce a stable, non-empty description.
  for (const s of snapshot) {
    assert.ok(typeof s.ok === "boolean", `${s.case} produced no verdict`);
    assert.ok(s.formatted.length > 0, `${s.case} formatted to nothing`);
  }

  // Cases that exist to trigger a rule must actually trigger one — otherwise the
  // corpus would keep passing while covering nothing.
  for (const s of snapshot) {
    if (s.case === "valid spec") {
      assert.equal(s.issues.length, 0, "the valid spec must stay clean");
      continue;
    }
    assert.ok(s.issues.length > 0, `"${s.case}" triggered no issue — the corpus is not covering it`);
  }

  /*
   * A real golden file, not an in-memory assertion.
   *
   * Written on first run and committed; compared on every run after. That makes
   * a behaviour change show up as a reviewable diff in the repository rather
   * than as a test that quietly re-baselines itself.
   */
  const goldenPath = join(import.meta.dirname, "__golden__", "validate.json");
  const serialized = `${JSON.stringify(snapshot, null, 2)}\n`;

  if (!existsSync(goldenPath)) {
    mkdirSync(dirname(goldenPath), { recursive: true });
    writeFileSync(goldenPath, serialized);
    return;
  }

  assert.equal(
    serialized,
    readFileSync(goldenPath, "utf8"),
    "validator output changed. If the change is intended, delete packages/core/src/__tests__/__golden__/validate.json and re-run to re-baseline — but read the diff first.",
  );
});

test("formatIssues whitespace is exactly what the composer is told to expect", () => {
  const r = validate(
    spec({ blocks: [{ kind: "pie", id: "p", span: 4, from: "raw", category: "cat", value: "v", donut: true, format: "number" }] }),
    { raw: many(9) },
  );
  const out = formatIssues(r.issues);

  // "ERROR" + two spaces; "warn " (already trailing-padded to 5 chars) + two
  // spaces. The padding is what keeps the [id] column aligned between levels.
  assert.match(out, /^ERROR {2}\[p\]/, "errors are ERROR followed by two spaces");
  assert.match(out, /\n {9}fix: /, "fix lines are indented by exactly nine spaces");

  const warned = validate(
    spec({ blocks: [{ kind: "scatter", id: "sc", span: 6, from: "raw", x: "v", y: "v", xScale: "linear", yScale: "linear" }] }),
    { raw: many(6000) },
  );
  assert.match(formatIssues(warned.issues), /^warn {3}\[sc\]/, "warnings are 'warn ' plus two spaces, so the [id] column lines up with ERROR's");
});
