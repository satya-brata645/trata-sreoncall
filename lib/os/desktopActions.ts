/**
 * Deciding what a step should do — the pure half of the executor.
 *
 * Planning and performing are split on purpose. Everything here is a pure
 * function from (snapshot, step, mode) to an **effect** describing what to ask
 * the window manager for, plus the outcome to report. The controller performs
 * the effects and is the only part that touches React.
 *
 * That split is what makes the awkward parts testable: idempotency, mode
 * refusals, unknown handles, and the rule about which steps may be chained are
 * all decided here, in `node --test`, with no browser.
 */

import {
  isResolutionError,
  permissionFor,
  resolveHandle,
  terminatesBatch,
  VERB_TABLE,
  type DesktopBatch,
  type DesktopSnapshot,
  type DesktopStep,
  type OsAgentMode,
  type StepOutcome,
  type WindowView,
} from "./agentProtocol";
import type { OsRect, OsSnapPreset } from "./geometry";

/**
 * A request to the window manager.
 *
 * Named for the window manager's own methods so the controller is a switch with
 * no logic in it — every decision has already been made by the time an effect
 * exists.
 */
export type DesktopEffect =
  | { kind: "openApp"; appId: string; params?: Record<string, string>; title?: string }
  | { kind: "closeWindow"; windowId: string }
  | { kind: "focusWindow"; windowId: string }
  | { kind: "minimizeWindow"; windowId: string }
  | { kind: "restoreWindow"; windowId: string }
  | { kind: "snapWindow"; windowId: string; preset: OsSnapPreset }
  | { kind: "setGeometry"; windowId: string; rect: OsRect }
  | { kind: "setPinned"; appId: string; name: string; pinned: boolean }
  | { kind: "setParams"; windowId: string; params: Record<string, string> };

export interface PlannedStep {
  outcome: StepOutcome;
  /** Absent when nothing should happen — a noop, a refusal, or an error. */
  effect?: DesktopEffect;
  /**
   * Whether the window set changes, so every handle after this is suspect.
   *
   * Computed rather than read off the verb, because `open_app` for something
   * already open only focuses it — the set is untouched and there is no reason
   * to spend a round-trip re-reading.
   */
  endsBatch: boolean;
}

/** What the planner needs to know beyond the snapshot itself. */
export interface PlanContext {
  /** The registry ids of the OS's own apps — anything else is a security app. */
  osAppIds: ReadonlySet<string>;
  /** The registry id every security app opens into. */
  securityAppId: string;
  /** Apps currently kept in the dock, so pin/unpin can be idempotent. */
  pinnedAppIds: ReadonlySet<string>;
  /**
   * True once the user has approved this batch.
   *
   * The tool layer gates `ask` verbs before they ever reach here; this is the
   * second lock on the same door. A batch that arrives unapproved gets its
   * `ask` verbs refused rather than trusted.
   */
  approved: boolean;
}

function outcome(
  index: number,
  step: DesktopStep,
  status: StepOutcome["status"],
  detail: string,
): StepOutcome {
  return { index, step, status, detail };
}

/** The name to use when talking about a window. */
function label(window: WindowView): string {
  return `${window.title} [${window.handle}]`;
}

/**
 * Plan one step.
 *
 * Order of checks matters: permission before resolution, so a verb the mode
 * forbids is refused for that reason rather than for a handle that happens to
 * also be wrong — the agent should learn the real obstacle first.
 */
export function planStep(
  snapshot: DesktopSnapshot,
  step: DesktopStep,
  mode: OsAgentMode,
  context: PlanContext,
  index = 0,
): PlannedStep {
  const permission = permissionFor(step.verb, mode);

  if (permission === "deny") {
    const spec = VERB_TABLE[step.verb];
    return {
      endsBatch: false,
      outcome: outcome(
        index,
        step,
        "refused",
        spec?.refusal ?? `${step.verb} is not available in ${mode} mode.`,
      ),
    };
  }

  if (permission === "ask" && !context.approved) {
    return {
      endsBatch: false,
      outcome: outcome(
        index,
        step,
        "refused",
        `${step.verb} needs the user's approval and none was given.`,
      ),
    };
  }

  switch (step.verb) {
    case "open_app":
      return planOpenApp(snapshot, step, context, index);
    case "pin_app":
    case "unpin_app":
      return planPin(snapshot, step, context, index);
    default:
      return planWindowStep(snapshot, step, index);
  }
}

