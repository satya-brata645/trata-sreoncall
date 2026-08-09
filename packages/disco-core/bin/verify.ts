#!/usr/bin/env tsx
/**
 * disco verify — the gate.
 *
 * The composer skill runs this after writing a spec and before anything is
 * materialized. Exit code 1 means the spec does not ship; the printed issues
 * are written to be pasted straight back into the composer as a retry prompt.
 *
 *   npm run verify -- <slug>
 */
import { buildBaseTables } from "../src/profile";
import { validate, formatIssues } from "../src/validate";
import type { DatasetProfile } from "../src/types";
import { die, exists, read, readJson } from "./shared";

const [slug] = process.argv.slice(2);
if (!slug) die("usage: npm run verify -- <slug>");

const specPath = `outputs/${slug}/spec.json`;
const profilePath = `outputs/${slug}/profile.json`;
if (!exists(specPath)) die(`no spec at "${specPath}". Write one first.`);
if (!exists(profilePath)) die(`no profile at "${profilePath}". Run: npm run profile`);

const profile = readJson<DatasetProfile>(profilePath);
const doc = JSON.parse(read(profile.source));
const base = buildBaseTables(doc, profile);

const result = validate(readJson(specPath), base, profile);

process.stdout.write(`\n${formatIssues(result.issues)}\n\n`);

if (!result.ok) {
  const errors = result.issues.filter((i) => i.level === "error").length;
  process.stdout.write(`FAILED — ${errors} error${errors === 1 ? "" : "s"}. Fix the spec and re-run.\n\n`);
  process.exit(1);
}

const blocks = result.frames ? [...result.frames.keys()].length : 0;
process.stdout.write(`PASSED — ${blocks} frames resolved.\n\nNext: npm run materialize -- ${slug}\n\n`);
