import type {
  CategoricalProfile,
  DatasetProfile,
  FieldProfile,
  FieldRole,
  JsonType,
  NumericProfile,
  SemanticType,
  StringProfile,
  TableProfile,
  TemporalGranularity,
  TemporalProfile,
} from "./types";

/** Rows scanned before the profiler starts sampling. Statistics stay honest well below this. */
const SCAN_LIMIT = 50_000;
const EXAMPLE_COUNT = 3;
const TOP_VALUES = 12;

/* ------------------------------------------------------------------ *
 * Table discovery
 * ------------------------------------------------------------------ */

type Row = Record<string, unknown>;

const isPlainObject = (v: unknown): v is Row =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isRowArray = (v: unknown): v is Row[] =>
  Array.isArray(v) && v.length > 0 && v.some(isPlainObject);

/**
 * Find every array-of-objects in the document. Real-world exports bury the
 * interesting rows one or two keys down ({"data": {"results": [...]}}), and a
 * dashboard is useless if we only look at the root.
 */
export function findTables(doc: unknown): Array<{ path: string; rows: Row[] }> {
  const found: Array<{ path: string; rows: Row[] }> = [];

  const walk = (node: unknown, path: string, depth: number) => {
    if (depth > 4) return;
    if (isRowArray(node)) {
      found.push({ path, rows: node.filter(isPlainObject) });
      // Descend into the first element to catch nested detail arrays (line items).
      const sample = node.find(isPlainObject);
      if (sample) {
        for (const [k, v] of Object.entries(sample)) {
          if (isRowArray(v)) walk(v, `${path}[].${k}`, depth + 1);
        }
      }
      return;
    }
    if (isPlainObject(node)) {
      for (const [k, v] of Object.entries(node)) {
        walk(v, path === "$" ? `$.${k}` : `${path}.${k}`, depth + 1);
      }
    }
  };

  walk(doc, "$", 0);
  // Biggest table first: that is almost always the one the user cares about.
  return found.sort((a, b) => b.rows.length - a.rows.length);
}

/**
 * Collapse nested objects into dot paths so every leaf is chartable.
 * Arrays of scalars become a count, arrays of objects are left to findTables.
 */
