import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { buildRunDocument } from "../../bin/seed-artifacts";
import { buildBaseTables, profileDocument, withAliases } from "../profile";
import { applyPatch, parsePatch } from "../patch";
import { digest } from "../digest";
import { parseSpec } from "../spec";

/**
 * What the in-window agent route actually does, minus the model.
 *
 * `app/api/disco/patch/route.ts` is a thin wrapper: bind the artifact, hand the
 * model a digest, parse what comes back, and let `applyPatch` be the gate. The
 * model call is the only part that cannot be tested here, so everything else is
 * — against the real pinned spec and a real run, not a fixture, because the two
 * ways this wiring breaks are a spec that does not bind to the artifact and a
 * window in which the answer does not fit.
 */

const ASOF = "2026-08-09T11:00:00.000Z";
const NOW = Date.parse(ASOF);

const document = buildRunDocument({ asOf: ASOF, windowDays: 30, seed: 424242 });
const profile = profileDocument(document, "artifacts/runs/test/dashboard.json", 0);
const base = withAliases(buildBaseTables(document, profile, { aliases: false }), profile);
const spec = parseSpec(
  JSON.parse(readFileSync(join(process.cwd(), "artifacts", "specs", "sre-oncall.json"), "utf8")),
);

const ctx = (rect: { w: number; h: number }) => ({ profile, base, rect, now: NOW });

const DESKTOP = { w: 1440, h: 900 };
/** The OS window floor. Anything that must survive a drag has to survive this. */
const FLOOR = { w: 468, h: 288 };

/* ------------------------------------------------------------------ *
 * The prompt
 * ------------------------------------------------------------------ */

test("the digest names every table a block could bind to, and no rows", () => {
  const d = digest(profile);
  for (const t of profile.tables) assert.match(d, new RegExp(`TABLE "${t.id}"`));

  // The claim that makes "never write a number into a spec" enforceable: a
  // model composing against this has not seen a single record.
  const anyRow = (base.incidents ?? [])[0];
  assert.ok(anyRow, "the artifact should have incidents to check against");
  assert.ok(!d.includes(JSON.stringify(anyRow)));
});

/* ------------------------------------------------------------------ *
 * The gate
 * ------------------------------------------------------------------ */

test("a plausible edit applies against the real artifact", () => {
  const parsed = parsePatch({
    $schema: "disco/patch/v1",
    intent: "show incidents by cause",
    ops: [
      { op: "addDerivation", derivation: { op: "groupBy", id: "by_cause", from: "cause_mix", by: ["cause"], agg: { count: "sum" } } },
      { op: "addBlock", block: { kind: "pie", id: "cause_share", span: 4, from: "by_cause", category: "cause", value: "count", title: "Cause mix" } },
    ],
  });
  assert.equal(parsed.ok, true, parsed.ok ? "" : parsed.fixes);
  if (!parsed.ok) return;

  const r = applyPatch(spec, parsed.patch, ctx(DESKTOP));
  assert.equal(r.ok, true, r.ok ? "" : `${r.reason}\n${r.fixes}`);
  if (!r.ok) return;
  assert.ok(r.spec.blocks.some((b) => b.id === "cause_share"));
});

test("an edit naming a table that does not exist is rejected with prose, not a stack trace", () => {
  const parsed = parsePatch({
    $schema: "disco/patch/v1",
    intent: "show revenue",
    ops: [{ op: "addBlock", block: { kind: "pie", id: "rev", span: 4, from: "revenue", category: "plan", value: "amount" } }],
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  const r = applyPatch(spec, parsed.patch, ctx(DESKTOP));
  assert.equal(r.ok, false);
  if (r.ok) return;
  // This string is pasted verbatim into the retry prompt, so it has to say what
  // to do rather than what went wrong.
  assert.ok(r.fixes.length > 0);
  assert.match(r.fixes, /fix:/);
});

test("the pinned spec is untouched by a rejected edit", () => {
  const frozen = JSON.stringify(spec);
  const parsed = parsePatch({
    $schema: "disco/patch/v1",
    intent: "break it",
    ops: [{ op: "removeBlock", id: "not_a_block" }],
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  const r = applyPatch(spec, parsed.patch, ctx(DESKTOP));
  assert.equal(r.ok, false);
  assert.equal(JSON.stringify(spec), frozen);
});

/* ------------------------------------------------------------------ *
 * The window
 * ------------------------------------------------------------------ */

test("the same edit lands differently in a different window", () => {
  // Why the rect is in the agent's prompt at all: the patch is identical, the
  // result is not. This radar happens to survive the floor intact — a
  // full-width row always clears its minimum — so the visible difference is
  // the column count and the width it is given. The case where an added block
  // cannot fit at all, and the patch is rejected rather than the block
  // silently hidden, is covered in patch.test.ts.
  const parsed = parsePatch({
    $schema: "disco/patch/v1",
    intent: "compare services",
    ops: [{
      op: "addBlock",
      block: {
        kind: "radar", id: "svc_shape", span: 6, from: "service_axes",
        entity: "service", axes: ["Availability", "Latency", "Errors"],
        series: ["checkout-api"], max: 100,
      },
    }],
  });
  assert.equal(parsed.ok, true, parsed.ok ? "" : parsed.fixes);
  if (!parsed.ok) return;

  const placed = (rect: { w: number; h: number }) => {
    const r = applyPatch(spec, parsed.patch, ctx(rect));
    assert.equal(r.ok, true, r.ok ? "" : `${r.reason}\n${r.fixes}`);
    if (!r.ok) throw new Error("unreachable");
    assert.ok(
      !r.layout.hidden.some((h) => h.blockId === "svc_shape"),
      "an added block must never be silently hidden — applyPatch rejects instead",
    );
    return { cols: r.layout.cols, block: r.layout.blocks.find((b) => b.blockId === "svc_shape")! };
  };

  const wide = placed(DESKTOP);
  const tight = placed(FLOOR);

  assert.ok(tight.cols < wide.cols, "the floor must unlock fewer columns");
  assert.ok(tight.block.w < wide.block.w, "and the block must be sized to the window it is in");
});
