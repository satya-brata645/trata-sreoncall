import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildRunDocument, runIdFromAsOf, tableCounts } from "../../bin/seed-artifacts";
import { latestRun, listRuns, readRun } from "../../../../lib/artifacts/read";
import { profileDocument } from "../profile";

/**
 * The artifact contract.
 *
 * Two claims are load-bearing and neither is visible by reading the code:
 * that a run document profiles into the tables blocks bind to by name, and
 * that the producer is a pure function of its arguments. The second one has
 * already cost this repo twice — a generator that read the clock desynced
 * server rendering from hydration, and a test that did the same could not be
 * reproduced once it failed.
 */

const ASOF = "2026-08-09T11:00:00.000Z";
const SEED = 424242;

const TABLES = [
  "metrics",
  "metric_spark",
  "pipeline",
  "attention",
  "service_axes",
  "incidents",
  "services",
  "sources",
  "alert_series",
  "cause_mix",
  "severity_mix",
  "incident_heat",
];

/* ------------------------------------------------------------------ *
 * Shape
 * ------------------------------------------------------------------ */

test("a seeded run profiles into the expected named tables", () => {
  const doc = buildRunDocument({ asOf: ASOF, windowDays: 30, seed: SEED });
  const profile = profileDocument(doc, "dashboard.json", 0);

  // The largest table keeps the historical "raw" id, so a name has to be
  // reachable through the alias too — otherwise a spec binding to
  // `alert_series` would resolve to nothing on the biggest table in the file.
  const names = new Set(profile.tables.flatMap((t) => (t.alias ? [t.id, t.alias] : [t.id])));

  for (const name of TABLES) {
    assert.ok(names.has(name), `expected a table named "${name}", got ${[...names].sort().join(", ")}`);
  }

  // Exactly at the profiler's MAX_TABLES. One more and the smallest table
  // disappears with no error at all, which is why the producer asserts it too.
  assert.equal(Object.keys(tableCounts(doc)).length, 12);
});

test("the run header describes the window that was asked for", () => {
  const doc = buildRunDocument({ asOf: ASOF, windowDays: 30, seed: SEED });

  assert.equal(doc.run.asOf, ASOF);
  assert.equal(doc.run.windowDays, 30);
  assert.equal(doc.run.id, runIdFromAsOf(ASOF));
  // producedAt is asOf by construction; a wall-clock field would be the one
  // value in the document that breaks byte-comparison.
  assert.equal(doc.run.producedAt, ASOF);

  // One point per metric-day, ending at asOf: the widest window is the file,
  // and narrower views are a filter over it.
  const mttr = doc.metric_spark.filter((s) => s.metric_id === "mttr");
  assert.equal(mttr.length, 30);
  assert.equal(mttr[mttr.length - 1].t, ASOF);
});

/* ------------------------------------------------------------------ *
 * Determinism
 * ------------------------------------------------------------------ */

test("the same seed and asOf produce byte-identical output", () => {
  const a = JSON.stringify(buildRunDocument({ asOf: ASOF, windowDays: 30, seed: SEED }), null, 2);
  const b = JSON.stringify(buildRunDocument({ asOf: ASOF, windowDays: 30, seed: SEED }), null, 2);

  assert.equal(a, b);
  // Cheap sanity check that the comparison is not passing on an empty object.
  assert.ok(a.length > 10_000, `document looks empty (${a.length} bytes)`);
});

test("a different seed produces a different document at the same instant", () => {
  const a = JSON.stringify(buildRunDocument({ asOf: ASOF, windowDays: 30, seed: SEED }));
  const b = JSON.stringify(buildRunDocument({ asOf: ASOF, windowDays: 30, seed: SEED + 1 }));

  // Without this, "identical twice" would also pass for a producer that
  // ignores its arguments entirely.
  assert.notEqual(a, b);
});

/* ------------------------------------------------------------------ *
 * Reading runs
 * ------------------------------------------------------------------ */

function withRunsDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "disco-runs-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeRun(dir: string, id: string, body: string): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "dashboard.json"), body);
}

const stub = (id: string, asOf: string) =>
  JSON.stringify({ run: { id, asOf, windowDays: 30, producedAt: asOf }, metrics: [] });

test("a half-written run is never listed", () => {
  withRunsDir((dir) => {
    writeRun(dir, "2026-08-09T10-00-00-000Z", stub("2026-08-09T10-00-00-000Z", "2026-08-09T10:00:00.000Z"));
    // Truncated mid-write: valid-looking prefix, no closing brace.
    writeRun(dir, "2026-08-09T11-00-00-000Z", '{"run": {"id": "2026-08-09T11-00-00-000Z", "asOf"');
    // A directory that exists before its document does.
    mkdirSync(join(dir, "2026-08-09T12-00-00-000Z"), { recursive: true });

    const ids = listRuns(dir).map((r) => r.id);
    assert.deepEqual(ids, ["2026-08-09T10-00-00-000Z"]);

    // And the incomplete run is not reachable directly either — otherwise the
    // stream could hand out an id the reader then fails to load.
    assert.equal(readRun("2026-08-09T11-00-00-000Z", dir), null);
    assert.equal(latestRun(dir)?.id, "2026-08-09T10-00-00-000Z");
  });
});

test("runs sort newest first", () => {
  withRunsDir((dir) => {
    // Deliberately written out of order, and spanning the digit-width changes
    // (09 -> 10) that a naive sort gets wrong.
    const ids = [
      "2026-08-09T09-00-00-000Z",
      "2026-08-10T00-00-00-000Z",
      "2026-08-09T23-30-00-000Z",
      "2026-07-31T23-59-59-999Z",
    ];
    for (const id of ids) writeRun(dir, id, stub(id, id.replace(/-/g, ":")));

    assert.deepEqual(
      listRuns(dir).map((r) => r.id),
      [
        "2026-08-10T00-00-00-000Z",
        "2026-08-09T23-30-00-000Z",
        "2026-08-09T09-00-00-000Z",
        "2026-07-31T23-59-59-999Z",
      ],
    );
    assert.equal(latestRun(dir)?.id, "2026-08-10T00-00-00-000Z");
  });
});

test("a run id derived from asOf sorts chronologically as a string", () => {
  // The claim listRuns depends on: ISO is fixed-width and big-endian, so
  // replacing the separators leaves byte order equal to time order.
  const instants = [
    "2025-12-31T23:59:59.999Z",
    "2026-01-01T00:00:00.000Z",
    "2026-08-09T09:00:00.000Z",
    "2026-08-09T10:00:00.000Z",
  ];
  const ids = instants.map(runIdFromAsOf);

  assert.deepEqual([...ids].sort(), ids);
  for (const id of ids) assert.match(id, /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
});

test("readRun refuses an id that is not a single path segment", () => {
  withRunsDir((dir) => {
    // The id reaches this function from a query string.
    assert.equal(readRun("../../etc/passwd", dir), null);
    assert.equal(readRun("", dir), null);
  });
});