export function flattenRow(row: Row, prefix = "", depth = 0): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (isPlainObject(v) && depth < 3) {
      Object.assign(out, flattenRow(v, key, depth + 1));
    } else if (Array.isArray(v)) {
      if (isRowArray(v)) out[`${key}.count`] = v.length;
      else out[key] = v.length === 0 ? null : v.map(String).join(", ");
    } else {
      out[key] = v;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Type inference
 * ------------------------------------------------------------------ */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const SLASH_DATE = /^\d{1,2}\/\d{1,2}\/\d{4}$/;
const URL_RE = /^https?:\/\/\S+$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TIME_NAME = /(^|[._])(ts|time|date|datetime|timestamp|created|updated|modified|occurred|at|day|month|week|year|period)($|[._])/i;
const ID_NAME = /(^|[._])(id|uuid|guid|key|sku|hash|slug|arn|ref)($|[._])/i;
const GEO_NAME = /(^|[._])(lat|latitude|lon|lng|longitude|country|region|state|city|geo|postcode|zip)($|[._])/i;

const ORDINAL_LADDERS: string[][] = [
  ["low", "medium", "high"],
  ["low", "medium", "high", "critical"],
  ["xs", "s", "m", "l", "xl"],
  ["small", "medium", "large"],
  ["free", "starter", "pro", "enterprise"],
  ["never", "rarely", "sometimes", "often", "always"],
  ["strongly disagree", "disagree", "neutral", "agree", "strongly agree"],
];

const UNIT_HINTS: Array<[RegExp, string]> = [
  [/(revenue|mrr|arr|arpu|price|cost|amount|spend|sales|ltv|cac|usd|dollars?|\$)/i, "usd"],
  [/(pct|percent|rate|ratio|share|margin|churn|conversion|ctr|utilization)/i, "percent"],
  [/(bytes|size_b|payload|storage)/i, "bytes"],
  [/(_ms|latency|duration|elapsed|response_time)/i, "ms"],
  [/(count|total|qty|quantity|num_|_num|sessions|visits|clicks|orders|users|events)/i, "count"],
];

function jsonTypeOf(v: unknown): JsonType {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v as JsonType;
}

/** Parse the value forms that actually show up in exported JSON. */
function parseTemporal(v: unknown, name: string): number | null {
  if (typeof v === "number") {
    // Only trust a bare number as a date when the field name says so — otherwise
    // every large integer becomes a timestamp.
    if (!TIME_NAME.test(name)) return null;
    if (v > 1e11 && v < 4e12) return v; // epoch millis, ~1973-2096
    if (v > 1e8 && v < 4e9) return v * 1000; // epoch seconds
    return null;
  }
  if (typeof v !== "string") return null;
  if (!ISO_DATE.test(v) && !SLASH_DATE.test(v)) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

function inferSemantic(name: string, values: unknown[], distinct: number): SemanticType {
  const nonNull = values.filter((v) => v !== null && v !== undefined && v !== "");
  if (nonNull.length === 0) return "unknown";

  const temporalHits = nonNull.filter((v) => parseTemporal(v, name) !== null).length;
  if (temporalHits / nonNull.length > 0.9) return "temporal";

  if (nonNull.every((v) => typeof v === "boolean")) return "boolean";

  const numeric = nonNull.filter((v) => typeof v === "number" && Number.isFinite(v));
  if (numeric.length / nonNull.length > 0.9) {
    // A numeric column that is really a label: few distinct values and an id-ish name.
    if (ID_NAME.test(name) && distinct / nonNull.length > 0.9) return "identifier";
    return "quantitative";
  }

  const strings = nonNull.filter((v) => typeof v === "string") as string[];
  if (strings.length / nonNull.length > 0.9) {
    if (strings.every((s) => URL_RE.test(s))) return "url";
    if (strings.every((s) => UUID_RE.test(s))) return "identifier";
    if (ID_NAME.test(name) && distinct / strings.length > 0.95) return "identifier";
    if (GEO_NAME.test(name)) return "geo";

    const uniqueness = distinct / strings.length;
    const avgLen = strings.reduce((a, s) => a + s.length, 0) / strings.length;
    // Long and almost all different: prose, not a category. Charting it is noise.
    if (uniqueness > 0.9 && avgLen > 40) return "text";
    if (matchLadder(strings)) return "ordinal";
    return "nominal";
  }

  return "unknown";
}

function matchLadder(values: string[]): string[] | null {
  const set = new Set(values.map((s) => s.toLowerCase().trim()));
  if (set.size < 2 || set.size > 8) return null;
  for (const ladder of ORDINAL_LADDERS) {
    if ([...set].every((v) => ladder.includes(v))) {
      return ladder.filter((l) => set.has(l));
    }
  }
  return null;
}

function guessUnit(name: string, semantic: SemanticType): string | undefined {
  if (semantic !== "quantitative") return undefined;
  for (const [re, unit] of UNIT_HINTS) if (re.test(name)) return unit;
  return undefined;
}

/* ------------------------------------------------------------------ *
 * Statistics
 * ------------------------------------------------------------------ */

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function numericProfile(values: number[], ordered: number[]): NumericProfile {
  const sorted = [...values].sort((a, b) => a - b);
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n || 1);
  const stddev = Math.sqrt(variance);
  const skew =
    stddev === 0 ? 0 : values.reduce((a, b) => a + ((b - mean) / stddev) ** 3, 0) / (n || 1);

  let monotonic = ordered.length > 2;
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i] < ordered[i - 1]) {
      monotonic = false;
      break;
    }
  }

  return {
    min: sorted[0],
    max: sorted[n - 1],
    mean,
    median: quantile(sorted, 0.5),
    p05: quantile(sorted, 0.05),
    p95: quantile(sorted, 0.95),
    stddev,
    skew,
    zeros: values.filter((v) => v === 0).length,
    negatives: values.filter((v) => v < 0).length,
    integral: values.every((v) => Number.isInteger(v)),
    monotonic,
  };
}

const DAY = 86_400_000;

