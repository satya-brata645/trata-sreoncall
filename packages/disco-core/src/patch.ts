import { z } from "zod";

import { frameBindings } from "./bindings";
import { isControlId } from "./controls";
import { solveLayout, layoutHints, type Layout, type Rect } from "./layout";
import { resolve, type Resolved } from "./resolve";
import { BlockSchema, ControlSchema, DashboardSpecSchema, DerivationSchema, type Block, type Control, type DashboardSpec, type Derivation } from "./spec";
import { formatIssues, type Issue } from "./validate";
import type { Row } from "./algebra";
import type { DatasetProfile } from "./types";

/**
 * The edit protocol.
 *
 * Every change to a dashboard — a conversational one, a pinned repair, a
 * dragged span — arrives here as a list of typed operations and is applied as
 * a **transaction**. It commits whole or not at all.
 *
 * That is not defensive coding; it is the only way an agent can be allowed to
 * edit a live dashboard. A half-applied patch leaves a spec that references a
 * derivation that was never added, and the failure surfaces three layers away
 * as a blank card. Rejecting the whole patch and handing back the validator's
 * own `fix:` lines means the agent gets a correction it can act on, and the
 * user's dashboard is untouched in the meantime.
 */

export type PatchOp =
  | { op: "addBlock"; block: Block; at?: number; derivations?: Derivation[] }
  | { op: "removeBlock"; id: string }
  | { op: "updateBlock"; id: string; set: Record<string, unknown> }
  | { op: "changeKind"; id: string; to: Block["kind"]; encoding: Record<string, unknown> }
  | { op: "setSpan"; id: string; span: number }
  /** A full permutation, not a move: its inverse is trivial and it is idempotent. */
  | { op: "reorderBlocks"; ids: string[] }
  | { op: "retitle"; target: string; title?: string; subtitle?: string }
  | { op: "addDerivation"; derivation: Derivation }
  | { op: "removeDerivation"; id: string }
  | { op: "updateDerivation"; id: string; set: Record<string, unknown> }
  | { op: "rebind"; blockId: string; from: string; spark?: boolean }
  | { op: "addControl"; control: Control }
  | { op: "removeControl"; id: string }
  | { op: "setControlDefault"; id: string; value: unknown }
  | { op: "addNote"; text: string }
  | { op: "setMode"; mode: "client" | "server" };

export interface Patch {
  $schema: "disco/patch/v1";
  /** What the user asked for, in their words. Shown in the undo history. */
  intent: string;
  ops: PatchOp[];
}

/**
 * The same union at runtime.
 *
 * `applyPatch` takes a typed `Patch`, which is a promise the compiler cannot
 * keep once the patch arrives over HTTP from a model. Without this, a malformed
 * op reaches `applyOp`, and the rejection it produces names `undefined` as the
 * failing operation — useless as a retry prompt. Parsing at the boundary turns
 * that into a precise path.
 *
 * `set` on the update ops stays open: it is a partial of whichever block or
 * derivation it targets, and the real check is the schema re-parse that
 * `applyPatch` runs on the whole draft afterwards.
 */
const Loose = z.record(z.string(), z.unknown());

export const PatchOpSchema: z.ZodType<PatchOp> = z.discriminatedUnion("op", [
  z.object({ op: z.literal("addBlock"), block: BlockSchema, at: z.number().int().optional(), derivations: z.array(DerivationSchema).optional() }),
  z.object({ op: z.literal("removeBlock"), id: z.string() }),
  z.object({ op: z.literal("updateBlock"), id: z.string(), set: Loose }),
  z.object({ op: z.literal("changeKind"), id: z.string(), to: z.string(), encoding: Loose }),
  z.object({ op: z.literal("setSpan"), id: z.string(), span: z.number().int() }),
  z.object({ op: z.literal("reorderBlocks"), ids: z.array(z.string()) }),
  z.object({ op: z.literal("retitle"), target: z.string(), title: z.string().optional(), subtitle: z.string().optional() }),
  z.object({ op: z.literal("addDerivation"), derivation: DerivationSchema }),
  z.object({ op: z.literal("removeDerivation"), id: z.string() }),
  z.object({ op: z.literal("updateDerivation"), id: z.string(), set: Loose }),
  z.object({ op: z.literal("rebind"), blockId: z.string(), from: z.string(), spark: z.boolean().optional() }),
  z.object({ op: z.literal("addControl"), control: ControlSchema }),
  z.object({ op: z.literal("removeControl"), id: z.string() }),
  z.object({ op: z.literal("setControlDefault"), id: z.string(), value: z.unknown() }),
  z.object({ op: z.literal("addNote"), text: z.string() }),
  z.object({ op: z.literal("setMode"), mode: z.enum(["client", "server"]) }),
]) as z.ZodType<PatchOp>;

