import { DashboardSpecSchema, type Block, type DashboardSpec } from "./spec";
import { runPipeline, type Frame, type Row } from "./algebra";
import { RULES, type Phase, type Rule, type RuleContext, type RuleId, type Violation } from "./rules";
import type { DatasetProfile } from "./types";

/**
 * The gate. A spec that fails here never reaches outputs/.
 *
 * Schema parsing catches malformed specs; this catches *plausible* ones — a
 * binding to a field that does not exist, a pie of ninety slices, a table of
 * fifty thousand unwindowed rows. Those are the failures that would otherwise
 * render as a blank card or a frozen tab, and they are exactly what a model
 * gets wrong while producing perfectly valid JSON.
 *
 * The checks themselves live in `rules.ts`, where each also carries the repair
 * that fixes it. This file is the *sequencer*: it decides what runs when, and
 * where to stop. That split matters because the order is not incidental —
 * running a binding check against frames that could not be computed reports
 * cascading noise instead of the one real problem.
 */

export interface Issue {
  level: "error" | "warning";
  /** Block or derivation id, or "$" for the spec itself. */
  where: string;
  message: string;
  /** What to do instead. Fed straight back to the composer on a retry. */
  fix?: string;
  /** Which rule produced this, so the repair layer can look it up. */
  ruleId?: RuleId;
}

export interface ValidationResult {
  ok: boolean;
  issues: Issue[];
  /** Present only when execution succeeded, so callers can render or snapshot. */
  frames?: Map<string, Frame>;
  /** Violations paired with their rules, for the repair layer. */
  violations?: Array<{ rule: Rule; violation: Violation }>;
}

export interface ValidateOptions {
  /** True when a control is narrowing the data. Changes what "empty" means. */
  filtered?: boolean;
  /** False in server mode: no base rows, so derivation rewrites are impossible. */
  canRewriteDerivations?: boolean;
}

/** Blocks with no data binding at all, which most rules cannot apply to. */
const isBound = (b: Block): boolean => b.kind !== "text";

export function validate(
  raw: unknown,
  base: Record<string, Row[]>,
  profile?: DatasetProfile,
  options: ValidateOptions = {},
): ValidationResult {
  /* -- phase: schema. Nothing below can run until the shape is legal. -- */

  const parsed = DashboardSpecSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({
        level: "error" as const,
        where: i.path.join(".") || "$",
        message: i.message,
        fix: "Fix the spec to match disco/v1 and re-emit.",
        ruleId: "spec.schema" as const,
      })),
    };
  }

  const spec: DashboardSpec = parsed.data;
  const issues: Issue[] = [];
  const violations: Array<{ rule: Rule; violation: Violation }> = [];

  let minted = 0;
  const ctx: RuleContext = {
    spec,
    frames: new Map(),
    profile,
    frameIds: new Set([...Object.keys(base), ...spec.derivations.map((d) => d.id)]),
    filtered: options.filtered ?? false,
    // Counter-based rather than random: a repair must produce the same ids on
    // every run, or a spec diff becomes unreviewable.
    mintId: (prefix) => `${prefix}_${++minted}`,
    canRewriteDerivations: options.canRewriteDerivations ?? true,
  };

  const record = (rule: Rule, violation: Violation) => {
    const fix = rule.fix(violation);
    issues.push({
      level: rule.level,
      where: violation.where,
      message: rule.message(violation),
      ...(fix ? { fix } : {}),
      ruleId: rule.id,
    });
    violations.push({ rule, violation });
  };

  const run = (rules: Rule[], target: Block | DashboardSpec) => {
    for (const rule of rules) {
      const v = rule.detect(target, ctx);
      if (v) record(rule, v);
    }
  };

  const inPhase = (p: Phase) => RULES.filter((r) => r.phase === p);
  const specRules = (p: Phase) => inPhase(p).filter((r) => r.scope === "$");
  const blockRules = (p: Phase, kind: Block["kind"]) =>
    inPhase(p).filter((r) => r.scope !== "$" && r.scope.includes(kind));

  /* -- phase: structure ------------------------------------------- */

  run(specRules("structure"), spec);

  // Stop on a structural error: ids and frame names are how everything below
  // finds anything at all.
  if (issues.some((i) => i.level === "error")) return { ok: false, issues, violations };

  /* -- execute. A derivation that throws is a spec bug, not a surprise. -- */

  let frames: Map<string, Frame>;
  try {
    frames = runPipeline(base, spec.derivations);
  } catch (e) {
    return {
      ok: false,
      issues: [
        {
          level: "error",
          where: "$",
          message: `Derivation pipeline failed: ${(e as Error).message}`,
          fix: "Check each derivation's `from` forms a DAG rooted at a base table.",
          ruleId: "spec.pipeline_failed",
        },
      ],
      violations,
    };
  }
  ctx.frames = frames;

  /* -- phase: binding. Bindings resolve against real, executed data. -- */

  for (const b of spec.blocks) {
    if (!isBound(b)) continue;

    // An empty primary frame suppresses that block's field checks. Every field
    // in an empty frame reads as missing, which buries the one real problem
    // under a dozen phantom ones.
    const rules = blockRules("binding", b.kind);
    const empty = rules.find((r) => r.id === "block.empty_frame");
    if (empty) {
      const v = empty.detect(b, ctx);
      if (v) {
        record(empty, v);
        continue;
      }
    }

    run(rules.filter((r) => r.id !== "block.empty_frame"), b);
  }

  /* -- phase: perceptual. Valid JSON that would still read badly. -- */

  for (const b of spec.blocks) {
    if (!isBound(b)) continue;
    run(blockRules("perceptual", b.kind), b);
  }

  /* -- phase: dashboard -------------------------------------------- */

  run(specRules("dashboard"), spec);

  return { ok: !issues.some((i) => i.level === "error"), issues, frames, violations };
}

/**
 * Render issues as the block the composer reads on a retry.
 *
 * The whitespace is load-bearing: "warn " is padded to five characters so the
 * `[id]` column lines up with "ERROR", and the nine-space `fix:` indent puts
 * the advice under the message it belongs to. This string is an interface an
 * agent parses, not incidental formatting.
 */
export function formatIssues(issues: Issue[]): string {
  if (issues.length === 0) return "No issues.";
  return issues
    .map(
      (i) =>
        `${i.level === "error" ? "ERROR" : "warn "}  [${i.where}] ${i.message}${i.fix ? `\n         fix: ${i.fix}` : ""}`,
    )
    .join("\n");
}
