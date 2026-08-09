import { test } from "node:test";
import assert from "node:assert/strict";

import { fieldBindings, frameBindings, reachableFrames } from "../bindings";
import { validate } from "../validate";
import type { Block, DashboardSpec } from "../spec";
import type { Row } from "../algebra";

/**
 * Regression tests for the binding-site bugs.
 *
 * Every one of these fails against the pre-fix code. They exist because the
 * same question — "where does this block reach into the data?" — was answered
 * in three places and one answer was wrong, which is the shape of bug that
 * comes back unless a test pins it.
 */

const kpiWithSpark: Block = {
  kind: "kpi",
  id: "k1",
  span: 3,
  from: "raw",
  field: "amount",
  agg: "sum",
  format: "usd",
  compare: { mode: "previous", inverse: false },
  spark: { from: "monthly", x: "bucket", y: "amount" },
};

test("a KPI declares BOTH its value frame and its sparkline frame", () => {
  // The materializer collected only `from`, so server mode shipped no spark
  // frame — the sparkline vanished and the delta silently never computed.
  assert.deepEqual(frameBindings(kpiWithSpark), ["raw", "monthly"]);
});

test("a KPI without a sparkline declares only its value frame", () => {
  const bare: Block = { ...kpiWithSpark, spark: undefined };
  assert.deepEqual(frameBindings(bare), ["raw"]);
});

test("a text block binds to no frame at all", () => {
  const text: Block = { kind: "text", id: "t", span: 12, body: "hello", tone: "neutral" };
  assert.deepEqual(frameBindings(text), []);
  assert.deepEqual(fieldBindings(text), []);
});

test("spark fields are attributed to the spark frame, not the value frame", () => {
  // Attributing them to `from` reported fields that exist as missing.
  assert.deepEqual(fieldBindings(kpiWithSpark), [
    { frame: "raw", field: "amount" },
    { frame: "monthly", field: "bucket" },
    { frame: "monthly", field: "amount" },
  ]);
});

test("reachableFrames walks the whole derivation chain, sparklines included", () => {
  const spec = {
    $schema: "disco/v1",
    id: "s",
    title: "T",
    intent: "test",
    dataset: { source: "x.json", mode: "client", rowCount: 1 },
    derivations: [
      { op: "timeBucket", id: "monthly", from: "grouped", field: "ts", unit: "month", agg: { amount: "sum" }, fillGaps: true },
      { op: "groupBy", id: "grouped", from: "raw", by: ["region"], agg: { amount: "sum" } },
      { op: "sort", id: "orphan", from: "raw", by: "amount", dir: "desc" },
    ],
    blocks: [kpiWithSpark],
    notes: [],
  } as unknown as DashboardSpec;

  const reachable = reachableFrames(spec, ["raw"]);
  assert.ok(reachable.has("monthly"), "the spark frame is reachable");
  assert.ok(reachable.has("grouped"), "and so is everything it derives from");
  assert.ok(reachable.has("raw"));
  assert.ok(!reachable.has("orphan"), "a derivation nothing binds to is not reachable");
});

/* ------------------------------------------------------------------ *
 * The validator now checks every binding site
 * ------------------------------------------------------------------ */

const base: Record<string, Row[]> = {
  raw: [
    { ts: "2026-01-05T00:00:00Z", region: "EMEA", amount: 100 },
    { ts: "2026-02-05T00:00:00Z", region: "APAC", amount: 200 },
  ],
};

const specWith = (blocks: unknown[], derivations: unknown[] = []) => ({
  $schema: "disco/v1",
  id: "t",
  title: "T",
  intent: "test",
  dataset: { source: "x.json", mode: "client", rowCount: 2 },
  derivations,
  blocks,
  notes: [],
});

test("a sparkline bound to a frame that does not exist is rejected", () => {
  const r = validate(specWith([kpiWithSpark]), base);
  assert.equal(r.ok, false);
  assert.match(r.issues[0].message, /unknown frame "monthly"/);
});

test("a sparkline bound to a field that does not exist is rejected", () => {
  const r = validate(
    specWith(
      [{ ...kpiWithSpark, spark: { from: "monthly", x: "bucket", y: "nope" } }],
      [{ op: "timeBucket", id: "monthly", from: "raw", field: "ts", unit: "month", agg: { amount: "sum" }, fillGaps: true }],
    ),
    base,
  );
  assert.equal(r.ok, false);
  assert.match(r.issues[0].message, /Field "nope" does not exist in frame "monthly"/);
});

test("a correct sparkline binding passes", () => {
  const r = validate(
    specWith(
      [kpiWithSpark],
      [{ op: "timeBucket", id: "monthly", from: "raw", field: "ts", unit: "month", agg: { amount: "sum" }, fillGaps: true }],
    ),
    base,
  );
  assert.equal(r.ok, true, JSON.stringify(r.issues, null, 2));
});
