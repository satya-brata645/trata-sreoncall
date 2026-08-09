/**
 * The contract between the agent and the desktop.
 *
 * This file is *the thing the model sees*. Everything here is pure — no React,
 * no DOM, no window manager — so the whole protocol is testable without a
 * browser, the same way `geometry.ts` is.
 *
 * See `docs/os-agent-control.md` §5 for the reasoning behind each property and
 * `docs/os-agent-control-requirements.md` for the numbered requirements. The
 * short version:
 *
 *  - **Windows are addressed by small integers** (`[1]`, `[2]`), re-issued on
 *    every read, never by internal id. Speakable, compact, and a handle the
 *    model invents fails validation instead of moving the wrong window.
 *  - **Apps are addressed by id**, because an app id is already stable and
 *    meaningful. Only windows need the indirection.
 *  - **The snapshot carries its own diff**, so the agent sees what its last
 *    action did rather than assuming.
 *  - **An epoch guards stale plans.** A batch planned against a desktop that
 *    has since changed shape is rejected whole.
 *  - **Verbs are classified** into those that change *which windows exist* and
 *    those that only change their state. That one distinction decides what may
 *    be chained in a single batch.
 */

import type { OsRect, OsSnapPreset } from "./geometry";

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

/**
 * What the agent may do without asking. Two modes, not three.
 *
 * Defined here rather than alongside the client store because the snapshot
 * carries it — the mode is part of what the agent is told about its own
 * situation, not merely a UI preference.
 *
 * An earlier design had a third, `auto`, where reaching inside an app stopped
 * asking. It is gone deliberately rather than merely unused: the only verbs it
 * changed are the two that alter what the user is looking *at*, so `auto` was
 * precisely the mode in which the agent could change your work without you
 * knowing. Collab already leaves window arrangement unasked, which is where the
 * friction would otherwise have been. Nothing was left behind it to re-enable.
 */
export type OsAgentMode = "self" | "collab";

export const OS_AGENT_MODES: readonly OsAgentMode[] = ["self", "collab"] as const;

/** Safe default for a caller with no stored preference. */
export const DEFAULT_AGENT_MODE: OsAgentMode = "collab";

/** Rank, so an org ceiling can clamp a requested mode by comparison. */
const MODE_RANK: Record<OsAgentMode, number> = { self: 0, collab: 1 };

/**
 * The effective mode for a request: the caller's preference, never above the
 * organization's ceiling.
 *
 * Lives here so the client and the route tier compute it identically — but the
 * route tier's answer is the only one that counts. A client's selector is a
 * preference, never an authorization (see `SEC-5`).
 */
export function clampMode(
  requested: OsAgentMode,
  ceiling: OsAgentMode,
): OsAgentMode {
  return MODE_RANK[requested] <= MODE_RANK[ceiling] ? requested : ceiling;
}

// ---------------------------------------------------------------------------
// Verbs
// ---------------------------------------------------------------------------

export type DesktopVerb =
  | "open_app"
  | "close_window"
  | "focus"
  | "minimize"
  | "restore"
  | "snap"
  | "set_geometry"
  | "pin_app"
  | "unpin_app"
  | "focus_panel"
  | "set_affordance"
  | "full_screen";

/**
 * What a verb does to the desktop, which is what decides batching.
 *
 * - `set` — changes *which windows exist*. Every handle after it is suspect, so
 *   it ends the batch and the agent re-reads.
 * - `state` — changes a window's state or geometry. The set is untouched, so
 *   handles stay valid and these chain freely.
 * - `forbidden` — declared so a refusal can teach, rather than reading to the
 *   model as an unknown verb it should retry differently.
 */
export type VerbClass = "set" | "state" | "forbidden";

export type Permission = "allow" | "ask" | "deny";

export interface VerbSpec {
  verb: DesktopVerb;
  verbClass: VerbClass;
  permissions: Record<OsAgentMode, Permission>;
  /** Said aloud when the verb is refused, so the agent learns the alternative. */
  refusal?: string;
}

