import type { Frame, Row } from "./algebra";
import { applyControls, resolveControls, type ControlState, type ResolvedControl } from "./controls";
import type { Block, DashboardSpec, Derivation } from "./spec";
import type { RepairOp, Rule, Violation } from "./rules";
import { validate, type Issue } from "./validate";
import type { DatasetProfile } from "./types";

/**
 * Late binding.
 *
 * A spec is authored once and rebound to whatever the producer dropped this
 * run. Between runs the data moves underneath it: a dimension gains a seventh
 * category and the donut becomes unreadable, a date range extends and the line
 * chart blows its point budget, a table crosses the row limit. None of that is
 * a spec bug — the spec was right when it was written — so the answer is not to
 * reject it but to adapt the encoding and say so.
 *
 * Two rules make that safe rather than spooky:
 *
 *   1. **Repairs are never persisted.** They are applied to a copy on the way
 *      to the renderer. A donut converted to a bar because categories grew must
 *      become a donut again when they shrink, and it can only do that if the
 *      authored spec still says "donut".
 *
 *   2. **Every repair is surfaced.** Silent adaptation is indistinguishable
 *      from a bug, and worse, it hides the fact that the data changed shape —
 *      which is often the more interesting finding.
 */

/**
 * A repair that was applied, as the reader sees it.
 *
 * Distinct from `Repair` in rules.ts, which is what a rule *offers*. This is
 * the record of one having been applied, with the measured fact that justified
 * it — the difference between a capability and an event.
 */
export interface AppliedRepair {
  ruleId: string;
  /** The block, or "$". */
  where: string;
  /** Past tense, one line: "Donut became a bar chart." */
  note: string;
  /** The measured fact behind it: "plan grew to 9 categories, limit is 6." */
  because: string;
  /** True when the repair hides data — a truncated series, a rolled-up tail. */
  lossy: boolean;
  /** The ops that were applied, so the reader can pin them into the spec. */
  ops: RepairOp[];
}

export interface Resolved {
  /** Controls injected and encodings repaired. NEVER written to disk. */
  spec: DashboardSpec;
  frames: Map<string, Frame>;
  repairs: AppliedRepair[];
  /** Problems no repair could fix. These are real and need a human. */
  unresolved: Issue[];
  controls: ResolvedControl[];
  /** True when a control is narrowing the data. */
  filtered: boolean;
}

export interface ResolveOptions {
  /** Explicit, never `Date.now()` inside — see the note on determinism below. */
  now: number;
  state?: ControlState;
  /** False in server mode: no base rows, so derivations cannot be re-run. */
  canRewriteDerivations?: boolean;
  maxPasses?: number;
}

/**
 * Three passes is the cap, and it is generous.
 *
 * Every repair steps strictly *down* a ladder — a donut becomes a bar, a bucket
 * widens, a scale goes linear — and none can re-enable a form it just
 * disabled. So the violation set shrinks monotonically and a fixpoint is
 * reached in one or two passes in practice. The cap exists to turn a
 * hypothetical cycle into a visible warning rather than a hung render.
 */
const DEFAULT_MAX_PASSES = 3;

/** Apply the ops a rule's repair emitted. Deliberately small: rules only emit these. */
function applyOps(spec: DashboardSpec, ops: RepairOp[]): DashboardSpec {
  let blocks = spec.blocks;
  let derivations = spec.derivations;
  let dataset = spec.dataset;

  for (const op of ops) {
    switch (op.op) {
      case "updateBlock":
        blocks = blocks.map((b) => (b.id === op.id ? ({ ...b, ...(op.set as object) } as Block) : b));
        break;

      case "changeKind":
        blocks = blocks.map((b) =>
          b.id === op.id ? ({ ...b, kind: op.to, ...(op.encoding as object) } as unknown as Block) : b,
        );
        break;

      case "addDerivation": {
        const d = op.derivation as Derivation;
        // A repair cannot know which frame the block will be reading by the
        // time its op runs — an earlier repair in the same pass may already
        // have rebound it — so it leaves `from` blank and it is filled here.
        const target = blocks.find((b) => b.kind !== "text" && (b as { from: string }).from);
        const from = d.from || (target ? (target as { from: string }).from : "raw");
        derivations = [...derivations, { ...d, from } as Derivation];
        break;
      }

      case "updateDerivation":
        derivations = derivations.map((d) => (d.id === op.id ? ({ ...d, ...(op.set as object) } as Derivation) : d));
        break;

      case "rebind":
        blocks = blocks.map((b) =>
          b.id === op.blockId ? ({ ...b, from: op.from } as Block) : b,
        );
        break;

      case "setMode":
        dataset = { ...dataset, mode: op.mode as "client" | "server" };
        break;

      default:
        // An op the resolver does not know is left alone rather than guessed
        // at. It will still be reported as unresolved, which is the honest
        // outcome.
        break;
    }
  }

  return { ...spec, blocks, derivations, dataset };
}