export const PatchSchema = z.object({
  $schema: z.literal("disco/patch/v1"),
  intent: z.string().min(1),
  ops: z.array(PatchOpSchema).min(1).max(40),
});

/**
 * Parse an untrusted patch. Returns the failure as prose the agent can act on,
 * in the same shape the validator uses, so one retry path handles both.
 */
export function parsePatch(input: unknown): { ok: true; patch: Patch } | { ok: false; fixes: string } {
  const r = PatchSchema.safeParse(input);
  if (r.success) return { ok: true, patch: r.data as Patch };
  const lines = r.error.issues.map((i) => `  - ${i.path.join(".") || "$"}: ${i.message}`);
  return { ok: false, fixes: `The patch is not a valid disco/patch/v1 document:\n${lines.join("\n")}` };
}

export interface PatchContext {
  profile: DatasetProfile;
  base: Record<string, Row[]>;
  /** The window the result must fit. A patch that cannot be seen is rejected. */
  rect: Rect;
  now: number;
  canRewriteDerivations?: boolean;
}

export type PatchResult =
  | {
      ok: true;
      spec: DashboardSpec;
      resolved: Resolved;
      layout: Layout;
      /** Applying this to the result returns the input, exactly. */
      inverse: Patch;
      warnings: Issue[];
    }
  | {
      ok: false;
      reason: string;
      /** Index of the op that failed, so an agent can retry from there. */
      at: number;
      issues: Issue[];
      /** The validator's own prose, ready to paste back into a retry. */
      fixes: string;
    };

/* ------------------------------------------------------------------ *
 * Applying one op
 * ------------------------------------------------------------------ */

class OpError extends Error {}

const requireBlock = (spec: DashboardSpec, id: string): Block => {
  const b = spec.blocks.find((x) => x.id === id);
  if (!b) throw new OpError(`no block with id "${id}"`);
  return b;
};