function temporalProfile(stamps: number[]): TemporalProfile {
  const sorted = [...new Set(stamps)].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const spanDays = (max - min) / DAY;

  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i] - sorted[i - 1]);
  const medianGap = gaps.length ? quantile([...gaps].sort((a, b) => a - b), 0.5) : 0;

  // "Regular" means the spacing barely varies — only then is a continuous line honest.
  const regular =
    gaps.length > 2 && gaps.every((g) => Math.abs(g - medianGap) <= Math.max(medianGap * 0.25, 1000));

  let granularity: TemporalGranularity = "day";
  if (medianGap < 60_000) granularity = "second";
  else if (medianGap < 3_600_000) granularity = "minute";
  else if (medianGap < DAY) granularity = "hour";
  else if (medianGap < 7 * DAY) granularity = "day";
  else if (medianGap < 28 * DAY) granularity = "week";
  else if (medianGap < 89 * DAY) granularity = "month";
  else if (medianGap < 360 * DAY) granularity = "quarter";
  else granularity = "year";

  return {
    min: new Date(min).toISOString(),
    max: new Date(max).toISOString(),
    granularity,
    regular,
    spanDays,
    distinctStamps: sorted.length,
  };
}

function categoricalProfile(values: string[], distinct: number): CategoricalProfile {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);

  const total = values.length;
  let entropy = 0;
  for (const c of counts.values()) {
    const p = c / total;
    entropy -= p * Math.log2(p);
  }

  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_VALUES)
    .map(([value, count]) => ({ value, count }));

  const ladder = matchLadder(values);

  return {
    topValues: top,
    entropy,
    isBinary: distinct === 2,
    looksOrdinal: ladder !== null,
    order: ladder ?? undefined,
  };
}

function stringProfile(values: string[]): StringProfile {
  const lens = values.map((s) => s.length);
  return {
    minLength: Math.min(...lens),
    maxLength: Math.max(...lens),
    avgLength: lens.reduce((a, b) => a + b, 0) / lens.length,
  };
}

/* ------------------------------------------------------------------ *
 * Role assignment
 * ------------------------------------------------------------------ */

function assignRole(f: Omit<FieldProfile, "role" | "note">): { role: FieldRole; note?: string } {
  if (f.nullFraction > 0.95) return { role: "ignore", note: "over 95% null" };
  if (f.distinct <= 1) return { role: "ignore", note: "single value across all rows" };

  switch (f.semantic) {
    case "temporal":
      return { role: "time" };
    case "identifier":
      return { role: "id", note: "high-uniqueness key; usable as a table column, not an axis" };
    case "text":
      return { role: "ignore", note: "free text; too unique to group by" };
    case "url":
      return { role: "id", note: "link column" };
    case "quantitative": {
      if (f.numeric?.monotonic) {
        return { role: "measure", note: "monotonic — looks like a running total, prefer last() over sum()" };
      }
      if (f.distinct <= 2) return { role: "dimension", note: "numeric but only two values; treated as a flag" };
      return { role: "measure" };
    }
    case "boolean":
      return { role: "dimension" };
    case "ordinal":
      return { role: "dimension", note: "ordered category; preserve the ladder order on axes" };
    case "geo":
      return { role: "dimension" };
    case "nominal": {
      if (f.uniqueness > 0.9) {
        return { role: "id", note: "nearly unique per row; a key rather than a category" };
      }
      return { role: "dimension" };
    }
    default:
      return { role: "ignore", note: "type could not be inferred" };
  }
}

/* ------------------------------------------------------------------ *
 * Public entry points
 * ------------------------------------------------------------------ */

