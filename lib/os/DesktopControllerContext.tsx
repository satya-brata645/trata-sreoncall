"use client";

/**
 * Performing what the planner decided.
 *
 * The only part of the executor that touches React. Everything it needs to
 * *decide* has already been decided in `desktopActions.ts`; this reads live
 * state, performs effects against the window manager, and enforces the guards
 * that can only be seen while running.
 *
 * Three things here that the pure layer cannot do:
 *
 *  1. **Read back what just happened.** Window state is `useState`, so after
 *     `snapWindow()` the array does not update until React re-renders. Every
 *     step yields a frame before the next one is planned.
 *  2. **Notice the user.** If a window the agent did not touch changes between
 *     two steps, that was a human hand, and the rest of the batch is abandoned.
 *  3. **Stop.** Step budgets, repeated-failure and no-progress detection, and
 *     an immediate abort on any click or keypress.
 *
 * Consumers off the desktop (the legacy authenticated surface mounts the same
 * chat component) get `null` from `useDesktopController` and must degrade to a
 * no-op rather than crash.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  computeEpoch,
  serializeSnapshot,
  type BatchResult,
  type BatchStopReason,
  type DesktopBatch,
  type DesktopSnapshot,
  type StepOutcome,
  type WindowView,
} from "./agentProtocol";
import { planBatch, type DesktopEffect, type PlanContext } from "./desktopActions";
import { buildDesktopSnapshot } from "./desktopState";
import { readViewport, useDesktopSources } from "./useDesktopSources";
import { useAgentMode } from "./agentMode";
import { SECURITY_APP_ID } from "./registry";
import { usePinnedApps } from "./pinnedApps";
import {
  announceAction,
  clearAnnouncements,
  ANNOUNCEMENT_LINGER_MS,
} from "./announcements";
import { useWindowManager } from "./WindowManagerContext";
import type { OsWindowInstance } from "./types";
import type { OsRect } from "./geometry";

/**
 * Ceilings.
 *
 * Deliberately low. These bound how wrong a confused agent can get before a
 * human is back in charge, and a staged view that genuinely needs more than
 * eight moves is a staged view nobody asked for.
 */
const MAX_STEPS_PER_BATCH = 8;
const MAX_CONSECUTIVE_FAILED_BATCHES = 3;

/** How a run ended, for the audit record and for the agent's own report. */
export interface DesktopRunSummary {
  batches: number;
  actions: number;
}

export interface DesktopControllerValue {
  /** The desktop as it stands. Free and local — call it as often as needed. */
  readDesktop: (options?: { includeCatalog?: boolean }) => DesktopSnapshot;
  /** The same, rendered for the model. */
  readDesktopText: (options?: { includeCatalog?: boolean }) => string;
  /** Perform a plan. Never throws; failure arrives as outcomes. */
  runBatch: (
    batch: DesktopBatch,
    options?: { approved?: boolean },
  ) => Promise<BatchResult>;
  /** Put the windows back where they were before the agent started. */
  restoreLayout: () => void;
  /** True while a batch is being performed. Drives the status chip. */
  isDriving: boolean;
  /** Abort the rest of the current batch. Idempotent. */
  interrupt: () => void;
}

const DesktopControllerContext = createContext<DesktopControllerValue | null>(
  null,
);

/**
 * The controller, or `null` when there is no desktop.
 *
 * Returning null rather than throwing is the point: `ChatInterface` mounts on
 * both the desktop and the legacy surface, and the legacy one must keep working
 * with the verbs simply absent.
 */
export function useDesktopController(): DesktopControllerValue | null {
  return useContext(DesktopControllerContext);
}

