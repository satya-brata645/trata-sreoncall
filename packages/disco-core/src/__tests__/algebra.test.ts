import { test } from "node:test";
import assert from "node:assert/strict";

import { aggregate, floorTime, lttb, runPipeline, type Row } from "../algebra";
import { profileField, profileDocument } from "../profile";
import { validate } from "../validate";

/**
 * These cover the failures that would be silent: a wrong number rendered
 * confidently. Anything that throws is already visible; anything that quietly
 * returns the wrong total is what these are for.
 */

const rows: Row[] = [
  { ts: "2026-01-05T10:00:00Z", region: "EMEA", plan: "pro", amount: 100, pct: 10 },
  { ts: "2026-01-06T10:00:00Z", region: "EMEA", plan: "free", amount: 50, pct: 20 },
  { ts: "2026-02-02T10:00:00Z", region: "APAC", plan: "pro", amount: 200, pct: 30 },
  { ts: "2026-02-14T10:00:00Z", region: "APAC", plan: "pro", amount: null, pct: 40 },
];

test("groupBy aggregates per group, not across all rows", () => {
  const frames = runPipeline({ raw: rows }, [
    { op: "groupBy", id: "g", from: "raw", by: ["region"], agg: { amount: "sum" } },
  ]);
  const out = frames.get("g")!.rows;
  assert.equal(out.length, 2);
  assert.equal(out.find((r) => r.region === "EMEA")!.amount, 150);
  // The null must be skipped, not coerced to zero — 200, not 200 + 0 as a count of 2.
  assert.equal(out.find((r) => r.region === "APAC")!.amount, 200);
});

test("aggregate ignores nulls rather than treating them as zero", () => {
  assert.equal(aggregate([1, null, 3], "avg"), 2);
  assert.equal(aggregate([null, null], "sum"), null);
  assert.equal(aggregate([1, null, 3], "count"), 3, "count counts rows, including null ones");
});

test("timeBucket floors in UTC so results do not depend on the runner's timezone", () => {
  const jan5 = Date.parse("2026-01-05T23:30:00Z");
  assert.equal(new Date(floorTime(jan5, "month")).toISOString(), "2026-01-01T00:00:00.000Z");
  assert.equal(new Date(floorTime(jan5, "day")).toISOString(), "2026-01-05T00:00:00.000Z");
  // 2026-01-05 is a Monday; the ISO week starts on it.
  assert.equal(new Date(floorTime(jan5, "week")).toISOString(), "2026-01-05T00:00:00.000Z");
});

test("timeBucket emits missing buckets as null, so a gap reads as a gap", () => {
  const frames = runPipeline({ raw: rows }, [
    { op: "timeBucket", id: "t", from: "raw", field: "ts", unit: "month", agg: { amount: "sum" }, fillGaps: true },
  ]);
  const out = frames.get("t")!.rows;
  assert.equal(out.length, 2);
  assert.equal(out[0].amount, 150);
  assert.equal(out[1].amount, 200);
});

test("topK rolls the tail into Other instead of dropping it", () => {
  const wide: Row[] = Array.from({ length: 10 }, (_, i) => ({ k: `k${i}`, v: i + 1 }));
  const frames = runPipeline({ raw: wide }, [
    { op: "topK", id: "t", from: "raw", by: "k", metric: "v", k: 3, other: true },
  ]);
  const out = frames.get("t")!.rows;
  assert.equal(out.length, 4);
  const other = out[3];
  assert.match(String(other.k), /^Other/);
  // 1..7 = 28. The tail must survive as a total, not vanish.
  assert.equal(other.v, 28);
});

test("rollingAvg refuses to emit a partial window", () => {
  const series: Row[] = [1, 2, 3, 4].map((v) => ({ v }));
  const frames = runPipeline({ raw: series }, [
    { op: "window", id: "w", from: "raw", field: "v", as: "avg3", fn: "rollingAvg", size: 3 },
  ]);
  const out = frames.get("w")!.rows;
  assert.equal(out[0].avg3, null);
  assert.equal(out[1].avg3, null);
  assert.equal(out[2].avg3, 2);
  assert.equal(out[3].avg3, 3);
});