/**
 * The verb table, as data.
 *
 * Mode gating lives here rather than in the executor so the same table drives
 * the client's guard, the route tier's `needsApproval`, and the tests. One
 * source of truth for "may the agent do this."
 */
export const VERB_TABLE: Readonly<Record<DesktopVerb, VerbSpec>> = {
  // **Collab does not ask to arrange your windows.** Asking to move a window is
  // not collaboration, it is a permission dialog with extra steps — and a
  // staging request that stops for a click is the opposite of someone
  // arranging your screen while you keep working. The consent boundary sits
  // where the agent reaches *inside* an app and changes what you are working
  // on (`focus_panel`, `set_affordance`), not where it tidies the frames.
  open_app: {
    verb: "open_app",
    verbClass: "set",
    permissions: { self: "deny", collab: "allow" },
  },
  focus: {
    verb: "focus",
    verbClass: "state",
    permissions: { self: "deny", collab: "allow" },
  },
  restore: {
    verb: "restore",
    verbClass: "state",
    permissions: { self: "deny", collab: "allow" },
  },

  minimize: {
    verb: "minimize",
    verbClass: "state",
    permissions: { self: "deny", collab: "allow" },
  },
  snap: {
    verb: "snap",
    verbClass: "state",
    permissions: { self: "deny", collab: "allow" },
  },
  set_geometry: {
    verb: "set_geometry",
    verbClass: "state",
    permissions: { self: "deny", collab: "allow" },
  },
  pin_app: {
    verb: "pin_app",
    verbClass: "state",
    permissions: { self: "deny", collab: "allow" },
  },
  unpin_app: {
    verb: "unpin_app",
    verbClass: "state",
    permissions: { self: "deny", collab: "allow" },
  },

  // Changing which panel a window shows. A `state` verb: the window set is
  // untouched, so handles stay valid and this chains freely with arrangement.
  // Gated like any other write — it changes what the user is looking at.
  // Setting a control *inside* a window. A `state` verb for the same reason
  // `focus_panel` is: which windows exist does not change, so a batch can keep
  // going. That answer is only available because affordances are **declared**
  // — a harvested element's class is unknowable, which is what `D3` rests on
  // and why `os-agent-control.md` §12.1 refused harvesting.
  set_affordance: {
    verb: "set_affordance",
    verbClass: "state",
    // **One of the two verbs that still asks in Collab.** Narrowing a list
    // changes what you are working *in*, not merely where the window sits —
    // and what a screen shows is what a person acts on. Window arrangement is
    // free; reaching inside is the thing worth interrupting for.
    permissions: { self: "deny", collab: "ask" },
  },

  focus_panel: {
    verb: "focus_panel",
    verbClass: "state",
    permissions: { self: "deny", collab: "ask" },
  },

  // Closing destroys in-flight work, which is why the dock's own click
  // minimizes rather than closes — and why the doctrine forbids closing a
  // window the agent did not open. That doctrine rule is now the *only* thing
  // standing between Collab and a closed window, since the approval no longer
  // does. `restore_layout` is the mitigation. Worth revisiting if it bites.
  close_window: {
    verb: "close_window",
    verbClass: "set",
    permissions: { self: "deny", collab: "allow" },
  },

  // The one verb refused in every mode. Full screen hides the
  // dock *and* the menu bar — which is where the mode control lives. An agent
  // that full-screens a window has hidden the user's off-switch. `fill` gives
  // the same one-big-window result with the controls still reachable.
  full_screen: {
    verb: "full_screen",
    verbClass: "forbidden",
    permissions: { self: "deny", collab: "deny" },
    refusal:
      "Full screen is reserved for the user — it hides the menu bar and dock. Use snap with the 'fill' preset instead.",
  },
} as const;

/** Does this verb end a batch? True exactly when it changes the window set. */
export function terminatesBatch(verb: DesktopVerb): boolean {
  return VERB_TABLE[verb].verbClass === "set";
}

