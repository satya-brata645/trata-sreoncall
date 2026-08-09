import { test } from "node:test";
import assert from "node:assert/strict";

import { buildBaseTables, profileDocument, tableIdFromPath, withAliases } from "../profile";

/**
 * Named tables.
 *
 * A multi-table artifact binds blocks to tables by name. Positional ids made
 * that binding meaningless and fragile: adding a key earlier in the producer's
 * JSON would silently repoint every block in the spec at different data, and
 * nothing would error — the dashboard would just start lying.
 */

const artifact = {
  run: { id: "r1", asOf: "2026-08-09T11:00:00Z" },
  metrics: [
    { id: "mttr", label: "MTTR", value: 28 },
    { id: "mtta", label: "MTTA", value: 7 },
  ],
  incidents: Array.from({ length: 40 }, (_, i) => ({
    id: `INC-${i}`,
    service: i % 2 ? "checkout" : "auth",
    started_at: `2026-08-0${(i % 8) + 1}T00:00:00Z`,
    minutes: i,
  })),
  services: [
    { service: "checkout", availability: 99.9 },
    { service: "auth", availability: 99.95 },
  ],
  alert_series: Array.from({ length: 10 }, (_, i) => ({ t: `2026-08-0${i % 9}T00:00:00Z`, alerts: i })),
};

test("tables are named from their JSON path, not their position", () => {
  const p = profileDocument(artifact, "artifact.json", 0);
  const ids = new Set(p.tables.map((t) => t.id));

  // `incidents` is the largest, so it keeps the historical "raw" id …
  assert.ok(ids.has("raw"));
  // … and also answers to its own name, so a spec need never say "raw".
  assert.equal(p.tables[0].alias, "incidents");

  for (const name of ["metrics", "services", "alert_series"]) {
    assert.ok(ids.has(name), `expected a table named "${name}", got ${[...ids].join(", ")}`);
  }
});

test("reordering the producer's JSON does not rename a single table", () => {
  // The failure this pins: a producer adds a key, every id shifts by one, and
  // every block in every pinned spec silently rebinds.
  const reordered = {
    alert_series: artifact.alert_series,
    services: artifact.services,
    run: artifact.run,
    metrics: artifact.metrics,
    incidents: artifact.incidents,
  };

  const a = profileDocument(artifact, "a.json", 0);
  const b = profileDocument(reordered, "b.json", 0);

  const nameOf = (p: typeof a, path: string) => p.tables.find((t) => t.path === path)?.id;
  for (const path of ["$.metrics", "$.services", "$.alert_series"]) {
    assert.equal(nameOf(a, path), nameOf(b, path), `"${path}" changed id when the JSON was reordered`);
  }
});

test("a name collision gets a suffix rather than silently overwriting", () => {
  const taken = new Set(["orders"]);
  assert.equal(tableIdFromPath("$.orders", taken), "orders_2");
  taken.add("orders_2");
  assert.equal(tableIdFromPath("$.orders", taken), "orders_3");
});

test("nested and awkward paths still produce usable identifiers", () => {
  const t = new Set<string>();
  assert.equal(tableIdFromPath("$.data.orders", t), "data_orders");
  assert.equal(tableIdFromPath("$.orders[].items", t), "orders_items");
  // A path that would start with a digit is not a comfortable identifier.
  assert.match(tableIdFromPath("$.2024", t), /^[a-z]/);
});

test("base tables are keyed by every id a block may bind to", () => {
  const p = profileDocument(artifact, "artifact.json", 0);
  const base = buildBaseTables(artifact, p);

  assert.ok(base.raw, "the primary table is reachable as raw");
  assert.ok(base.incidents, "and under its own name");
  assert.equal(base.raw.length, base.incidents.length);
  assert.equal(base.metrics.length, 2);
  assert.equal(base.services.length, 2);
});

test("base tables match by path, so a table that changed size still binds", () => {
  // Between runs a table can grow past another and change discovery order.
  // Matching positionally would swap two tables' data without any error.
  const profile = profileDocument(artifact, "artifact.json", 0);

  const grown = {
    ...artifact,
    alert_series: Array.from({ length: 500 }, (_, i) => ({ t: `2026-08-01T00:00:00Z`, alerts: i })),
  };

  const base = buildBaseTables(grown, profile);
  assert.equal(base.alert_series.length, 500, "alert_series must still resolve to alert_series");
  assert.equal(base.metrics.length, 2, "and metrics must not have been swapped for something else");
});

test("aliases are never serialized — they would double the payload", () => {
  // The failure this pins: an alias shares a reference in memory but
  // JSON.stringify expands it into a full second copy. Materializing the
  // orders fixture went from 1.5 MB to 3 MB with nothing gained.
  const profile = profileDocument(artifact, "artifact.json", 0);

  const written = buildBaseTables(artifact, profile, { aliases: false });
  assert.equal(written.incidents, undefined, "the alias must not be in the written form");
  assert.ok(written.raw, "the canonical id must be");

  const rowsWritten = Object.values(written).reduce((a, r) => a + r.length, 0);
  const rowsInDoc = artifact.metrics.length + artifact.incidents.length + artifact.services.length + artifact.alert_series.length;
  assert.equal(rowsWritten, rowsInDoc, "every row is written exactly once");

  // Read-time aliasing restores the binding without copying anything.
  const read = withAliases(written, profile);
  assert.equal(read.incidents, read.raw, "alias and canonical share one array");
});

test("truncation is announced, never silent", () => {
  // A document with more tables than the profiler will read must say which ones
  // it dropped. Otherwise a block bound to a missing table fails with "unknown
  // frame" and nothing connects that to the real cause.
  const wide: Record<string, unknown> = {};
  for (let i = 0; i < 30; i++) {
    wide[`t${i}`] = Array.from({ length: 30 - i }, (_, r) => ({ id: r, v: r }));
  }

  const p = profileDocument(wide, "wide.json", 0);
  assert.ok(p.tables.length <= 24);
  assert.ok(
    p.warnings.some((w) => /only the \d+ largest were profiled/.test(w)),
    "dropping tables must produce a warning",
  );
});
