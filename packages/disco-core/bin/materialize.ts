#!/usr/bin/env tsx
/**
 * disco materialize — turn a validated spec into what the renderer loads.
 *
 * Two modes, chosen by size (see LIMITS.CLIENT_MODE_MAX_ROWS):
 *
 *   client — ship the base rows. The browser runs the same algebra, so filters
 *            and drill-downs recompute live and can never disagree with the
 *            server's numbers, because it is the same code.
 *   server — ship only the computed frames. The rows never leave the machine,
 *            and the browser holds kilobytes instead of megabytes.
 *
 *   npm run materialize -- <slug>
 */
import { runPipeline } from "../src/algebra";
import { frameBindings } from "../src/bindings";
import { buildBaseTables, withAliases } from "../src/profile";
import { parseSpec } from "../src/spec";
import { validate, formatIssues } from "../src/validate";
import type { DatasetProfile } from "../src/types";
import { die, exists, read, readJson, writeJson } from "./shared";

const [slug] = process.argv.slice(2);
if (!slug) die("usage: npm run materialize -- <slug>");

const specPath = `outputs/${slug}/spec.json`;
const profilePath = `outputs/${slug}/profile.json`;
if (!exists(specPath)) die(`no spec at "${specPath}".`);
if (!exists(profilePath)) die(`no profile at "${profilePath}".`);

const profile = readJson<DatasetProfile>(profilePath);
const spec = parseSpec(readJson(specPath));

const doc = JSON.parse(read(profile.source));
// Aliases are a read-time convenience. Serializing them writes every aliased
// table twice — 1.5 MB became 3 MB the first time this shipped.
const base = buildBaseTables(doc, profile, { aliases: false });
const boundBase = withAliases(base, profile);

const result = validate(spec, boundBase, profile);
process.stdout.write(`${formatIssues(result.issues)}\n\n`);
if (!result.ok) die("spec failed validation; nothing was written.");

const frames = result.frames!;

if (spec.dataset.mode === "client") {
  // Frames are recomputed in the browser from these rows, so only the base ships.
  writeJson(`outputs/${slug}/data/base.json`, base);
  const rows = Object.values(base).reduce((a, r) => a + r.length, 0);
  process.stdout.write(`client mode: wrote ${rows.toLocaleString()} base rows\n`);
} else {
  // Only frames a block actually binds to; intermediates stay on this machine.
  // `frameBindings` is the single declaration of where blocks reach into data —
  // collecting `from` by hand here is what dropped every KPI sparkline frame.
  const bound = new Set(spec.blocks.flatMap(frameBindings));
  const payload: Record<string, unknown[]> = {};
  for (const id of bound) {
    const f = frames.get(id);
    if (f) payload[id] = f.rows;
  }
  writeJson(`outputs/${slug}/data/frames.json`, payload);
  const rows = Object.values(payload).reduce((a, r) => a + r.length, 0);
  process.stdout.write(`server mode: wrote ${Object.keys(payload).length} frames, ${rows.toLocaleString()} rows\n`);
}

/* The index the app reads to list dashboards. */
const manifestPath = "outputs/manifest.json";
type Entry = { slug: string; title: string; intent: string; blocks: number; rows: number; updated: string };
const manifest: Entry[] = exists(manifestPath) ? readJson<Entry[]>(manifestPath) : [];
const entry: Entry = {
  slug,
  title: spec.title,
  intent: spec.intent,
  blocks: spec.blocks.length,
  rows: spec.dataset.rowCount,
  updated: new Date().toISOString(),
};
writeJson(manifestPath, [entry, ...manifest.filter((m) => m.slug !== slug)]);

process.stdout.write(`\nWROTE outputs/${slug}/data/  and  ${manifestPath}\n\nOpen:  npm run dev  ->  http://localhost:3000/d/${slug}\n\n`);