/** Wait for React to commit and the browser to paint, so a read-back is real. */
function nextFrame(): Promise<void> {
  if (typeof requestAnimationFrame === "undefined") {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  // Two frames: the first lands after React commits, the second after paint —
  // which is also what makes the agent's moves legible one at a time instead of
  // arriving as a single jump.
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

/** The fields that reveal a window was touched by someone other than this step. */
function externalSignature(window: OsWindowInstance): string {
  return [
    Math.round(window.x),
    Math.round(window.y),
    Math.round(window.width),
    Math.round(window.height),
    window.isMinimized ? "m" : "",
    window.isFullScreen ? "f" : "",
    window.snappedTo ?? "",
  ].join(",");
}

function signatureMap(windows: readonly OsWindowInstance[]): Map<string, string> {
  return new Map(windows.map((w) => [w.id, externalSignature(w)]));
}

export function DesktopControllerProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const windowManager = useWindowManager();
  const { pinned, togglePin } = usePinnedApps();
  const sources = useDesktopSources();
  const { mode } = useAgentMode();

  const [isDriving, setIsDriving] = useState(false);

  // Live mirrors of everything the batch runner reads.
  //
  // Synced in an effect rather than during render. That is safe *because* of
  // how the runner reads them: it awaits two animation frames after every step,
  // by which time React has committed and effects have run — so what it sees is
  // the result of the move it just made, which is the whole point of the guard.
  const windowsRef = useRef(windowManager.windows);
  const focusedRef = useRef(windowManager.focusedWindowId);
  const pinnedRef = useRef(pinned);
  const sourcesRef = useRef(sources);
  const modeRef = useRef(mode);

  useEffect(() => {
    windowsRef.current = windowManager.windows;
    focusedRef.current = windowManager.focusedWindowId;
    pinnedRef.current = pinned;
    sourcesRef.current = sources;
    modeRef.current = mode;
  }, [windowManager.windows, windowManager.focusedWindowId, pinned, sources, mode]);

  /** The previous snapshot's windows, so each read can carry its own diff. */
  const previousRef = useRef<readonly WindowView[] | null>(null);
  /** The layout before the agent's first move of this run. */
  const layoutBeforeRef = useRef<OsWindowInstance[] | null>(null);
  /** Set by a user gesture; checked between steps. */
  const abortRef = useRef(false);
  const consecutiveFailuresRef = useRef(0);
  /** Last (verb, target, status) triple, for no-progress detection. */
  const lastSignatureRef = useRef<string | null>(null);

  const snapshotNow = useCallback(
    (options?: { rememberAsPrevious?: boolean }): DesktopSnapshot => {
      const snapshot = buildDesktopSnapshot({
        windows: windowsRef.current,
        focusedWindowId: focusedRef.current,
        pinned: pinnedRef.current,
        osApps: sourcesRef.current.osApps,
        catalog: sourcesRef.current.catalog,
        viewport: readViewport(),
        mode: modeRef.current,
        previous: previousRef.current,
      });
      if (options?.rememberAsPrevious !== false) {
        previousRef.current = snapshot.windows;
      }
      return snapshot;
    },
    [],
  );

  const readDesktop = useCallback(
    () => snapshotNow(),
    [snapshotNow],
  );

  const readDesktopText = useCallback(
    (options?: { includeCatalog?: boolean }) =>
      serializeSnapshot(snapshotNow(), {
        // A deliberate read is where the library belongs; the state returned
        // after a batch omits it, because the catalogue does not change while
        // the agent works and repeating it is what makes a long session costly.
        includeCatalog: options?.includeCatalog ?? true,
      }),
    [snapshotNow],
  );

  const interrupt = useCallback(() => {
    abortRef.current = true;
  }, []);

  // Any real user gesture takes control back. Capture phase so a click on a
  // window's own chrome still counts — the user reaching for the desktop is the
  // signal, not what they happened to hit.
  useEffect(() => {
    if (!isDriving) return;
    const onGesture = () => {
      abortRef.current = true;
    };
    window.addEventListener("pointerdown", onGesture, { capture: true });
    window.addEventListener("keydown", onGesture, { capture: true });
    window.addEventListener("wheel", onGesture, { capture: true, passive: true });
    return () => {
      window.removeEventListener("pointerdown", onGesture, { capture: true });
      window.removeEventListener("keydown", onGesture, { capture: true });
      window.removeEventListener("wheel", onGesture, { capture: true });
    };
  }, [isDriving]);

  /** Ask the window manager for one effect. */
  const perform = useCallback(
    (effect: DesktopEffect) => {
      switch (effect.kind) {
        case "openApp":
          windowManager.openApp(effect.appId, {
            params: effect.params,
            title: effect.title,
          });
          return;
        case "closeWindow":
          windowManager.closeWindow(effect.windowId);
          return;
        case "focusWindow":
          windowManager.focusWindow(effect.windowId);
          return;
        case "minimizeWindow":
          windowManager.minimizeWindow(effect.windowId);
          return;
        case "restoreWindow":
          windowManager.restoreWindow(effect.windowId);
          return;
        case "snapWindow":
          windowManager.snapWindow(effect.windowId, effect.preset);
          return;
        case "setGeometry":
          windowManager.setWindowGeometry(effect.windowId, effect.rect);
          return;
        case "setParams":
          windowManager.setWindowParams(effect.windowId, effect.params);
          return;
        case "setPinned":
          // `togglePin` is the only mutator the pinned store exposes, and the
          // planner has already established the current state differs — so a
          // toggle here is a set.
          togglePin({ id: effect.appId, name: effect.name });
          return;
      }
    },
    [windowManager, togglePin],
  );

  const runBatch = useCallback(
    async (
      batch: DesktopBatch,
      options?: { approved?: boolean },
    ): Promise<BatchResult> => {
      abortRef.current = false;

      const planContext: PlanContext = {
        osAppIds: new Set(sourcesRef.current.osApps.map((app) => app.appId)),
        securityAppId: SECURITY_APP_ID,
        pinnedAppIds: new Set(pinnedRef.current.map((app) => app.id)),
        approved: options?.approved ?? false,
      };

      // Read without remembering: the snapshot the plan is checked against must
      // not become the baseline the *result* is diffed from, or every change
      // the batch makes would read as "unchanged".
      const before = snapshotNow({ rememberAsPrevious: false });

      // Containment, before anything runs. A batch that is too long, or that
      // follows a run of failures, is refused with its reason rather than
      // attempted and abandoned halfway.
      if (batch.steps.length > MAX_STEPS_PER_BATCH) {
        return {
          status: "rejected",
          stopReason: "budget",
          outcomes: batch.steps.map((step, index) => ({
            index,
            step,
            status: "skipped" as const,
            detail: `Not attempted — a plan may contain at most ${MAX_STEPS_PER_BATCH} steps. Send a shorter one.`,
          })),
          snapshot: snapshotNow(),
        };
      }

      if (consecutiveFailuresRef.current >= MAX_CONSECUTIVE_FAILED_BATCHES) {
        return {
          status: "rejected",
          stopReason: "budget",
          outcomes: batch.steps.map((step, index) => ({
            index,
            step,
            status: "skipped" as const,
            detail:
              "Not attempted — several plans in a row failed. Stop and tell the user what is wrong instead of trying again.",
          })),
          snapshot: snapshotNow(),
        };
      }

      const { rejection, planned, skipped } = planBatch(
        before,
        batch,
        modeRef.current,
        planContext,
      );

      if (rejection) {
        // A stale plan is not a failure — the agent did nothing wrong, the
        // world moved. It must not count toward the failure budget.
        return {
          status: "rejected",
          stopReason: "diverged",
          outcomes: skipped,
          snapshot: snapshotNow(),
        };
      }

      setIsDriving(true);
      // First move of a run: remember where everything was, so one action can
      // put it all back.
      if (!layoutBeforeRef.current) {
        layoutBeforeRef.current = [...windowsRef.current];
      }

      const outcomes: StepOutcome[] = [];
      let stopReason: BatchStopReason | undefined;
      let stopIndex = planned.length;

      try {
        for (let i = 0; i < planned.length; i += 1) {
          const step = planned[i];

          if (abortRef.current) {
            stopReason = "interrupted";
            stopIndex = i;
            break;
          }

          // Nothing to do — record it and move on without spending a frame.
          if (!step.effect) {
            outcomes.push(step.outcome);
            // Announced even though nothing moved: "it was already there" and
            // "it was refused" are exactly the outcomes a screen-reader user
            // cannot see, and silence would read as the agent ignoring them.
            announceAction(step.outcome.detail);
            if (step.outcome.status === "failed" || step.outcome.status === "refused") {
              stopReason = step.outcome.status === "failed" ? "failed" : "refused";
              stopIndex = i + 1;
              break;
            }
            continue;
          }

          const targetId =
            "windowId" in step.effect ? step.effect.windowId : undefined;
          const signaturesBefore = signatureMap(windowsRef.current);

          perform(step.effect);
          outcomes.push(step.outcome);
          // The third consumer of `StepOutcome.detail`, per its own doc
          // comment (`agentProtocol.ts`): the model, the audit record, and
          // this. Announced from the loop so it fires once per *action*
          // (`UX-21`) rather than once per render.
          announceAction(step.outcome.detail);

          // Nothing after this can be trusted to mean what it said.
          if (step.endsBatch) {
            stopReason = "set-changed";
            stopIndex = i + 1;
            break;
          }

          await nextFrame();

          // Divergence: did anything the agent did *not* target move? The epoch
          // deliberately ignores geometry, so a drag would slip past it — this
          // compares the untouched windows directly.
          const after = windowsRef.current;
          const diverged =
            after.some((window) => {
              if (window.id === targetId) return false;
              const priorSignature = signaturesBefore.get(window.id);
              return (
                priorSignature !== undefined &&
                priorSignature !== externalSignature(window)
              );
            }) ||
            computeEpoch(
              after.map((w) => ({ id: w.id, appId: w.params?.appId ?? w.appId })),
            ) !== before.epoch;

          if (diverged) {
            stopReason = "diverged";
            stopIndex = i + 1;
            break;
          }
        }
      } finally {
        setIsDriving(false);
      }

      // Everything planned but not reached, plus everything truncated at plan
      // time. Partial results are never discarded — the agent must be able to
      // say exactly how far it got.
      const notReached: StepOutcome[] = planned
        .slice(stopIndex)
        .map((step) => ({
          ...step.outcome,
          status: "skipped" as const,
          detail:
            stopReason === "interrupted"
              ? "Not attempted — the user took control back."
              : stopReason === "diverged"
                ? "Not attempted — the desktop changed underneath the plan."
                : stopReason === "set-changed"
                  ? "Not attempted — an earlier step changed which windows exist."
                  : "Not attempted.",
        }));

      // The run is over. Left set, the last action would sit in the live
      // region and be re-announced as if it had just happened.
      window.setTimeout(clearAnnouncements, ANNOUNCEMENT_LINGER_MS);

      const allOutcomes = [...outcomes, ...notReached, ...skipped].sort(
        (a, b) => a.index - b.index,
      );

      const anyFailed = allOutcomes.some((o) => o.status === "failed");
      const anyProgress = allOutcomes.some((o) => o.status === "ok");
      if (anyFailed && !anyProgress) consecutiveFailuresRef.current += 1;
      else consecutiveFailuresRef.current = 0;

      // No-progress: the same plan producing the same nothing twice in a row is
      // a loop, and the honest move is to stop rather than let it spin.
      const signature = allOutcomes
        .map((o) => `${o.step.verb}:${o.status}`)
        .join("|");
      if (signature === lastSignatureRef.current && !anyProgress) {
        consecutiveFailuresRef.current = MAX_CONSECUTIVE_FAILED_BATCHES;
      }
      lastSignatureRef.current = signature;

      return {
        status: stopReason ? "stopped" : "completed",
        stopReason,
        outcomes: allOutcomes,
        snapshot: snapshotNow(),
      };
    },
    [perform, snapshotNow],
  );

  /**
   * Put the desktop back.
   *
   * Windows the agent closed cannot come back — the app inside was torn down —
   * so this restores position and state for everything that still exists and is
   * honest about the rest by simply not claiming it.
   */
  const restoreLayout = useCallback(() => {
    const before = layoutBeforeRef.current;
    if (!before) return;

    const live = new Set(windowsRef.current.map((w) => w.id));
    for (const window of before) {
      if (!live.has(window.id)) continue;
      const rect: OsRect = {
        x: window.x,
        y: window.y,
        width: window.width,
        height: window.height,
      };
      windowManager.setWindowGeometry(window.id, rect);
      if (window.isMinimized) windowManager.minimizeWindow(window.id);
      else windowManager.restoreWindow(window.id);
    }
    layoutBeforeRef.current = null;
    consecutiveFailuresRef.current = 0;
    lastSignatureRef.current = null;
  }, [windowManager]);

  const value = useMemo<DesktopControllerValue>(
    () => ({
      readDesktop,
      readDesktopText,
      runBatch,
      restoreLayout,
      isDriving,
      interrupt,
    }),
    [readDesktop, readDesktopText, runBatch, restoreLayout, isDriving, interrupt],
  );

  return (
    <DesktopControllerContext.Provider value={value}>
      {children}
    </DesktopControllerContext.Provider>
  );
}