export function profileField(name: string, rawValues: unknown[]): FieldProfile {
  const count = rawValues.length;
  const present = rawValues.filter((v) => v !== null && v !== undefined && v !== "");
  const nullCount = count - present.length;

  const jsonTypes = [...new Set(present.map(jsonTypeOf))];
  const distinctSet = new Set(present.map((v) => JSON.stringify(v)));
  const distinct = distinctSet.size;

  const semantic = inferSemantic(name, present, distinct);

  const base: Omit<FieldProfile, "role" | "note"> = {
    name,
    jsonTypes,
    semantic,
    count,
    nullCount,
    nullFraction: count === 0 ? 1 : nullCount / count,
    distinct,
    uniqueness: present.length === 0 ? 0 : distinct / present.length,
    examples: [...distinctSet].slice(0, EXAMPLE_COUNT).map((s) => JSON.parse(s)),
    unit: guessUnit(name, semantic),
  };

  // The sub-profiles must exist before the role is assigned: assignRole reads
  // numeric.monotonic to keep running totals away from sum().
  if (semantic === "quantitative" && present.length > 0) {
    const nums = present.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (nums.length > 0) base.numeric = numericProfile(nums, nums);
  }

  if (semantic === "temporal" && present.length > 0) {
    const stamps = present
      .map((v) => parseTemporal(v, name))
      .filter((t): t is number => t !== null);
    if (stamps.length > 1) base.temporal = temporalProfile(stamps);
  }

  if ((semantic === "nominal" || semantic === "ordinal" || semantic === "boolean" || semantic === "geo") && present.length > 0) {
    const strs = present.map(String);
    base.categorical = categoricalProfile(strs, distinct);
    base.string = stringProfile(strs);
  }

  return { ...base, ...assignRole(base) };
}

/** Smallest set of dimension/id fields whose combination is unique per row. */
function detectGrain(fields: FieldProfile[], rowCount: number): string[] {
  const single = fields.find((f) => f.uniqueness >= 0.999 && f.distinct === rowCount);
  if (single) return [single.name];

  const candidates = fields
    .filter((f) => f.role === "time" || f.role === "dimension" || f.role === "id")
    .sort((a, b) => b.uniqueness - a.uniqueness)
    .slice(0, 4);

  // Uniqueness is multiplicative at worst; this is a hint for the agent, not a constraint.
  const grain: string[] = [];
  let product = 1;
  for (const c of candidates) {
    grain.push(c.name);
    product *= c.distinct;
    if (product >= rowCount) break;
  }
  return grain;
}

export function profileTable(id: string, path: string, rows: Record<string, unknown>[]): TableProfile {
  const scanRows = rows.length > SCAN_LIMIT ? rows.slice(0, SCAN_LIMIT) : rows;
  const flat = scanRows.map((r) => flattenRow(r));

  const keys = new Set<string>();
  for (const r of flat) for (const k of Object.keys(r)) keys.add(k);

  const fields = [...keys].map((k) => profileField(k, flat.map((r) => r[k] ?? null)));

  return {
    id,
    path,
    rowCount: rows.length,
    scanned: scanRows.length,
    fields,
    grain: detectGrain(fields, scanRows.length),
    timeFields: fields.filter((f) => f.role === "time").map((f) => f.name),
    measures: fields.filter((f) => f.role === "measure").map((f) => f.name),
    dimensions: fields.filter((f) => f.role === "dimension").map((f) => f.name),
  };
}

/**
 * A stable, readable id for a discovered table.
 *
 * Tables used to be numbered by array position — `raw`, `t1`, `t2`. That is
 * unusable once a document carries several tables: a block binds to `t3`, and
 * adding a key earlier in the JSON silently rebinds every block in the spec to
 * different data. Naming from the path makes the binding mean something and
 * makes it survive the producer reordering its output.
 *
 *   $.incidents          -> incidents
 *   $.data.orders        -> orders
 *   $.orders[].items     -> orders_items
 */
