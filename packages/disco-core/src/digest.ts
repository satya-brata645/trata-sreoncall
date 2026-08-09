import type { DatasetProfile, FieldProfile, TableProfile } from "./types";

/**
 * The profile, rendered for a model to read.
 *
 * This is the only view of the data any agent gets — the terminal composer and
 * the in-window editor both compose against it, and neither ever sees a row.
 * That is what makes "never write a number into a spec" enforceable rather than
 * aspirational: a model that has not seen a figure cannot copy one out.
 *
 * It lives in core rather than in `bin/` because the web route needs it too,
 * and `bin/shared.ts` resolves the repository root at import time — plumbing a
 * request handler has no business depending on.
 */

/** Digits, not grouping: this is a field summary for a model, not a figure for a reader. */
const n = (v: number | undefined, digits = 2) =>
  v === undefined || !Number.isFinite(v) ? "—" : Number(v.toFixed(digits)).toString();

export function fieldLine(f: FieldProfile): string {
  const bits: string[] = [`${f.name}`, `${f.semantic}/${f.role}`];

  if (f.numeric) {
    bits.push(`range ${n(f.numeric.min)}..${n(f.numeric.max)}`, `median ${n(f.numeric.median)}`);
    if (Math.abs(f.numeric.skew) > 2) bits.push(`skew ${n(f.numeric.skew, 1)}`);
    if (f.numeric.monotonic) bits.push("MONOTONIC (running total)");
    if (f.numeric.negatives > 0) bits.push(`${f.numeric.negatives} negative`);
  }

  if (f.temporal) {
    bits.push(
      `${f.temporal.min.slice(0, 10)}..${f.temporal.max.slice(0, 10)}`,
      `${Math.round(f.temporal.spanDays)}d @ ${f.temporal.granularity}`,
      f.temporal.regular ? "regular" : "IRREGULAR",
    );
  }

  if (f.categorical) {
    const top = f.categorical.topValues.slice(0, 4).map((t) => t.value).join(" | ");
    bits.push(`${f.distinct} distinct`, `top: ${top}`);
    if (f.categorical.looksOrdinal) bits.push(`ordinal: ${f.categorical.order?.join(" < ")}`);
  } else if (!f.numeric && !f.temporal) {
    bits.push(`${f.distinct} distinct`);
  }

  if (f.unit) bits.push(`unit ${f.unit}`);
  if (f.nullFraction > 0.02) bits.push(`${Math.round(f.nullFraction * 100)}% null`);
  if (f.note) bits.push(`(${f.note})`);

  return `    - ${bits.join("  ·  ")}`;
}

/**
 * A compact rendering of the profile for the composer to read.
 *
 * The agent must never see the rows themselves: they blow the context window,
 * and any figure it copied out of them would bypass the algebra. It gets the
 * shape of the data and nothing else.
 */
export function digest(profile: DatasetProfile): string {
  const out: string[] = [];
  out.push(`SOURCE  ${profile.source}  (${(profile.bytes / 1024).toFixed(0)} KB)`);

  for (const t of profile.tables) {
    out.push("");
    out.push(`TABLE "${t.id}"  path=${t.path}  rows=${t.rowCount}${t.scanned < t.rowCount ? ` (profiled ${t.scanned})` : ""}`);
    out.push(`  grain: ${t.grain.join(" + ") || "unknown"}`);
    out.push(`  time: ${t.timeFields.join(", ") || "none"}   measures: ${t.measures.length}   dimensions: ${t.dimensions.length}`);
    out.push("  fields:");
    for (const f of t.fields) out.push(fieldLine(f));
  }

  if (profile.warnings.length) {
    out.push("");
    out.push("WARNINGS");
    for (const w of profile.warnings) out.push(`  ! ${w}`);
  }

  return out.join("\n");
}

export function candidateDigest(table: TableProfile, candidates: Array<{ score: number; block: { id: string; kind: string; span: number }; rationale: string[]; derivations: Array<{ id: string; op: string }> }>): string {
  const out: string[] = [`RECOMMENDED BLOCKS for "${table.id}" (rules-based, best first)`];
  for (const c of candidates) {
    out.push("");
    out.push(`  [${c.score}] ${c.block.kind}  id=${c.block.id}  span=${c.block.span}`);
    for (const r of c.rationale) out.push(`        ${r}`);
    if (c.derivations.length) {
      out.push(`        needs: ${c.derivations.map((d) => `${d.id}(${d.op})`).join(" -> ")}`);
    }
  }
  return out.join("\n");
}
