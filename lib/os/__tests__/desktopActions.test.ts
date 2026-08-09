import { test } from "node:test";
import assert from "node:assert/strict";

import {
  batchChangesWindowSet,
  batchNeedsApproval,
  planBatch,
  planStep,
  type PlanContext,
} from "../desktopActions";
import { buildDesktopSnapshot, type OsAppDescriptor } from "../desktopState";
import { VERB_TABLE } from "../agentProtocol";
import type { DesktopSnapshot, DesktopStep, OsAgentMode } from "../agentProtocol";
import type { OsWindowInstance } from "../types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OS_APPS: OsAppDescriptor[] = [
  { appId: "chat", title: "Chat", description: "Talk to the agent." },
  { appId: "files", title: "Files", description: "Reports and evidence." },
];

const CONTEXT: PlanContext = {
  osAppIds: new Set(["chat", "files"]),
  securityAppId: "security-app",
  pinnedAppIds: new Set(),
  approved: true,
};

function osWindow(
  overrides: Partial<OsWindowInstance> & { id: string; appId: string },
): OsWindowInstance {
  return {
    x: 0,
    y: 0,
    width: 800,
    height: 600,
    z: 10,
    isMinimized: false,
    isFullScreen: false,
    ...overrides,
  };
}

function desktop(
  windows: OsWindowInstance[] = [],
  focusedWindowId: string | null = null,
): DesktopSnapshot {
  return buildDesktopSnapshot({
    windows,
    focusedWindowId,
    pinned: [],
    osApps: OS_APPS,
    catalog: [
      { appId: "chat", name: "Chat" },
      { appId: "files", name: "Files" },
      { appId: "pentest", name: "Pentest" },
    ],
    viewport: { width: 1512, height: 789 },
    mode: "collab",
    previous: null,
  });
}

function plan(
  snapshot: DesktopSnapshot,
  step: DesktopStep,
  mode: OsAgentMode = "collab",
  context: Partial<PlanContext> = {},
) {
  return planStep(snapshot, step, mode, { ...CONTEXT, ...context });
}

// ---------------------------------------------------------------------------
// Mode gating
// ---------------------------------------------------------------------------

test("self refuses every verb", () => {
  const result = plan(desktop(), { verb: "open_app", appId: "chat" }, "self");
  assert.equal(result.outcome.status, "refused");
  assert.equal(result.effect, undefined);
});

test("collab performs opens without approval", () => {
  const result = plan(
    desktop(),
    { verb: "open_app", appId: "chat" },
    "collab",
    { approved: false },
  );
  assert.equal(result.outcome.status, "ok");
  assert.ok(result.effect);
});

test("collab refuses an INSIDE-app write when approval was never given", () => {
  // The tool layer gates this first; the executor is the second lock on the
  // same door, so an unapproved batch reaching it still cannot write.
  //
  // Uses `focus_panel`, not `snap`: window arrangement no longer asks in
  // collab, so snapping would be allowed here and the test would prove
  // nothing. What is still gated is reaching inside an app.
  const state = withPanels("config");
  const result = plan(
    state,
    { verb: "focus_panel", handle: 1, panel: "memory" },
    "collab",
    { approved: false },
  );
  assert.equal(result.outcome.status, "refused");
  assert.equal(result.effect, undefined);
});

test("auto performs writes with no approval at all", () => {
  const state = desktop([osWindow({ id: "w1", appId: "chat" })]);
  const result = plan(
    state,
    { verb: "snap", handle: 1, preset: "left-half" },
    "auto",
    { approved: false },
  );
  assert.equal(result.outcome.status, "ok");
  assert.ok(result.effect);
});

test("full screen is refused even in auto, and says what to use instead", () => {
  const state = desktop([osWindow({ id: "w1", appId: "chat" })]);
  const result = plan(state, { verb: "full_screen", handle: 1, on: true }, "auto");
  assert.equal(result.outcome.status, "refused");
  assert.match(result.outcome.detail, /fill/);
  assert.equal(result.effect, undefined);
});

// ---------------------------------------------------------------------------
// Idempotency — every verb is a setter, not a toggle
// ---------------------------------------------------------------------------

