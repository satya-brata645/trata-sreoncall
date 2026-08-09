/**
 * Disco core types.
 *
 * Two planes, kept deliberately apart:
 *   - the DATA plane (this file + profile.ts + algebra.ts) is deterministic.
 *     Nothing here consults a model. Every number a dashboard shows is produced
 *     by code in this plane, so the agent can never invent a value.
 *   - the VIEW plane (spec.ts) is what the agent writes. It binds to the data
 *     plane by id and never carries values of its own.
 */

/** What a field *means*, which is not the same as what JSON says it is. */
export type SemanticType =
  | "temporal"
  | "quantitative"
  | "nominal"
  | "ordinal"
  | "boolean"
  | "identifier"
  | "geo"
  | "url"
  | "text"
  | "unknown";

/** How a field is usable in a chart. Drives the recommender's candidate search. */
export type FieldRole = "time" | "measure" | "dimension" | "id" | "ignore";

export type JsonType = "number" | "string" | "boolean" | "null" | "object" | "array";

export interface NumericProfile {
  min: number;
  max: number;
  mean: number;
  median: number;
  p05: number;
  p95: number;
  stddev: number;
  /** Fisher-Pearson skew. |skew| > 2 is a hint toward a log scale. */
  skew: number;
  zeros: number;
  negatives: number;
  /** All observed values are whole numbers — counts rather than measurements. */
  integral: boolean;
  /** Non-decreasing across row order: a running total, not a rate. */
  monotonic: boolean;
}

export type TemporalGranularity = "second" | "minute" | "hour" | "day" | "week" | "month" | "quarter" | "year";

export interface TemporalProfile {
  min: string;
  max: string;
  /** Smallest unit at which values actually differ. */
  granularity: TemporalGranularity;
  /** Evenly spaced observations — safe to draw as a continuous line. */
  regular: boolean;
  spanDays: number;
  /** Distinct timestamps. Fewer than rowCount means the grain is coarser than a row. */
  distinctStamps: number;
}

export interface CategoricalProfile {
  topValues: Array<{ value: string; count: number }>;
  /** Shannon entropy in bits. Low entropy + high cardinality = a long tail worth truncating. */
  entropy: number;
  isBinary: boolean;
  /** Values look like an ordered ladder (low/medium/high, S/M/L, ratings). */
  looksOrdinal: boolean;
  /** Preserved order when looksOrdinal. */
  order?: string[];
}

export interface StringProfile {
  minLength: number;
  maxLength: number;
  avgLength: number;
}

export interface FieldProfile {
  /** Dot path into the flattened record, e.g. "customer.plan". */
  name: string;
  jsonTypes: JsonType[];
  semantic: SemanticType;
  role: FieldRole;
  count: number;
  nullCount: number;
  nullFraction: number;
  distinct: number;
  /** distinct / count. Near 1.0 on a string field means it is a key, not a category. */
  uniqueness: number;
  examples: unknown[];
  /** Guessed from the field name: "usd" | "percent" | "bytes" | "ms" | "count" | undefined. */
  unit?: string;
  numeric?: NumericProfile;
  temporal?: TemporalProfile;
  categorical?: CategoricalProfile;
  string?: StringProfile;
  /** Why the profiler assigned this role. Surfaced to the agent and to humans. */
  note?: string;
}

export interface TableProfile {
  /** Stable id used by derivations as their `from`. The largest table is "raw". */
  id: string;
  /**
   * The path-derived name for the largest table, which also answers to "raw".
   * Lets a spec bind to `incidents` whether or not incidents happens to be the
   * biggest table in the document, so a spec does not break when row counts
   * shift between runs and a different table becomes the largest.
   */
  alias?: string;
  /** Where the rows were found, e.g. "$" or "$.orders[].items[]". */
  path: string;
  rowCount: number;
  /** Rows actually scanned. Equals rowCount unless the input was sampled. */
  scanned: number;
  fields: FieldProfile[];
  /** Fields that together look unique — the natural grain of a row. */
  grain: string[];
  timeFields: string[];
  measures: string[];
  dimensions: string[];
}

export interface DatasetProfile {
  $schema: "disco/profile/v1";
  source: string;
  /** Bytes of the source file. */
  bytes: number;
  generatedBy: "disco-profiler@1";
  tables: TableProfile[];
  /** Anything the agent should know but could not have inferred from the numbers. */
  warnings: string[];
}