/** The measured fact behind a repair, phrased for a reader rather than a log. */
function because(rule: Rule, v: Violation): string {
  const facts = v.facts as Record<string, unknown>;
  if (facts.categories !== undefined) return `${facts.categories} categories, above the limit`;
  if (facts.points !== undefined) return `${facts.points} points, above the line budget`;
  if (facts.rows !== undefined) return `${facts.rows} rows`;
  if (facts.count !== undefined) return `${facts.count} series, above the colour limit`;
  if (facts.field !== undefined) return `"${facts.field}" cannot be summed`;
  return rule.message(v);
}

export function resolve(
  authored: DashboardSpec,
  profile: DatasetProfile,
  base: Record<string, Row[]>,
  options: ResolveOptions,
): Resolved {
  const maxPasses = options.maxPasses ?? DEFAULT_MAX_PASSES;
  const canRewriteDerivations = options.canRewriteDerivations ?? true;

  /* -- 1. controls first: repairs must judge the data the reader sees ------ */

  const controls = resolveControls(authored, profile, options.state ?? {}, options.now);
  const { spec: controlled, filtered } = applyControls(authored, controls);

  /* -- 2. repair to a fixpoint -------------------------------------------- */

  let current = controlled;
  const repairs: AppliedRepair[] = [];
  let unresolved: Issue[] = [];
  let previousCount = Infinity;

  for (let pass = 0; pass < maxPasses; pass++) {
    const result = validate(current, base, profile, { filtered, canRewriteDerivations });

    // A structural failure is not repairable and re-running would report the
    // same thing forever.
    if (!result.frames) {
      unresolved = result.issues;
      break;
    }

    const fixable = (result.violations ?? []).filter((v) => v.rule.repair);
    if (fixable.length === 0) {
      unresolved = result.issues;
      break;
    }

    // Monotonicity guard. Every repair steps down a ladder, so the violation
    // set must shrink; if it has not, something is oscillating and stopping is
    // better than looping.
    if (fixable.length >= previousCount) {
      unresolved = result.issues;
      break;
    }
    previousCount = fixable.length;

    let minted = 0;
    let next = current;
    let applied = 0;

    for (const { rule, violation } of fixable) {
      const repair = rule.repair!(violation, {
        spec: next,
        frames: result.frames,
        profile,
        frameIds: new Set([...Object.keys(base), ...next.derivations.map((d) => d.id)]),
        filtered,
        mintId: (p) => `${p}_${++minted}`,
        canRewriteDerivations,
      });

      if (!repair) continue;

      next = applyOps(next, repair.ops);
      applied += 1;
      repairs.push({
        ruleId: rule.id,
        where: violation.where,
        note: repair.note,
        because: because(rule, violation),
        lossy: repair.lossy,
        ops: repair.ops,
      });
    }

    if (applied === 0) {
      unresolved = result.issues;
      break;
    }
    current = next;
  }

  /* -- 3. final execution -------------------------------------------------- */

  const final = validate(current, base, profile, { filtered, canRewriteDerivations });
  unresolved = final.issues;

  // No fallback. If validation could not produce frames the spec is broken, and
  // quietly re-running the pipeline anyway would render numbers from a spec
  // that failed its own gate — which is how a schema error stayed invisible
  // here for exactly as long as it took to write a test that looked.
  const frames = final.frames ?? new Map<string, Frame>();

  return { spec: current, frames, repairs, unresolved, controls, filtered };
}

/**
 * Turn applied repairs into a patch that makes them permanent.
 *
 * The "pin this change" action. Repairs are transient by design, but a reader
 * who agrees with one should be able to keep it — and because a repair already
 * *is* a list of patch ops, that costs nothing.
 */
export function pinnable(repairs: AppliedRepair[]): RepairOp[] {
  return repairs.flatMap((r) => r.ops);
}