test("snapping a window to where it already is does nothing", () => {
  // `snapWindow` un-snaps when re-applied, so without this check asking twice
  // would undo the first ask.
  const state = desktop([
    osWindow({ id: "w1", appId: "chat", snappedTo: "left-half" }),
  ]);
  const result = plan(state, { verb: "snap", handle: 1, preset: "left-half" }, "auto");
  assert.equal(result.outcome.status, "noop");
  assert.equal(result.effect, undefined);
});

test("snapping to a different arrangement does move it", () => {
  const state = desktop([
    osWindow({ id: "w1", appId: "chat", snappedTo: "left-half" }),
  ]);
  const result = plan(state, { verb: "snap", handle: 1, preset: "right-half" }, "auto");
  assert.equal(result.outcome.status, "ok");
  assert.deepEqual(result.effect, {
    kind: "snapWindow",
    windowId: "w1",
    preset: "right-half",
  });
});

test("minimizing an already-minimized window does nothing", () => {
  const state = desktop([osWindow({ id: "w1", appId: "chat", isMinimized: true })]);
  const result = plan(state, { verb: "minimize", handle: 1 }, "auto");
  assert.equal(result.outcome.status, "noop");
});

test("restoring a window that is not minimized does nothing", () => {
  const state = desktop([osWindow({ id: "w1", appId: "chat" })]);
  const result = plan(state, { verb: "restore", handle: 1 }, "auto");
  assert.equal(result.outcome.status, "noop");
});

test("focusing the front window does nothing", () => {
  const state = desktop([osWindow({ id: "w1", appId: "chat" })], "w1");
  const result = plan(state, { verb: "focus", handle: 1 }, "auto");
  assert.equal(result.outcome.status, "noop");
});

test("focusing a minimized window restores it rather than raising something invisible", () => {
  const state = desktop([osWindow({ id: "w1", appId: "chat", isMinimized: true })]);
  const result = plan(state, { verb: "focus", handle: 1 }, "auto");
  assert.equal(result.outcome.status, "ok");
  assert.deepEqual(result.effect, { kind: "restoreWindow", windowId: "w1" });
});

test("setting the geometry a window already has does nothing", () => {
  const state = desktop([
    osWindow({ id: "w1", appId: "chat", x: 10, y: 20, width: 300, height: 400 }),
  ]);
  const result = plan(
    state,
    { verb: "set_geometry", handle: 1, rect: { x: 10, y: 20, width: 300, height: 400 } },
    "auto",
  );
  assert.equal(result.outcome.status, "noop");
});

test("pinning an app that is already pinned does nothing", () => {
  const result = plan(
    desktop(),
    { verb: "pin_app", appId: "pentest" },
    "auto",
    { pinnedAppIds: new Set(["pentest"]) },
  );
  assert.equal(result.outcome.status, "noop");
});

test("unpinning an app that was never pinned does nothing", () => {
  const result = plan(desktop(), { verb: "unpin_app", appId: "pentest" }, "auto");
  assert.equal(result.outcome.status, "noop");
});

// ---------------------------------------------------------------------------
// Opening
// ---------------------------------------------------------------------------

test("opening an OS app goes straight to its registry id", () => {
  const result = plan(desktop(), { verb: "open_app", appId: "files" }, "auto");
  assert.deepEqual(result.effect, {
    kind: "openApp",
    appId: "files",
    title: undefined,
  });
});

test("opening a security app routes through the shared host with its project param", () => {
  const result = plan(desktop(), { verb: "open_app", appId: "pentest" }, "auto");
  assert.deepEqual(result.effect, {
    kind: "openApp",
    appId: "security-app",
    params: { appId: "pentest" },
    title: "Pentest",
  });
});

test("opening an unknown app fails recoverably and names real ids", () => {
  const result = plan(desktop(), { verb: "open_app", appId: "not-real" }, "auto");
  assert.equal(result.outcome.status, "failed");
  assert.match(result.outcome.detail, /chat/);
  assert.equal(result.effect, undefined);
});

test("opening ends the batch only when it actually adds a window", () => {
  // A fresh open changes the set, so everything after it is re-planned...
  assert.equal(
    plan(desktop(), { verb: "open_app", appId: "chat" }, "auto").endsBatch,
    true,
  );
  // ...but re-opening something already there only focuses it, and spending a
  // round-trip to rediscover that would be waste.
  const open = desktop([osWindow({ id: "w1", appId: "chat" })]);
  const result = plan(open, { verb: "open_app", appId: "chat" }, "auto");
  assert.equal(result.endsBatch, false);
  assert.match(result.outcome.detail, /already open/);
});