/** What the given mode permits for a verb. Unknown verbs are denied. */
export function permissionFor(
  verb: DesktopVerb,
  mode: OsAgentMode,
): Permission {
  return VERB_TABLE[verb]?.permissions[mode] ?? "deny";
}

/**
 * The verbs offered to the model in a given mode.
 *
 * In `self` this is empty and the tools are omitted from the request entirely —
 * not offered and refused. A tool the model can see is a tool it will try.
 */
export function verbsForMode(mode: OsAgentMode): DesktopVerb[] {
  return (Object.keys(VERB_TABLE) as DesktopVerb[]).filter(
    (verb) => permissionFor(verb, mode) !== "deny",
  );
}

// ---------------------------------------------------------------------------
// Steps and batches
// ---------------------------------------------------------------------------

export type DesktopStep =
  | { verb: "open_app"; appId: string; title?: string }
  | { verb: "close_window"; handle: number }
  | { verb: "focus"; handle: number }
  | { verb: "minimize"; handle: number }
  | { verb: "restore"; handle: number }
  | { verb: "snap"; handle: number; preset: OsSnapPreset }
  | { verb: "set_geometry"; handle: number; rect: OsRect }
  | { verb: "pin_app"; appId: string }
  | { verb: "unpin_app"; appId: string }
  | {
      verb: "focus_panel";
      handle: number;
      panel: string;
      /**
       * Which *one* the panel should show, when the panel names a kind of
       * thing rather than a fixed view — chat's `conversation` panel needs to
       * know which conversation.
       *
       * Deliberately one opaque string and not a params bag: a panel that
       * needs two values is a panel that has not been decomposed, and an open
       * map here would be the harvested-DOM design arriving by the back door,
       * where nothing static says what a value does.
       */
      value?: string;
    }
  | {
      verb: "set_affordance";
      handle: number;
      /** Which declared control, by its id. */
      affordance: string;
      /**
       * What to set it to. Empty string clears it.
       *
       * One string, and note what is *absent*: there is no shape here for
       * "submit", "confirm" or "apply". An affordance can only narrow or move
       * what is displayed. That makes doctrine rule `dont-submit` structural
       * rather than merely asserted — an agent cannot reach for a verb the
       * protocol cannot express.
       */
      value: string;
    }
  | { verb: "full_screen"; handle: number; on: boolean };

/** An ordered plan, tagged with the desktop it was planned against. */
export interface DesktopBatch {
  /** The `epoch` from the snapshot this plan was built from. */
  epoch: string;
  steps: DesktopStep[];
}

/**
 * What happened to one step.
 *
 * `noop` is deliberately distinct from `ok`: asking to snap a window that is
 * already snapped there succeeded, but nothing moved, and an agent told "ok"
 * would credit itself with a change the user never saw.
 */
export type StepStatus = "ok" | "noop" | "refused" | "failed" | "skipped";

export interface StepOutcome {
  /** Position in the submitted batch, so partial results are unambiguous. */
  index: number;
  step: DesktopStep;
  status: StepStatus;
  /**
   * One human sentence. Deliberately one string with three consumers: it goes
   * to the model, into the audit record, and into the live region announced to
   * assistive tech — and those must never disagree about what happened.
   */
  detail: string;
}

export type BatchStopReason =
  | "set-changed"
  | "diverged"
  | "failed"
  | "refused"
  | "interrupted"
  | "budget";

export interface BatchResult {
  /**
   * `rejected` means nothing ran — the plan was stale. `stopped` means some
   * steps ran and the rest were skipped.
   */
  status: "completed" | "stopped" | "rejected";
  stopReason?: BatchStopReason;
  /** Always present, even on failure. The agent must never have to guess how far it got. */
  outcomes: StepOutcome[];
  /** The desktop as it now stands, so the next plan is built against truth. */
  snapshot: DesktopSnapshot;
}

// ---------------------------------------------------------------------------
// The snapshot
// ---------------------------------------------------------------------------