function planOpenApp(
  snapshot: DesktopSnapshot,
  step: Extract<DesktopStep, { verb: "open_app" }>,
  context: PlanContext,
  index: number,
): PlannedStep {
  const entry = snapshot.catalog.find((app) => app.appId === step.appId);
  if (!entry) {
    // Naming a few real ids costs nothing and turns a dead end into one
    // corrected step.
    const suggestions = snapshot.catalog
      .slice(0, 6)
      .map((app) => app.appId)
      .join(", ");
    return {
      endsBatch: false,
      outcome: outcome(
        index,
        step,
        "failed",
        `No app called "${step.appId}" is available here. Available ids include: ${suggestions}.`,
      ),
    };
  }

  // An app already open is focused rather than duplicated — by the window
  // manager for singletons, and by params-matching for security apps. Either
  // way the set does not change, so the batch can keep going.
  const existing = snapshot.windows.find((window) => window.appId === step.appId);

  const isOsApp = context.osAppIds.has(step.appId);
  const effect: DesktopEffect = isOsApp
    ? { kind: "openApp", appId: step.appId, title: step.title }
    : {
        kind: "openApp",
        appId: context.securityAppId,
        params: { appId: step.appId },
        title: step.title ?? entry.name,
      };

  return {
    effect,
    endsBatch: !existing,
    outcome: outcome(
      index,
      step,
      "ok",
      existing
        ? `${entry.name} was already open — brought it to the front.`
        : `Opened ${entry.name}.`,
    ),
  };
}

function planPin(
  snapshot: DesktopSnapshot,
  step: Extract<DesktopStep, { verb: "pin_app" | "unpin_app" }>,
  context: PlanContext,
  index: number,
): PlannedStep {
  const wantPinned = step.verb === "pin_app";
  const isPinned = context.pinnedAppIds.has(step.appId);

  if (isPinned === wantPinned) {
    return {
      endsBatch: false,
      outcome: outcome(
        index,
        step,
        "noop",
        `${step.appId} was already ${wantPinned ? "in" : "out of"} the dock.`,
      ),
    };
  }

  const entry = snapshot.catalog.find((app) => app.appId === step.appId);
  if (!entry) {
    return {
      endsBatch: false,
      outcome: outcome(
        index,
        step,
        "failed",
        `No app called "${step.appId}" is available here.`,
      ),
    };
  }

  return {
    effect: {
      kind: "setPinned",
      appId: step.appId,
      name: entry.name,
      pinned: wantPinned,
    },
    endsBatch: false,
    outcome: outcome(
      index,
      step,
      "ok",
      wantPinned
        ? `Kept ${entry.name} in the dock.`
        : `Removed ${entry.name} from the dock.`,
    ),
  };
}

/**
 * The verbs that address an existing window.
 *
 * Every one of them is written as an idempotent *setter*: asking for a state a
 * window is already in reports `noop` and produces no effect. The underlying
 * window manager methods are toggles — `snapWindow` with the active preset
 * un-snaps, `toggleFullScreen` flips — so asking twice without this check would
 * undo the first ask, which is the opposite of what "set it to X" means.
 */