// ---------------------------------------------------------------------------
// Handles
// ---------------------------------------------------------------------------

test("a hallucinated handle fails recoverably and names the real ones", () => {
  const state = desktop([
    osWindow({ id: "w1", appId: "chat" }),
    osWindow({ id: "w2", appId: "files" }),
  ]);
  const result = plan(state, { verb: "minimize", handle: 7 }, "auto");
  assert.equal(result.outcome.status, "failed");
  assert.match(result.outcome.detail, /\[1\], \[2\]/);
  assert.equal(result.effect, undefined);
});

test("mode refusal is reported before a bad handle, so the real obstacle comes first", () => {
  const result = plan(desktop(), { verb: "minimize", handle: 99 }, "self");
  assert.equal(result.outcome.status, "refused");
  assert.match(result.outcome.detail, /self/);
});

// ---------------------------------------------------------------------------
// Batching
// ---------------------------------------------------------------------------

test("a batch planned against a stale desktop is rejected whole", () => {
  const state = desktop([osWindow({ id: "w1", appId: "chat" })]);
  const result = planBatch(
    state,
    {
      epoch: "stale000",
      steps: [
        { verb: "snap", handle: 1, preset: "left-half" },
        { verb: "minimize", handle: 1 },
      ],
    },
    "auto",
    CONTEXT,
  );
  assert.ok(result.rejection);
  assert.equal(result.planned.length, 0);
  assert.equal(result.skipped.length, 2);
  assert.ok(result.skipped.every((s) => s.status === "skipped"));
});

test("a batch truncates after a step that changes which windows exist", () => {
  const state = desktop([osWindow({ id: "w1", appId: "chat" })]);
  const result = planBatch(
    state,
    {
      epoch: state.epoch,
      steps: [
        { verb: "snap", handle: 1, preset: "left-half" },
        { verb: "open_app", appId: "files" },
        { verb: "snap", handle: 2, preset: "right-half" },
      ],
    },
    "auto",
    CONTEXT,
  );
  assert.equal(result.planned.length, 2);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].index, 2);
  assert.match(result.skipped[0].detail, /no longer reliable/);
});

test("a batch of pure state changes runs end to end", () => {
  const state = desktop([
    osWindow({ id: "w1", appId: "chat" }),
    osWindow({ id: "w2", appId: "files" }),
  ]);
  const result = planBatch(
    state,
    {
      epoch: state.epoch,
      steps: [
        { verb: "snap", handle: 1, preset: "left-half" },
        { verb: "snap", handle: 2, preset: "right-half" },
        { verb: "focus", handle: 1 },
      ],
    },
    "auto",
    CONTEXT,
  );
  assert.equal(result.planned.length, 3);
  assert.equal(result.skipped.length, 0);
  assert.ok(result.planned.every((step) => step.outcome.status === "ok"));
});

test("re-opening something already open does not truncate the batch", () => {
  const state = desktop([osWindow({ id: "w1", appId: "chat" })]);
  const result = planBatch(
    state,
    {
      epoch: state.epoch,
      steps: [
        { verb: "open_app", appId: "chat" },
        { verb: "snap", handle: 1, preset: "left-half" },
      ],
    },
    "auto",
    CONTEXT,
  );
  assert.equal(result.planned.length, 2);
  assert.equal(result.skipped.length, 0);
});

test("outcomes carry their position, so partial results are unambiguous", () => {
  const state = desktop([osWindow({ id: "w1", appId: "chat" })]);
  const result = planBatch(
    state,
    {
      epoch: state.epoch,
      steps: [
        { verb: "focus", handle: 1 },
        { verb: "open_app", appId: "files" },
        { verb: "minimize", handle: 1 },
      ],
    },
    "auto",
    CONTEXT,
  );
  assert.deepEqual(
    [...result.planned.map((p) => p.outcome.index), ...result.skipped.map((s) => s.index)],
    [0, 1, 2],
  );
});

// ---------------------------------------------------------------------------
// Approval shape
// ---------------------------------------------------------------------------

test("a batch of opens needs no approval in collab", () => {
  assert.equal(
    batchNeedsApproval(
      [
        { verb: "open_app", appId: "chat" },
        { verb: "focus", handle: 1 },
      ],
      "collab",
    ),
    false,
  );
});

