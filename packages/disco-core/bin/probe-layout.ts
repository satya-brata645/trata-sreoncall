#!/usr/bin/env tsx
/**
 * disco probe-layout — print how a spec lays out at several window sizes.
 *
 * A layout can satisfy every invariant and still look wrong, so this exists to
 * be read by a human. Not part of the pipeline.
 *
 *   npx tsx packages/core/bin/probe-layout.ts <slug>
 */
import { solveLayout } from "../src/layout";
import type { DashboardSpec } from "../src/spec";
import { die, exists, readJson } from "./shared";

const slug = process.argv[2] ?? "orders";
const path = `outputs/${slug}/spec.json`;
if (!exists(path)) die(`no spec at ${path}`);

const spec = readJson<DashboardSpec>(path);

const SIZES = [
  ["OS floor", { w: 468, h: 288 }],
  ["narrow embed", { w: 300, h: 700 }],
  ["half screen", { w: 760, h: 600 }],
  ["desktop", { w: 1440, h: 900 }],
] as const;

for (const [label, rect] of SIZES) {
  const l = solveLayout(spec.blocks, rect, {});
  process.stdout.write(`\n=== ${label}  ${rect.w}x${rect.h}  ->  ${l.cols} cols · ${l.contentHeight}px tall ===\n`);

  const rows = new Map<number, typeof l.blocks>();
  for (const b of l.blocks) rows.set(b.y, [...(rows.get(b.y) ?? []), b]);

  for (const [y, rb] of [...rows].sort((a, b) => a[0] - b[0])) {
    const cells = rb
      .map((b) => `${b.blockId}:${b.variant}(${Math.round(b.w)}x${Math.round(b.h)})${b.degradedFrom ? " ↓" : ""}`)
      .join("  ");
    process.stdout.write(`  y=${String(y).padStart(4)}  ${cells}\n`);
  }
  if (l.hidden.length) process.stdout.write(`  hidden: ${l.hidden.map((h) => `${h.blockId} (${h.reason})`).join("; ")}\n`);
  for (const n of l.notes) process.stdout.write(`  note: ${n}\n`);
}
process.stdout.write("\n");