function planWindowStep(
  snapshot: DesktopSnapshot,
  step: Exclude<DesktopStep, { verb: "open_app" | "pin_app" | "unpin_app" }>,
  index: number,
): PlannedStep {
  const resolved = resolveHandle(snapshot, step.handle);
  if (isResolutionError(resolved)) {
    return {
      endsBatch: false,
      outcome: outcome(index, step, "failed", resolved.message),
    };
  }
  const window = resolved;

  switch (step.verb) {
    case "close_window":
      return {
        effect: { kind: "closeWindow", windowId: window.windowId },
        endsBatch: true,
        outcome: outcome(index, step, "ok", `Closed ${label(window)}.`),
      };

    case "focus":
      if (window.isFocused && !window.isMinimized) {
        return {
          endsBatch: false,
          outcome: outcome(index, step, "noop", `${label(window)} was already at the front.`),
        };
      }
      // A minimized window has to be restored rather than merely raised —
      // focusing something invisible looks like nothing happened.
      return {
        effect: window.isMinimized
          ? { kind: "restoreWindow", windowId: window.windowId }
          : { kind: "focusWindow", windowId: window.windowId },
        endsBatch: false,
        outcome: outcome(index, step, "ok", `Brought ${label(window)} to the front.`),
      };

    case "minimize":
      if (window.isMinimized) {
        return {
          endsBatch: false,
          outcome: outcome(index, step, "noop", `${label(window)} was already put away.`),
        };
      }
      return {
        effect: { kind: "minimizeWindow", windowId: window.windowId },
        endsBatch: false,
        outcome: outcome(index, step, "ok", `Put ${label(window)} away.`),
      };

    case "restore":
      if (!window.isMinimized) {
        return {
          endsBatch: false,
          outcome: outcome(index, step, "noop", `${label(window)} was already showing.`),
        };
      }
      return {
        effect: { kind: "restoreWindow", windowId: window.windowId },
        endsBatch: false,
        outcome: outcome(index, step, "ok", `Brought ${label(window)} back.`),
      };

    case "snap":
      if (window.snappedTo === step.preset && !window.isMinimized) {
        return {
          endsBatch: false,
          outcome: outcome(
            index,
            step,
            "noop",
            `${label(window)} was already ${step.preset.replace(/-/g, " ")}.`,
          ),
        };
      }
      return {
        effect: {
          kind: "snapWindow",
          windowId: window.windowId,
          preset: step.preset,
        },
        endsBatch: false,
        outcome: outcome(
          index,
          step,
          "ok",
          `Moved ${label(window)} to ${step.preset.replace(/-/g, " ")}.`,
        ),
      };

    case "set_geometry": {
      const same =
        Math.round(window.rect.x) === Math.round(step.rect.x) &&
        Math.round(window.rect.y) === Math.round(step.rect.y) &&
        Math.round(window.rect.width) === Math.round(step.rect.width) &&
        Math.round(window.rect.height) === Math.round(step.rect.height);
      if (same) {
        return {
          endsBatch: false,
          outcome: outcome(index, step, "noop", `${label(window)} was already there.`),
        };
      }
      return {
        effect: {
          kind: "setGeometry",
          windowId: window.windowId,
          rect: step.rect,
        },
        endsBatch: false,
        outcome: outcome(index, step, "ok", `Resized ${label(window)}.`),
      };
    }

    case "focus_panel": {
      const panels = window.panels ?? [];
      if (panels.length === 0) {
        return {
          endsBatch: false,
          outcome: outcome(
            index,
            step,
            "failed",
            `${label(window)} has no panels to switch between.`,
          ),
        };
      }
      const panel = panels.find((candidate) => candidate.id === step.panel);
      if (!panel) {
        // Naming the real ones turns a dead end into one corrected step.
        const options = panels.map((candidate) => candidate.id).join(", ");
        return {
          endsBatch: false,
          outcome: outcome(
            index,
            step,
            "failed",
            `${label(window)} has no panel "${step.panel}". It has: ${options}.`,
          ),
        };
      }
      // A panel that names a kind of thing is never "already showing" just
      // because the kind matches — chat is on *a* conversation, and being
      // asked for a different one is a real change.
      if (window.activePanel === panel.id && !step.value) {
        return {
          endsBatch: false,
          outcome: outcome(
            index,
            step,
            "noop",
            `${label(window)} was already showing ${panel.label}.`,
          ),
        };
      }
      return {
        effect: {
          kind: "setParams",
          windowId: window.windowId,
          params: step.value
            ? { panel: panel.id, panelValue: step.value }
            : { panel: panel.id },
        },
        endsBatch: false,
        outcome: outcome(
          index,
          step,
          "ok",
          `Switched ${label(window)} to ${panel.label}.`,
        ),
      };
    }

    case "set_affordance": {
      const affordances = window.affordances ?? [];
      if (affordances.length === 0) {
        return {
          endsBatch: false,
          outcome: outcome(
            index,
            step,
            "failed",
            `${label(window)} has no controls you can set.`,
          ),
        };
      }
      const affordance = affordances.find((c) => c.id === step.affordance);
      if (!affordance) {
        // Naming the real ones turns a dead end into one corrected step.
        const options = affordances.map((c) => c.id).join(", ");
        return {
          endsBatch: false,
          outcome: outcome(
            index,
            step,
            "failed",
            `${label(window)} has no control "${step.affordance}". It has: ${options}.`,
          ),
        };
      }
      // A declared option list is the whole point of declaring one: a value
      // outside it is a mistake the agent can fix, not a filter that silently
      // matches nothing and leaves it wondering where the rows went.
      if (
        affordance.options?.length &&
        step.value &&
        !affordance.options.includes(step.value)
      ) {
        return {
          endsBatch: false,
          outcome: outcome(
            index,
            step,
            "failed",
            `"${step.value}" is not one of ${affordance.label}'s options: ${affordance.options.join(", ")}.`,
          ),
        };
      }
      if ((affordance.value ?? "") === step.value) {
        return {
          endsBatch: false,
          outcome: outcome(
            index,
            step,
            "noop",
            step.value
              ? `${label(window)}'s ${affordance.label} was already "${step.value}".`
              : `${label(window)}'s ${affordance.label} was already clear.`,
          ),
        };
      }
      return {
        effect: {
          kind: "setParams",
          windowId: window.windowId,
          params: { [affordance.id]: step.value },
        },
        endsBatch: false,
        outcome: outcome(
          index,
          step,
          "ok",
          step.value
            ? `Set ${label(window)}'s ${affordance.label} to "${step.value}".`
            : `Cleared ${label(window)}'s ${affordance.label}.`,
        ),
      };
    }

    case "full_screen":
      // Unreachable in practice — `permissionFor` denies it in every mode
      // before we get here. Kept explicit so the refusal survives someone
      // loosening the table without reading this file.
      return {
        endsBatch: false,
        outcome: outcome(
          index,
          step,
          "refused",
          VERB_TABLE.full_screen.refusal ?? "Full screen is reserved for the user.",
        ),
      };
  }
}