test("one INSIDE-app step makes the whole batch need approval", () => {
  // One plan, one prompt. A batch of pure window arrangement goes through
  // untouched now; it is the step that reaches inside an app that raises the
  // single approval for the whole thing.
  assert.equal(
    batchNeedsApproval(
      [
        { verb: "open_app", appId: "chat" },
        { verb: "snap", handle: 1, preset: "left-half" },
        { verb: "focus_panel", handle: 1, panel: "memory" },
      ],
      "collab",
    ),
    true,
  );
  assert.equal(
    batchNeedsApproval(
      [
        { verb: "open_app", appId: "chat" },
        { verb: "snap", handle: 1, preset: "left-half" },
      ],
      "collab",
    ),
    false,
    "arranging windows must not raise a prompt",
  );
});

test("nothing needs approval in auto", () => {
  assert.equal(
    batchNeedsApproval([{ verb: "close_window", handle: 1 }], "auto"),
    false,
  );
});

test("batchChangesWindowSet spots opens and closes", () => {
  assert.equal(batchChangesWindowSet([{ verb: "open_app", appId: "chat" }]), true);
  assert.equal(batchChangesWindowSet([{ verb: "close_window", handle: 1 }]), true);
  assert.equal(
    batchChangesWindowSet([{ verb: "snap", handle: 1, preset: "fill" }]),
    false,
  );
});

// ---------------------------------------------------------------------------
// Inside an app
// ---------------------------------------------------------------------------

/** A desktop with one window whose app declares panels. */
function withPanels(activePanel?: string): DesktopSnapshot {
  const base = desktop([
    osWindow({
      id: "w1",
      appId: "brain",
      ...(activePanel ? { params: { panel: activePanel } } : {}),
    }),
  ]);
  return {
    ...base,
    windows: base.windows.map((window) => ({
      ...window,
      title: "Brain",
      panels: [
        { id: "config", label: "Config" },
        { id: "memory", label: "Memory" },
        { id: "cortex", label: "Cortex" },
      ],
      activePanel,
    })),
  };
}

test("focus_panel switches which part of an app is showing", () => {
  const result = plan(
    withPanels("config"),
    { verb: "focus_panel", handle: 1, panel: "memory" },
    "auto",
  );
  assert.equal(result.outcome.status, "ok");
  assert.deepEqual(result.effect, {
    kind: "setParams",
    windowId: "w1",
    params: { panel: "memory" },
  });
});

test("focus_panel is idempotent like every other setter", () => {
  const result = plan(
    withPanels("memory"),
    { verb: "focus_panel", handle: 1, panel: "memory" },
    "auto",
  );
  assert.equal(result.outcome.status, "noop");
  assert.equal(result.effect, undefined);
});

test("an unknown panel fails recoverably and names the real ones", () => {
  const result = plan(
    withPanels("config"),
    { verb: "focus_panel", handle: 1, panel: "nonsense" },
    "auto",
  );
  assert.equal(result.outcome.status, "failed");
  assert.match(result.outcome.detail, /config, memory, cortex/);
  assert.equal(result.effect, undefined);
});

test("an app with no panels says so rather than failing obscurely", () => {
  const state = desktop([osWindow({ id: "w1", appId: "files" })]);
  const result = plan(
    state,
    { verb: "focus_panel", handle: 1, panel: "memory" },
    "auto",
  );
  assert.equal(result.outcome.status, "failed");
  assert.match(result.outcome.detail, /no panels/);
});

test("focus_panel does not end a batch — the window set is untouched", () => {
  // It changes what a window shows, not which windows exist, so handles after
  // it stay valid and it chains freely with arrangement.
  const result = plan(
    withPanels("config"),
    { verb: "focus_panel", handle: 1, panel: "memory" },
    "auto",
  );
  assert.equal(result.endsBatch, false);
});

test("focus_panel asks before acting in collab", () => {
  // It changes what the user is looking at, so it is a write like any other.
  const result = plan(
    withPanels("config"),
    { verb: "focus_panel", handle: 1, panel: "memory" },
    "collab",
    { approved: false },
  );
  assert.equal(result.outcome.status, "refused");
});

