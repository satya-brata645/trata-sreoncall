import { test } from "node:test";
import assert from "node:assert/strict";

import { discoRender } from "../substrate";
import type { Block } from "../spec";
import type { Patch } from "../patch";

/**
 * The substrate API.
 *
 * What another app gets when it hands Disco data and a question. These tests
 * are written from that caller's point of view — they never reach inside for a
 * frame or a derivation, because a caller cannot either.
 */

const AS_OF = Date.parse("2026-08-09T00:00:00Z");
const DAY = 86_400_000;

const incidents = Array.from({ length: 120 }, (_, i) => ({
  id: `INC-${i}`,
  started_at: new Date(AS_OF - (120 - i) * DAY).toISOString(),
  service: `svc_${i % 5}`,
  severity: ["SEV1", "SEV2", "SEV3"][i % 3],
  minutes: 10 + (i % 40),
}));

const data = { incidents };
const rect = { w: 1440, h: 900 };

test("an app can hand over data and a question and get a dashboard", () => {
  const d = discoRender({ data, question: "How are incidents trending?", rect, now: AS_OF });

  assert.ok(d.spec.blocks.length > 0, "a dashboard with no blocks is not a dashboard");
  assert.ok(d.layout.blocks.length > 0, "and it must have been placed");
  assert.equal(d.resolved.unresolved.filter((i) => i.level === "error").length, 0);
  assert.equal(d.spec.title, "How are incidents trending?");
});

test("tables are discovered by name, so the caller does not describe its data", () => {
  const d = discoRender({ data, question: "q", rect, now: AS_OF });
  assert.ok(d.profile.tables.some((t) => t.id === "raw" || t.alias === "incidents"));
});

test("reflow re-solves layout without touching the spec", () => {
  // The resize path. If this rebuilt the spec, a drag would re-run the
  // recommender sixty times a second and could change which charts exist
  // mid-gesture.
  const wide = discoRender({ data, question: "q", rect, now: AS_OF });
  const narrow = wide.reflow({ w: 500, h: 700 });

  assert.deepEqual(narrow.spec, wide.spec, "reflow must not change the spec");
  assert.notDeepEqual(narrow.layout.blocks, wide.layout.blocks, "but it must change the layout");
  assert.ok(narrow.layout.cols < wide.layout.cols);
});

test("rebinding to a newer document keeps the spec", () => {
  // The run-push path, and the reason a pinned spec exists at all: a caller
  // that edited its dashboard must not lose those edits every time the
  // producer drops a new document.
  const first = discoRender({ data, question: "q", rect, now: AS_OF });

  const patched = first.patch({
    $schema: "disco/patch/v1",
    intent: "rename",
    ops: [{ op: "retitle", target: "$", title: "Renamed by the caller" }],
  });
  assert.equal(patched.ok, true, patched.ok ? "" : patched.reason);

  const edited = discoRender({ data, question: "q", spec: patched.ok ? patched.spec : undefined, rect, now: AS_OF });
  const grown = { incidents: [...incidents, ...incidents.map((x, i) => ({ ...x, id: `NEW-${i}` }))] };
  const next = edited.rebind(grown, AS_OF + DAY);

  assert.equal(next.spec.title, "Renamed by the caller", "the edit must survive the new run");
});

test("a rejected patch changes nothing the caller can observe", () => {
  const d = discoRender({ data, question: "q", rect, now: AS_OF });
  const before = JSON.stringify(d.spec);

  const bad: Patch = {
    $schema: "disco/patch/v1",
    intent: "break it",
    ops: [{ op: "removeBlock", id: "does_not_exist" }],
  };

  const r = d.patch(bad);
  assert.equal(r.ok, false);
  assert.equal(JSON.stringify(d.spec), before);
  assert.equal(d.undo(), null, "a rejected patch must not enter the undo history");
});

test("undo returns the dashboard to its previous spec", () => {
  const d = discoRender({ data, question: "q", rect, now: AS_OF });
  const original = JSON.stringify(d.spec);

  const text: Block = { kind: "text", id: "note", span: 12, body: "hello", tone: "neutral" } as Block;
  const r = d.patch({ $schema: "disco/patch/v1", intent: "add a note", ops: [{ op: "addBlock", block: text }] });
  assert.equal(r.ok, true, r.ok ? "" : r.reason);

  const undone = d.undo();
  assert.ok(undone, "there should be something to undo");
  assert.equal(JSON.stringify(undone!.spec), original);
});

test("a caller-supplied spec is used as given", () => {
  const authored = {
    $schema: "disco/v1",
    id: "custom",
    title: "Caller's own",
    intent: "supplied",
    dataset: { source: "inline", mode: "client", rowCount: incidents.length },
    controls: [],
    derivations: [{ op: "groupBy", id: "by_service", from: "raw", by: ["service"], agg: { minutes: "sum" } }],
    blocks: [{ kind: "bar", id: "b", span: 12, from: "by_service", x: "service", y: ["minutes"] }],
    notes: [],
  };

  const d = discoRender({ data, spec: authored, rect, now: AS_OF });
  assert.equal(d.spec.title, "Caller's own");
  assert.equal(d.spec.blocks.length, 1);
});

test("discoRender is deterministic", () => {
  // A substrate that returns a different dashboard for the same inputs cannot
  // be server-rendered, cached, or reasoned about by the app calling it.
  const a = discoRender({ data, question: "q", rect, now: AS_OF });
  const b = discoRender({ data, question: "q", rect, now: AS_OF });
  assert.deepEqual(a.spec, b.spec);
  assert.deepEqual(a.layout, b.layout);
});