/** How a window relates to the previous snapshot in the same run. */
export type DiffMark = "new" | "changed" | "unchanged";

/** A part of an app the agent can ask for. Mirrors `OsAppPanel`. */
export interface PanelView {
  id: string;
  label: string;
  description?: string;
}

/** One settable control inside a window, as the agent sees it. */
export interface AffordanceView {
  id: string;
  label: string;
  kind: "search" | "filter" | "select";
  options?: readonly string[];
  description?: string;
  /** What it is set to right now, or undefined when it is not set. */
  value?: string;
}

export interface WindowView {
  /** The integer the agent uses. 1-based; stable while the window set is stable. */
  handle: number;
  /**
   * The window manager's own id. Present so the executor can resolve a handle,
   * and deliberately **never serialized** — the model is not given a second way
   * to name a window.
   */
  windowId: string;
  appId: string;
  title: string;
  rect: OsRect;
  isFocused: boolean;
  isMinimized: boolean;
  isFullScreen: boolean;
  snappedTo?: OsSnapPreset;
  /** What this app can be asked to show. Empty when it is not addressable inside. */
  panels?: readonly PanelView[];
  /** Which of them it is showing now. */
  activePanel?: string;
  /** The controls inside it the agent may set, with their current values. */
  affordances?: readonly AffordanceView[];
  diff: DiffMark;
}

export interface DockEntryView {
  appId: string;
  name: string;
  openWindows: number;
}

export interface DockView {
  /** The OS's own apps. Permanent, never reorderable. */
  system: DockEntryView[];
  /** Security apps the user has kept. */
  pinned: DockEntryView[];
  /** Running but not kept — these come and go with their windows. */
  running: DockEntryView[];
}

/**
 * An app the workspace can open.
 *
 * Descriptions and tags are carried because the agent has to map "my exposure"
 * onto `aws-vulnerability-prioritizer`, and cannot do that from ids alone.
 */
export interface AppCatalogEntry {
  appId: string;
  name: string;
  description?: string;
  tags?: string[];
}

export interface DesktopSnapshot {
  /** Signature of the current window set. See `computeEpoch`. */
  epoch: string;
  mode: OsAgentMode;
  viewport: { width: number; height: number };
  windows: WindowView[];
  dock: DockView;
  catalog: AppCatalogEntry[];
}

// ---------------------------------------------------------------------------
// Epoch
// ---------------------------------------------------------------------------

/** FNV-1a, 32-bit. Not security — this only needs to be stable and cheap. */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // `Math.imul` keeps the multiply in 32-bit space; `>>>` forces unsigned.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, "0");
}

/**
 * A signature of the window set — which windows exist, and what each hosts.
 *
 * **A signature rather than a counter, deliberately.** The epoch exists to
 * answer exactly one question: *are the handles in this plan still pointing at
 * the windows the agent thought they were?* That is a property of the set, not
 * of elapsed time. A signature needs no mutable state to maintain, which is
 * what lets the whole protocol stay pure.
 *
 * It also gets an edge case right that a counter gets wrong. If the user opens
 * a window and closes it again while the agent is thinking, a counter would
 * have advanced twice and would reject a plan that is in fact still perfectly
 * valid — the handles resolve to exactly the same windows. The signature
 * returns to its previous value and the plan proceeds, correctly.
 *
 * Geometry is excluded on purpose. A window that moved is still the same
 * window, and `snap [2] left` remains a coherent instruction whether or not the
 * user nudged it in the meantime.
 */
export function computeEpoch(
  windows: ReadonlyArray<{ id: string; appId: string }>,
): string {
  return fnv1a(windows.map((w) => `${w.id}:${w.appId}`).join("|"));
}

// ---------------------------------------------------------------------------
// Handles and diffing
// ---------------------------------------------------------------------------