// ---------------------------------------------------------------------------
// set_affordance — setting a control inside a window (Stage 9.4)
//
// The adversarial set Part I applies to windows, re-run one level in:
// unknown id, stale/idempotent, and a value the control does not accept. Each
// must be a recoverable error the model can fix in one step, never a throw and
// never a silent miss.
// ---------------------------------------------------------------------------

/** A desktop with one window whose app declares controls. */
function withControls(values: Record<string, string> = {}): DesktopSnapshot {
  const base = desktop([osWindow({ id: "w1", appId: "apps", params: values })]);
  return {
    ...base,
    windows: base.windows.map((window) => ({
      ...window,
      title: "Apps",
      affordances: [
        { id: "search", label: "Search", kind: "search" as const, value: values.search },
        {
          id: "severity",
          label: "Severity",
          kind: "filter" as const,
          options: ["critical", "high"],
          value: values.severity,
        },
      ],
    })),
  };
}

test("set_affordance sets a control", () => {
  const result = plan(
    withControls(),
    { verb: "set_affordance", handle: 1, affordance: "search", value: "pentest" },
    "auto",
  );
  assert.equal(result.outcome.status, "ok");
  assert.deepEqual(result.effect, {
    kind: "setParams",
    windowId: "w1",
    params: { search: "pentest" },
  });
});

test("an empty value clears the control", () => {
  const result = plan(
    withControls({ search: "pentest" }),
    { verb: "set_affordance", handle: 1, affordance: "search", value: "" },
    "auto",
  );
  assert.equal(result.outcome.status, "ok");
  assert.match(result.outcome.detail, /Cleared/);
});

test("setting a control to what it already is, is a no-op", () => {
  // Same idempotency contract as every other setter (D6) — an agent that
  // re-sends its own state must not be told it changed something.
  const result = plan(
    withControls({ search: "pentest" }),
    { verb: "set_affordance", handle: 1, affordance: "search", value: "pentest" },
    "auto",
  );
  assert.equal(result.outcome.status, "noop");
  assert.equal(result.effect, undefined);
});

test("an unknown control fails recoverably and names the real ones", () => {
  const result = plan(
    withControls(),
    { verb: "set_affordance", handle: 1, affordance: "nonsense", value: "x" },
    "auto",
  );
  assert.equal(result.outcome.status, "failed");
  assert.match(result.outcome.detail, /search/);
  assert.match(result.outcome.detail, /severity/);
  assert.equal(result.effect, undefined);
});

test("a value outside a filter's options is refused, not silently applied", () => {
  // Applying it would filter to nothing and leave the agent wondering where
  // the rows went — a dead end instead of one corrected step.
  const result = plan(
    withControls(),
    { verb: "set_affordance", handle: 1, affordance: "severity", value: "spicy" },
    "auto",
  );
  assert.equal(result.outcome.status, "failed");
  assert.match(result.outcome.detail, /critical, high/);
  assert.equal(result.effect, undefined);
});

test("a free-text control accepts anything", () => {
  const result = plan(
    withControls(),
    { verb: "set_affordance", handle: 1, affordance: "search", value: "anything at all" },
    "auto",
  );
  assert.equal(result.outcome.status, "ok");
});

test("a window with no controls says so rather than throwing", () => {
  const result = plan(
    desktop([osWindow({ id: "w1", appId: "chat" })]),
    { verb: "set_affordance", handle: 1, affordance: "search", value: "x" },
    "auto",
  );
  assert.equal(result.outcome.status, "failed");
  assert.equal(result.effect, undefined);
});

test("set_affordance does not end a batch", () => {
  // It is a `state` verb: which windows exist does not change, so the rest of
  // the plan is still addressable. That answer is only available because
  // affordances are declared — see os-agent-control.md §12.1.
  const result = plan(
    withControls(),
    { verb: "set_affordance", handle: 1, affordance: "search", value: "x" },
    "auto",
  );
  assert.equal(result.endsBatch, false);
});

test("set_affordance is refused in Self and asks in Collab", () => {
  // Narrowing a list changes what the user is looking at, and what a screen
  // shows is what a person acts on — "it only filters" is not a reason to
  // skip consent.
  assert.equal(VERB_TABLE.set_affordance.permissions.self, "deny");
  assert.equal(VERB_TABLE.set_affordance.permissions.collab, "ask");
  assert.equal(VERB_TABLE.set_affordance.permissions.auto, "allow");
});