export function tableIdFromPath(path: string, taken: Set<string>): string {
  const base =
    path
      .replace(/^\$\.?/, "")
      .replace(/\[\]/g, "_")
      .replace(/[^A-Za-z0-9_]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase() || "table";

  // A leading digit would be a legal object key but an awkward identifier.
  const safe = /^[a-z]/.test(base) ? base : `t_${base}`;

  if (!taken.has(safe)) return safe;
  for (let i = 2; ; i++) {
    const candidate = `${safe}_${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * How many tables one document may contribute.
 *
 * Raised from 12 to 24 because the SRE artifact sits at exactly 12 and a
 * thirteenth would have been dropped without a word — a block binding to it
 * would fail with "unknown frame" and nothing would point at the real cause.
 * Truncation is still possible at 24, but it now says so (see below), which is
 * the difference between a limit and a trap.
 */
const MAX_TABLES = 24;

export function profileDocument(doc: unknown, source: string, bytes: number): DatasetProfile {
  const tables = findTables(doc);
  const warnings: string[] = [];

  if (tables.length === 0) {
    warnings.push(
      "No array of objects found anywhere in the input. Disco needs at least one list of records to profile.",
    );
  }

  const taken = new Set<string>();
  const profiled = tables.slice(0, MAX_TABLES).map((t, i) => {
    // The largest table keeps the id "raw" so every spec written before tables
    // had names still resolves. `findTables` sorts by row count, so that is
    // index 0.
    const id = i === 0 ? "raw" : tableIdFromPath(t.path, taken);
    taken.add(id);
    return profileTable(id, t.path, t.rows);
  });

  // The primary table is reachable under its own name too, so a spec can say
  // `from: "incidents"` even when incidents happens to be the biggest table.
  if (profiled.length > 0 && tables[0]) {
    const alias = tableIdFromPath(tables[0].path, taken);
    if (alias !== "raw") profiled[0].alias = alias;
  }

  if (tables.length > MAX_TABLES) {
    // Silent truncation is the failure this project rejects everywhere else:
    // the dashboard would render, the missing table would simply not exist,
    // and the error would surface as a binding failure three layers away.
    warnings.push(
      `Document has ${tables.length} tables; only the ${MAX_TABLES} largest were profiled. ` +
        `Dropped: ${tables.slice(MAX_TABLES).map((t) => t.path).join(", ")}.`,
    );
  }

  for (const t of profiled) {
    if (t.scanned < t.rowCount) {
      warnings.push(`Table "${t.id}" has ${t.rowCount} rows; statistics were computed from the first ${t.scanned}.`);
    }
    if (t.measures.length === 0) {
      warnings.push(`Table "${t.id}" has no numeric measure. Charts will be limited to counts.`);
    }
    if (t.timeFields.length === 0) {
      warnings.push(`Table "${t.id}" has no time field. No trend blocks are available for it.`);
    }
  }

  return {
    $schema: "disco/profile/v1",
    source,
    bytes,
    generatedBy: "disco-profiler@1",
    tables: profiled,
    warnings,
  };
}

/**
 * Rebuild the base tables a profile describes, keyed by the ids blocks bind to.
 *
 * This was duplicated in three CLI entry points, each re-deriving the mapping
 * from profile order to discovered order. That is the same shape of duplication
 * that once let the materializer forget a binding site — one copy drifts and
 * the failure is a blank card, not an error. One function, one mapping.
 *
 * Matching is by `path` rather than by index, so a document whose tables changed
 * size between runs (and therefore changed order) still binds correctly.
 */
export function buildBaseTables(
  doc: unknown,
  profile: DatasetProfile,
  options: { aliases?: boolean } = {},
): Record<string, Record<string, unknown>[]> {
  const discovered = findTables(doc);
  const base: Record<string, Record<string, unknown>[]> = {};

  profile.tables.forEach((t, i) => {
    const match = discovered.find((x) => x.path === t.path) ?? discovered[i];
    if (!match) return;
    base[t.id] = match.rows.map((r) => flattenRow(r));
  });

  return options.aliases === false ? base : withAliases(base, profile);
}

/**
 * Add alias keys pointing at the same row arrays.
 *
 * Separate from `buildBaseTables` because aliases must never be *serialized*:
 * they share a reference in memory, but `JSON.stringify` expands each one into
 * a full second copy, which silently doubled a 1.5 MB payload the first time
 * this shipped. Writers pass `{ aliases: false }`; readers re-apply them.
 */
export function withAliases<T>(
  base: Record<string, T>,
  profile: DatasetProfile,
): Record<string, T> {
  const out = { ...base };
  for (const t of profile.tables) {
    if (t.alias && out[t.id] !== undefined && out[t.alias] === undefined) {
      out[t.alias] = out[t.id];
    }
  }
  return out;
}