/**
 * Assign handles.
 *
 * Order is **creation order** — the order the window manager already keeps,
 * since `openApp` appends and closing filters. Chosen over stacking order
 * because z changes on every click: handles derived from it would renumber
 * themselves whenever the user so much as focused a window, and an agent
 * holding `[2]` across two turns would find it meant something else.
 *
 * Creation order also happens to read the way the user's own session went,
 * which makes the serialized list easier to follow.
 */
export function allocateHandles<T extends { id: string }>(
  windows: readonly T[],
): Map<string, number> {
  const handles = new Map<string, number>();
  windows.forEach((window, index) => {
    handles.set(window.id, index + 1);
  });
  return handles;
}

/** The fields whose change is worth telling the agent about. */
function stateSignature(window: WindowView): string {
  return [
    window.title,
    Math.round(window.rect.x),
    Math.round(window.rect.y),
    Math.round(window.rect.width),
    Math.round(window.rect.height),
    window.isMinimized ? "min" : "",
    window.isFullScreen ? "fs" : "",
    window.snappedTo ?? "",
    window.isFocused ? "focus" : "",
    window.activePanel ?? "",
  ].join(",");
}

/**
 * Mark each window against the previous snapshot.
 *
 * This is what turns "the agent assumes its action worked" into "the agent can
 * see that it did" — the single cheapest defence against the failure Anthropic
 * calls out, where the model credits itself with an outcome it never checked.
 *
 * With no previous snapshot everything is `unchanged` rather than `new`: the
 * first read of a session is a description of the world, not a report of things
 * that just appeared.
 */