function applyOp(spec: DashboardSpec, op: PatchOp): DashboardSpec {
  switch (op.op) {
    case "addBlock": {
      if (spec.blocks.some((b) => b.id === op.block.id)) throw new OpError(`block id "${op.block.id}" already exists`);
      const at = op.at ?? spec.blocks.length;
      const blocks = [...spec.blocks.slice(0, at), op.block, ...spec.blocks.slice(at)];
      return { ...spec, blocks, derivations: [...spec.derivations, ...(op.derivations ?? [])] };
    }

    case "removeBlock": {
      requireBlock(spec, op.id);
      return { ...spec, blocks: spec.blocks.filter((b) => b.id !== op.id) };
    }

    case "updateBlock": {
      requireBlock(spec, op.id);
      return { ...spec, blocks: spec.blocks.map((b) => (b.id === op.id ? ({ ...b, ...op.set } as Block) : b)) };
    }

    case "changeKind": {
      const b = requireBlock(spec, op.id);
      // Only the shared base survives a kind change. Carrying the old kind's
      // fields across would leave, say, a `category` on a bar chart — legal
      // JSON that the schema then rejects with a confusing message.
      //
      // `from` counts as shared: it is a binding, not an encoding, and a donut
      // becoming a bar reads the same frame unless the caller says otherwise.
      // Dropping it made every changeKind produce a spec with no data source.
      const base = {
        id: b.id, span: b.span, title: b.title, subtitle: b.subtitle, reason: b.reason,
        ...(b.kind !== "text" ? { from: (b as { from: string }).from } : {}),
      };
      return {
        ...spec,
        blocks: spec.blocks.map((x) => (x.id === op.id ? ({ ...base, kind: op.to, ...op.encoding } as unknown as Block) : x)),
      };
    }

    case "setSpan": {
      requireBlock(spec, op.id);
      return { ...spec, blocks: spec.blocks.map((b) => (b.id === op.id ? { ...b, span: op.span } : b)) };
    }

    case "reorderBlocks": {
      const known = new Set(spec.blocks.map((b) => b.id));
      if (op.ids.length !== spec.blocks.length || op.ids.some((id) => !known.has(id))) {
        throw new OpError("reorderBlocks needs a full permutation of the existing block ids");
      }
      const byId = new Map(spec.blocks.map((b) => [b.id, b]));
      return { ...spec, blocks: op.ids.map((id) => byId.get(id)!) };
    }

    case "retitle": {
      if (op.target === "$") {
        return { ...spec, title: op.title ?? spec.title, subtitle: op.subtitle ?? spec.subtitle };
      }
      requireBlock(spec, op.target);
      return {
        ...spec,
        blocks: spec.blocks.map((b) =>
          b.id === op.target ? { ...b, title: op.title ?? b.title, subtitle: op.subtitle ?? b.subtitle } : b,
        ),
      };
    }

    case "addDerivation": {
      if (spec.derivations.some((d) => d.id === op.derivation.id)) {
        throw new OpError(`derivation id "${op.derivation.id}" already exists`);
      }
      if (isControlId(op.derivation.id)) throw new OpError(`"${op.derivation.id}" is reserved for controls`);
      return { ...spec, derivations: [...spec.derivations, op.derivation] };
    }

    case "removeDerivation":
      return { ...spec, derivations: spec.derivations.filter((d) => d.id !== op.id) };

    case "updateDerivation": {
      if (!spec.derivations.some((d) => d.id === op.id)) throw new OpError(`no derivation with id "${op.id}"`);
      return {
        ...spec,
        derivations: spec.derivations.map((d) => (d.id === op.id ? ({ ...d, ...op.set } as Derivation) : d)),
      };
    }

    case "rebind": {
      const b = requireBlock(spec, op.blockId);
      if (isControlId(op.from)) throw new OpError("blocks may not bind directly to a control's filter node");
      if (op.spark) {
        if (b.kind !== "kpi") throw new OpError("only a KPI has a sparkline to rebind");
        if (!b.spark) throw new OpError(`"${op.blockId}" has no sparkline`);
        return {
          ...spec,
          blocks: spec.blocks.map((x) => (x.id === op.blockId ? { ...b, spark: { ...b.spark!, from: op.from } } : x)),
        };
      }
      return { ...spec, blocks: spec.blocks.map((x) => (x.id === op.blockId ? ({ ...x, from: op.from } as Block) : x)) };
    }

    case "addControl": {
      if (spec.controls.some((c) => c.id === op.control.id)) throw new OpError(`control "${op.control.id}" already exists`);
      return { ...spec, controls: [...spec.controls, op.control] };
    }

    case "removeControl":
      return { ...spec, controls: spec.controls.filter((c) => c.id !== op.id) };

    case "setControlDefault": {
      if (!spec.controls.some((c) => c.id === op.id)) throw new OpError(`no control with id "${op.id}"`);
      return {
        ...spec,
        controls: spec.controls.map((c) => (c.id === op.id ? ({ ...c, default: op.value } as Control) : c)),
      };
    }

    case "addNote":
      return { ...spec, notes: [...spec.notes, op.text] };

    case "setMode":
      return { ...spec, dataset: { ...spec.dataset, mode: op.mode } };
  }
}

/* ------------------------------------------------------------------ *
 * Garbage collection and deduplication
 * ------------------------------------------------------------------ */

/**
 * Sweep derivations nothing binds to any more.
 *
 * Marks from **every** binding site via `frameBindings` — which includes a
 * KPI's `spark.from`, the site a hand-written version of this once forgot,
 * silently dropping every sparkline in server mode.
 */