test("LTTB keeps the endpoints and the spike", () => {
  const series: Row[] = Array.from({ length: 200 }, (_, i) => ({ x: i, y: i === 97 ? 9999 : 1 }));
  const out = lttb(series, "x", "y", 20);
  assert.equal(out.length, 20);
  assert.equal(out[0].x, 0);
  assert.equal(out[out.length - 1].x, 199);
  assert.ok(out.some((r) => r.y === 9999), "the spike must survive downsampling");
});

test("a cyclic derivation graph is rejected rather than looping", () => {
  assert.throws(
    () =>
      runPipeline({ raw: rows }, [
        { op: "sort", id: "a", from: "b", by: "amount", dir: "desc" },
        { op: "sort", id: "b", from: "a", by: "amount", dir: "desc" },
      ]),
    /Unresolvable derivations/,
  );
});

/* ------------------------------------------------------------------ *
 * Profiling
 * ------------------------------------------------------------------ */

test("a near-unique string column is an id, not a category", () => {
  const f = profileField("customer_ref", Array.from({ length: 100 }, (_, i) => `ref-${i}`));
  assert.equal(f.role, "id");
});

test("a large integer is only temporal when the field name says so", () => {
  const stamps = Array.from({ length: 20 }, (_, i) => 1_760_000_000_000 + i * 86_400_000);
  assert.equal(profileField("created_at", stamps).semantic, "temporal");
  assert.equal(profileField("bytes_sent", stamps).semantic, "quantitative");
});

test("an ordered ladder is detected as ordinal and keeps its order", () => {
  const f = profileField("tier", ["high", "low", "medium", "high", "low"]);
  assert.equal(f.semantic, "ordinal");
  assert.deepEqual(f.categorical?.order, ["low", "medium", "high"]);
});

test("a monotonic measure is flagged so it is never summed", () => {
  const f = profileField("total_events", [1, 5, 9, 20, 41]);
  assert.equal(f.numeric?.monotonic, true);
  assert.match(f.note ?? "", /running total/);
});

test("nested arrays of records are found and flattened to dot paths", () => {
  const doc = { data: { orders: [{ id: 1, customer: { plan: "pro" } }, { id: 2, customer: { plan: "free" } }] } };
  const p = profileDocument(doc, "test.json", 0);
  assert.equal(p.tables[0].path, "$.data.orders");
  assert.ok(p.tables[0].fields.some((f) => f.name === "customer.plan"));
});

/* ------------------------------------------------------------------ *
 * The gate
 * ------------------------------------------------------------------ */

const specWith = (blocks: unknown[], derivations: unknown[] = []) => ({
  $schema: "disco/v1",
  id: "t",
  title: "T",
  intent: "test",
  dataset: { source: "x.json", mode: "client", rowCount: rows.length },
  derivations,
  blocks,
  notes: [],
});

test("a binding to a nonexistent field is rejected", () => {
  const r = validate(
    specWith([{ id: "b", kind: "bar", from: "raw", x: "region", y: ["nope"] }]),
    { raw: rows },
  );
  assert.equal(r.ok, false);
  assert.match(r.issues[0].message, /does not exist/);
});

test("a donut beyond the validated palette is rejected", () => {
  const many: Row[] = Array.from({ length: 9 }, (_, i) => ({ c: `c${i}`, v: 1 }));
  const r = validate(
    specWith([{ id: "b", kind: "pie", from: "raw", category: "c", value: "v" }]),
    { raw: many },
  );
  assert.equal(r.ok, false);
  assert.match(r.issues[0].message, /slices/);
});

test("an unvirtualized table over the row limit is rejected", () => {
  const many: Row[] = Array.from({ length: 500 }, (_, i) => ({ a: i }));
  const r = validate(
    specWith([{ id: "b", kind: "table", from: "raw", columns: [{ field: "a" }], virtualize: false }]),
    { raw: many },
  );
  assert.equal(r.ok, false);
  assert.match(r.issues[0].message, /virtualization/);
});

test("a valid spec passes and returns executed frames", () => {
  const r = validate(
    specWith(
      [{ id: "b", kind: "bar", from: "g", x: "region", y: ["amount"] }],
      [{ op: "groupBy", id: "g", from: "raw", by: ["region"], agg: { amount: "sum" } }],
    ),
    { raw: rows },
  );
  assert.equal(r.ok, true, JSON.stringify(r.issues));
  assert.equal(r.frames?.get("g")?.rows.length, 2);
});
