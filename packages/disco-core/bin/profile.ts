#!/usr/bin/env tsx
/**
 * disco profile — stage 1 of the pipeline.
 *
 * Reads the input JSON, computes a deterministic statistical profile, writes it
 * to outputs/<slug>/profile.json, and prints a compact digest plus the
 * rules-based block recommendations.
 *
 *   npm run profile -- [inputPath] [--slug my_dashboard]
 *
 * Everything downstream reads the profile. Nothing downstream reads the rows.
 */
import { profileDocument } from "../src/profile";
import { recommend, chooseMode } from "../src/recommend";
import { bytes, candidateDigest, die, digest, exists, read, slugify, writeJson } from "./shared";

const args = process.argv.slice(2);
const flagIndex = args.findIndex((a) => a === "--slug");
const slugArg = flagIndex >= 0 ? args[flagIndex + 1] : undefined;
const inputPath = args.find((a) => !a.startsWith("--") && a !== slugArg) ?? "input/input.json";

if (!exists(inputPath)) {
  die(`no input at "${inputPath}". Drop your JSON there, or pass a path: npm run profile -- path/to/data.json`);
}

let doc: unknown;
try {
  doc = JSON.parse(read(inputPath));
} catch (e) {
  die(`"${inputPath}" is not valid JSON: ${(e as Error).message}`);
}

const profile = profileDocument(doc, inputPath, bytes(inputPath));

if (profile.tables.length === 0) {
  die(
    `no array of records found in "${inputPath}".\n` +
      `  Disco profiles lists of objects — [{...}, {...}] at the root, or nested under a key.`,
  );
}

const slug = slugArg ? slugify(slugArg) : slugify(inputPath.split("/").pop()?.replace(/\.json$/, "") ?? "dashboard");
const out = `outputs/${slug}/profile.json`;
writeJson(out, profile);

const primary = profile.tables[0];
const candidates = recommend(primary);

process.stdout.write(
  [
    digest(profile),
    "",
    candidateDigest(primary, candidates),
    "",
    `MODE  ${chooseMode(primary.rowCount)}  (${primary.rowCount} rows)`,
    `WROTE ${out}`,
    "",
    `Next: compose a spec at outputs/${slug}/spec.json, then run:  npm run verify -- ${slug}`,
    "",
  ].join("\n"),
);