/** What a planned batch looks like before anything has been performed. */
export interface PlannedBatch {
  /** Set when the whole batch is rejected without running — a stale plan. */
  rejection?: string;
  /** Steps to run, in order. Truncated after the first that changes the set. */
  planned: PlannedStep[];
  /** Steps dropped because an earlier one ended the batch. */
  skipped: StepOutcome[];
}

/**
 * Plan a whole batch.
 *
 * Two of the three guards live here — the epoch check, and truncation after a
 * step that changes the window set. The third (the state actually diverging
 * mid-run, because the user grabbed something) can only be seen while
 * performing, so it lives in the controller.
 *
 * Truncation happens at planning time rather than being discovered at run time
 * because it is knowable: whether a step changes the set is a property of the
 * step and the current snapshot, and the agent is better served by being told
 * up front which of its steps will not be attempted.
 */
export function planBatch(
  snapshot: DesktopSnapshot,
  batch: DesktopBatch,
  mode: OsAgentMode,
  context: PlanContext,
): PlannedBatch {
  if (batch.epoch !== snapshot.epoch) {
    return {
      rejection:
        "The desktop changed since this plan was made, so none of it ran. Here is the current state — plan again from it.",
      planned: [],
      skipped: batch.steps.map((step, index) =>
        outcome(index, step, "skipped", "Not attempted — the plan was stale."),
      ),
    };
  }

  const planned: PlannedStep[] = [];
  const skipped: StepOutcome[] = [];
  let ended = false;

  batch.steps.forEach((step, index) => {
    if (ended) {
      skipped.push(
        outcome(
          index,
          step,
          "skipped",
          "Not attempted — an earlier step changed which windows exist, so the handles after it were no longer reliable.",
        ),
      );
      return;
    }

    const step_ = planStep(snapshot, step, mode, context, index);
    planned.push(step_);
    if (step_.endsBatch) ended = true;
  });

  return { planned, skipped };
}

/**
 * Whether a batch is worth asking the user about.
 *
 * A plan whose every step is a noop or a refusal changes nothing, and putting
 * an approval dialog in front of it teaches the user that approvals are noise.
 */
export function batchNeedsApproval(
  steps: readonly DesktopStep[],
  mode: OsAgentMode,
): boolean {
  return steps.some((step) => permissionFor(step.verb, mode) === "ask");
}

/** Does this batch change which windows exist? Used to decide re-reads. */
export function batchChangesWindowSet(steps: readonly DesktopStep[]): boolean {
  return steps.some((step) => terminatesBatch(step.verb));
}