export function markDiff(
  windows: readonly WindowView[],
  previous: readonly WindowView[] | null,
): WindowView[] {
  if (!previous) {
    return windows.map((window) => ({ ...window, diff: "unchanged" as const }));
  }

  const before = new Map(previous.map((w) => [w.windowId, w]));
  return windows.map((window) => {
    const prior = before.get(window.windowId);
    if (!prior) return { ...window, diff: "new" as const };
    const diff: DiffMark =
      stateSignature(prior) === stateSignature(window) ? "unchanged" : "changed";
    return { ...window, diff };
  });
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/** Human wording for where a window sits, preferring the arrangement's own name. */
export function describePlacement(window: WindowView): string {
  if (window.isMinimized) return "minimized";
  if (window.isFullScreen) return "full screen";
  if (window.snappedTo) return window.snappedTo.replace(/-/g, " ");
  return `${Math.round(window.rect.width)}×${Math.round(window.rect.height)} floating`;
}

/** The line the agent reads, and close to the phrase it should say aloud. */
export function describeWindow(window: WindowView): string {
  const notes = [describePlacement(window)];
  if (window.isFocused) notes.push("focused");
  const line = `[${window.handle}] ${window.title} — ${notes.join(", ")}`;

  // Only windows that can be addressed inside say so, and only they list their
  // parts — an app with neither panels nor controls stays a single line. The
  // budget matters: this is returned after every batch, so a desktop of six
  // windows must not cost a page.
  const extra: string[] = [];

  if (window.panels?.length) {
    const showing = window.activePanel
      ? window.panels.find((panel) => panel.id === window.activePanel)?.label
      : undefined;
    const options = window.panels.map((panel) => panel.id).join(" | ");
    extra.push(`      showing: ${showing ?? "—"}  ·  panels: ${options}`);
  }

  if (window.affordances?.length) {
    // Each control reports what it is *currently* set to, not just that it
    // exists. Without the current value the agent cannot tell "I set that
    // filter" from "I meant to", and would re-set it every turn.
    const controls = window.affordances
      .map((control) => {
        const set = control.value ? `="${control.value}"` : "";
        const options = control.options?.length
          ? ` (${control.options.join("|")})`
          : "";
        return `${control.id}${set}${options}`;
      })
      .join("  ·  ");
    extra.push(`      controls: ${controls}`);
  }

  return extra.length ? `${line}\n${extra.join("\n")}` : line;
}

function describeDockGroup(label: string, entries: DockEntryView[]): string {
  if (entries.length === 0) return `  ${label}: —`;
  const rendered = entries.map((entry) =>
    entry.openWindows > 0 ? `${entry.name} (${entry.openWindows})` : entry.name,
  );
  return `  ${label}: ${rendered.join(", ")}`;
}

export interface SerializeOptions {
  /**
   * Include the app catalogue.
   *
   * True for a deliberate read, false for the state returned after a batch —
   * the library does not change while the agent works, and repeating it on
   * every action is what turns a long session into an expensive one.
   */
  includeCatalog?: boolean;
}

/**
 * Render a snapshot as the compact text the model receives.
 *
 * Text rather than JSON because it is read far more often than it is parsed,
 * and because braces and quoting cost tokens that carry no meaning here.
 *
 * Internal window ids never appear. The agent gets exactly one way to name a
 * window, so there is exactly one thing to validate.
 */
export function serializeSnapshot(
  snapshot: DesktopSnapshot,
  options: SerializeOptions = {},
): string {
  const { includeCatalog = false } = options;
  const lines: string[] = [];

  lines.push(
    `DESKTOP  epoch=${snapshot.epoch}  mode=${snapshot.mode}  viewport=${snapshot.viewport.width}x${snapshot.viewport.height}`,
  );

  lines.push("");
  if (snapshot.windows.length === 0) {
    lines.push("WINDOWS (0) — the desktop is empty");
  } else {
    lines.push(`WINDOWS (${snapshot.windows.length})`);
    for (const window of snapshot.windows) {
      // The diff marker is a suffix rather than a prefix so the handle stays in
      // the first column and the list reads as a column of addresses.
      const mark =
        window.diff === "new" ? "  *new" : window.diff === "changed" ? "  ~changed" : "";
      lines.push(`  ${describeWindow(window)}${mark}`);
    }
  }

  lines.push("");
  lines.push("DOCK");
  lines.push(describeDockGroup("system", snapshot.dock.system));
  lines.push(describeDockGroup("pinned", snapshot.dock.pinned));
  lines.push(describeDockGroup("running", snapshot.dock.running));

  if (includeCatalog) {
    lines.push("");
    lines.push(`APPS YOU CAN OPEN (${snapshot.catalog.length})`);
    for (const app of snapshot.catalog) {
      const description = app.description?.trim();
      lines.push(
        description
          ? `  ${app.appId} — ${truncate(description, 110)}`
          : `  ${app.appId}`,
      );
    }
  }

  return lines.join("\n");
}

/** Clip at a word boundary so a truncated description still reads as English. */
function truncate(value: string, max: number): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  const clipped = collapsed.slice(0, max);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, lastSpace > max * 0.6 ? lastSpace : max)}…`;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/** Why a step could not be run, in terms the model can act on. */
export type ResolutionError =
  | { kind: "unknown-handle"; handle: number; message: string }
  | { kind: "unknown-app"; appId: string; message: string }
  | { kind: "not-permitted"; verb: DesktopVerb; mode: OsAgentMode; message: string };

/**
 * Resolve a handle against a snapshot.
 *
 * Returns a structured error rather than throwing, because a hallucinated
 * handle is an ordinary thing for a model to produce and an ordinary thing to
 * recover from — it should cost one corrected step, not a failed run. The
 * message names the handles that *do* exist, since the fix is almost always to
 * pick one of them.
 */
export function resolveHandle(
  snapshot: DesktopSnapshot,
  handle: number,
): WindowView | ResolutionError {
  const window = snapshot.windows.find((w) => w.handle === handle);
  if (window) return window;

  const available = snapshot.windows.map((w) => `[${w.handle}]`).join(", ");
  return {
    kind: "unknown-handle",
    handle,
    message:
      snapshot.windows.length === 0
        ? `No window [${handle}] — the desktop is empty. Open an app first.`
        : `No window [${handle}]. Open windows are ${available}.`,
  };
}

/** Narrow a resolution result. */
export function isResolutionError(
  value: WindowView | ResolutionError,
): value is ResolutionError {
  return "kind" in value;
}