export function gc(spec: DashboardSpec, baseIds: Iterable<string>): DashboardSpec {
  const byId = new Map(spec.derivations.map((d) => [d.id, d]));
  const live = new Set<string>(baseIds);
  const queue = spec.blocks.flatMap(frameBindings);

  // Control filter nodes are roots: a reader's filter is not garbage just
  // because no block names it directly.
  for (const d of spec.derivations) if (isControlId(d.id)) queue.push(d.id);

  while (queue.length > 0) {
    const id = queue.pop()!;
    if (live.has(id)) continue;
    live.add(id);
    const d = byId.get(id);
    if (d) queue.push(d.from);
  }

  return { ...spec, derivations: spec.derivations.filter((d) => live.has(d.id)) };
}

/**
 * Collapse derivations that compute exactly the same thing.
 *
 * The hash replaces `from` with the *parent's hash* rather than its id, so two
 * identical groupBys over two identically-defined but differently-named parents
 * collapse together. Without that, "add revenue by plan" would add a second
 * copy of a groupBy the dashboard already had, and every future edit would
 * compound the duplication.
 *
 * Runs strictly AFTER `gc`. Reversed, a soon-to-be-garbage derivation can win a
 * tie, become the survivor, then get swept — leaving dangling references that
 * only fail when the pipeline runs.
 */
/** Stable JSON with keys sorted at every depth, so equal shapes hash equal. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

export function dedupe(spec: DashboardSpec): DashboardSpec {
  const byId = new Map(spec.derivations.map((d) => [d.id, d]));
  const hashes = new Map<string, string>();

  const hashOf = (id: string, seen = new Set<string>()): string => {
    const cached = hashes.get(id);
    if (cached) return cached;
    const d = byId.get(id);
    // A base table is its own identity; a cycle is caught by the validator.
    if (!d || seen.has(id)) return `base:${id}`;
    seen.add(id);

    const { id: _id, label: _label, from, ...rest } = d as Record<string, unknown> & { id: string; from: string };
    // NOT `JSON.stringify(rest, Object.keys(rest).sort())`. An array replacer is
    // a property *allowlist* applied at every depth, so `agg: { amount: "sum" }`
    // lost its inner key and a sum hashed identically to an avg — two charts
    // claiming different numbers would have silently shown the same one.
    const shape = canonical(rest);
    const h = `${shape}|${hashOf(from, seen)}`;
    hashes.set(id, h);
    return h;
  };

  const survivor = new Map<string, string>();
  const rename = new Map<string, string>();

  // Lexical order, so which of two duplicates survives is stable across runs
  // and a spec diff stays reviewable.
  for (const d of [...spec.derivations].sort((a, b) => a.id.localeCompare(b.id))) {
    if (isControlId(d.id)) continue;
    const h = hashOf(d.id);
    const first = survivor.get(h);
    if (first) rename.set(d.id, first);
    else survivor.set(h, d.id);
  }

  if (rename.size === 0) return spec;

  const repoint = <T extends { from: string }>(x: T): T =>
    rename.has(x.from) ? { ...x, from: rename.get(x.from)! } : x;

  return {
    ...spec,
    derivations: spec.derivations.filter((d) => !rename.has(d.id)).map(repoint),
    blocks: spec.blocks.map((b) => {
      if (b.kind === "text") return b;
      const rebound = repoint(b as { from: string } & typeof b);
      if (rebound.kind === "kpi" && rebound.spark && rename.has(rebound.spark.from)) {
        return { ...rebound, spark: { ...rebound.spark, from: rename.get(rebound.spark.from)! } };
      }
      return rebound;
    }),
  };
}

/* ------------------------------------------------------------------ *
 * The transaction
 * ------------------------------------------------------------------ */

/** Compute the patch that undoes this one. Returned, never applied here. */
function invert(before: DashboardSpec, patch: Patch): Patch {
  // Snapshot-based rather than op-by-op. Inverting each op individually is
  // where "we thought we could reconstruct it" bugs live — a `changeKind`
  // inverse has to remember every field the old kind had. Restoring the whole
  // authored spec cannot drift from op semantics because it does not model
  // them at all.
  return {
    $schema: "disco/patch/v1",
    intent: `Undo: ${patch.intent}`,
    ops: [{ op: "__restore", spec: before } as unknown as PatchOp],
  };
}

export function applyPatch(spec: DashboardSpec, patch: Patch, ctx: PatchContext): PatchResult {
  // Deep clone so a rejected patch cannot have touched the caller's spec even
  // partially. Cheap: a spec is single-digit kilobytes.
  let draft: DashboardSpec = structuredClone(spec);

  for (let i = 0; i < patch.ops.length; i++) {
    try {
      draft = applyOp(draft, patch.ops[i]);
    } catch (e) {
      return {
        ok: false,
        at: i,
        reason: (e as Error).message,
        issues: [],
        fixes: `Operation ${i} (${patch.ops[i].op}) failed: ${(e as Error).message}`,
      };
    }
  }

  // Order matters — see the note on `dedupe`.
  draft = dedupe(gc(draft, Object.keys(ctx.base)));

  const parsed = DashboardSpecSchema.safeParse(draft);
  if (!parsed.success) {
    const issues: Issue[] = parsed.error.issues.map((i) => ({
      level: "error" as const,
      where: i.path.join(".") || "$",
      message: i.message,
      fix: "Fix the spec to match disco/v1 and re-emit.",
    }));
    return { ok: false, at: -1, reason: "the patched spec is not a valid disco/v1 spec", issues, fixes: formatIssues(issues) };
  }

  const resolved = resolve(parsed.data, ctx.profile, ctx.base, {
    now: ctx.now,
    canRewriteDerivations: ctx.canRewriteDerivations,
  });

  const errors = resolved.unresolved.filter((i) => i.level === "error");
  if (errors.length > 0) {
    return {
      ok: false,
      at: -1,
      reason: "the patched spec does not validate against the data",
      issues: resolved.unresolved,
      fixes: formatIssues(resolved.unresolved),
    };
  }

  const layout = solveLayout(
    resolved.spec.blocks,
    ctx.rect,
    layoutHints(resolved.spec.blocks, resolved.frames),
  );

  // A block this patch ADDED that lands hidden is a rejection, not a success.
  // "A radar needs 220x220; this window has 180 of height" is a better answer
  // than silently adding something the user cannot see and will ask about.
  const added = new Set(
    patch.ops.flatMap((o) => (o.op === "addBlock" ? [o.block.id] : [])),
  );
  const invisible = layout.hidden.filter((h) => added.has(h.blockId));
  if (invisible.length > 0) {
    const issues: Issue[] = invisible.map((h) => ({
      level: "error" as const,
      where: h.blockId,
      message: `The new block does not fit this window: ${h.reason}.`,
      fix: "Widen the window, remove a block first, or choose a form that fits.",
    }));
    return { ok: false, at: -1, reason: "a new block would be invisible at this window size", issues, fixes: formatIssues(issues) };
  }

  return {
    ok: true,
    spec: parsed.data,
    resolved,
    layout,
    inverse: invert(spec, patch),
    warnings: resolved.unresolved.filter((i) => i.level === "warning"),
  };
}

/* ------------------------------------------------------------------ *
 * Undo
 * ------------------------------------------------------------------ */

export interface HistoryEntry {
  intent: string;
  /** The AUTHORED spec, before resolve. Undo must never restore a repair. */
  before: DashboardSpec;
  after: DashboardSpec;
}

/**
 * A bounded undo stack of authored-spec snapshots.
 *
 * Snapshots rather than inverse ops, for the reason given in `invert`. They are
 * pre-resolve on purpose: a donut auto-converted to a bar during a wide run
 * must still be a donut in the history, or undoing past that point would bake
 * a transient repair into the authored spec permanently.
 */
export class History {
  private entries: HistoryEntry[] = [];

  constructor(private readonly limit = 50) {}

  push(entry: HistoryEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.limit) this.entries.shift();
  }

  undo(): DashboardSpec | null {
    const last = this.entries.pop();
    return last ? last.before : null;
  }

  get depth(): number {
    return this.entries.length;
  }

  peek(): HistoryEntry | undefined {
    return this.entries[this.entries.length - 1];
  }
}
