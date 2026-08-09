import { test } from "node:test";
import assert from "node:assert/strict";

import {
  allocateHandles,
  clampMode,
  computeEpoch,
  describeWindow,
  markDiff,
  permissionFor,
  resolveHandle,
  isResolutionError,
  serializeSnapshot,
  terminatesBatch,
  verbsForMode,
  type DesktopSnapshot,
  type WindowView,
} from "../agentProtocol";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function win(overrides: Partial<WindowView> & { handle: number; windowId: string }): WindowView {
  return {
    appId: "chat",
    title: "Chat",
    rect: { x: 0, y: 0, width: 800, height: 600 },
    isFocused: false,
    isMinimized: false,
    isFullScreen: false,
    diff: "unchanged",
    ...overrides,
  };
}

function snapshot(windows: WindowView[]): DesktopSnapshot {
  return {
    epoch: computeEpoch(windows.map((w) => ({ id: w.windowId, appId: w.appId }))),
    mode: "collab",
    viewport: { width: 1512, height: 789 },
    windows,
    dock: { system: [], pinned: [], running: [] },
    catalog: [],
  };
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

test("clampMode: a request above the ceiling is clamped to it", () => {
  assert.equal(clampMode("auto", "collab"), "collab");
  assert.equal(clampMode("collab", "self"), "self");
  assert.equal(clampMode("auto", "self"), "self");
});

test("clampMode: a request at or below the ceiling is honoured", () => {
  assert.equal(clampMode("collab", "auto"), "collab");
  assert.equal(clampMode("self", "auto"), "self");
  assert.equal(clampMode("auto", "auto"), "auto");
});

// ---------------------------------------------------------------------------
// Verb table
// ---------------------------------------------------------------------------

test("verbsForMode: self offers nothing, so the tools can be omitted entirely", () => {
  assert.deepEqual(verbsForMode("self"), []);
});

test("verbsForMode: collab offers every verb except the forbidden one", () => {
  const verbs = verbsForMode("collab");
  assert.ok(verbs.includes("open_app"));
  assert.ok(verbs.includes("close_window"));
  assert.ok(!verbs.includes("full_screen"));
});

test("permissionFor: collab arranges windows freely and asks only to reach inside", () => {
  // The consent boundary moved. Asking to move a window is not collaboration,
  // it is a permission dialog with extra steps — and a staging request that
  // stops for a click is the opposite of someone arranging your screen while
  // you keep working. What still asks is reaching INSIDE an app, because that
  // changes what you are working in rather than where the frame sits.
  for (const verb of [
    "open_app",
    "focus",
    "restore",
    "snap",
    "minimize",
    "set_geometry",
    "pin_app",
    "unpin_app",
    "close_window",
  ] as const) {
    assert.equal(permissionFor(verb, "collab"), "allow", `${verb} must not ask`);
  }
  assert.equal(permissionFor("focus_panel", "collab"), "ask");
  assert.equal(permissionFor("set_affordance", "collab"), "ask");
});

test("permissionFor: auto asks for nothing", () => {
  for (const verb of verbsForMode("auto")) {
    assert.equal(permissionFor(verb, "auto"), "allow", `${verb} should not ask in auto`);
  }
});

test("permissionFor: full screen is denied in every mode, auto included", () => {
  assert.equal(permissionFor("full_screen", "self"), "deny");
  assert.equal(permissionFor("full_screen", "collab"), "deny");
  assert.equal(permissionFor("full_screen", "auto"), "deny");
});

test("terminatesBatch: exactly the verbs that change which windows exist", () => {
  assert.equal(terminatesBatch("open_app"), true);
  assert.equal(terminatesBatch("close_window"), true);
  assert.equal(terminatesBatch("snap"), false);
  assert.equal(terminatesBatch("focus"), false);
  assert.equal(terminatesBatch("minimize"), false);
  assert.equal(terminatesBatch("set_geometry"), false);
});

// ---------------------------------------------------------------------------
// Epoch
// ---------------------------------------------------------------------------

test("computeEpoch: stable for the same window set", () => {
  const windows = [
    { id: "w1", appId: "chat" },
    { id: "w2", appId: "security-app" },
  ];
  assert.equal(computeEpoch(windows), computeEpoch([...windows]));
});

test("computeEpoch: changes when a window is added or removed", () => {
  const base = [{ id: "w1", appId: "chat" }];
  const added = [...base, { id: "w2", appId: "files" }];
  assert.notEqual(computeEpoch(base), computeEpoch(added));
  assert.notEqual(computeEpoch(added), computeEpoch([]));
});

test("computeEpoch: ignores geometry — a moved window is the same window", () => {
  // The epoch is computed from ids and hosts only, so a plan that says
  // "snap [2] left" survives the user nudging [2] in the meantime.
  const before = [{ id: "w1", appId: "chat" }];
  const after = [{ id: "w1", appId: "chat" }];
  assert.equal(computeEpoch(before), computeEpoch(after));
});

test("computeEpoch: returns to its previous value when the set does", () => {
  // A counter would have advanced twice here and would wrongly reject a plan
  // whose handles still resolve to exactly the same windows.
  const base = [{ id: "w1", appId: "chat" }];
  const opened = [...base, { id: "w2", appId: "files" }];
  assert.notEqual(computeEpoch(base), computeEpoch(opened));
  assert.equal(computeEpoch(base), computeEpoch([{ id: "w1", appId: "chat" }]));
});

// ---------------------------------------------------------------------------
// Handles
// ---------------------------------------------------------------------------

test("allocateHandles: 1-based, in creation order", () => {
  const handles = allocateHandles([{ id: "a" }, { id: "b" }, { id: "c" }]);
  assert.equal(handles.get("a"), 1);
  assert.equal(handles.get("b"), 2);
  assert.equal(handles.get("c"), 3);
});

test("allocateHandles: deterministic — the same desktop always serialises the same", () => {
  const windows = [{ id: "a" }, { id: "b" }];
  assert.deepEqual([...allocateHandles(windows)], [...allocateHandles(windows)]);
});

test("allocateHandles: focus order cannot renumber handles", () => {
  // The window manager only mutates `z` on focus, never array order — so a
  // handle the agent is holding survives the user clicking around.
  const windows = [{ id: "a" }, { id: "b" }];
  const before = allocateHandles(windows);
  const after = allocateHandles(windows);
  assert.equal(before.get("b"), after.get("b"));
});

// ---------------------------------------------------------------------------
// Diff marking
// ---------------------------------------------------------------------------

test("markDiff: the first read describes the world rather than reporting changes", () => {
  const marked = markDiff([win({ handle: 1, windowId: "w1" })], null);
  assert.equal(marked[0].diff, "unchanged");
});

test("markDiff: a window that was not there before is new", () => {
  const previous = [win({ handle: 1, windowId: "w1" })];
  const current = [
    win({ handle: 1, windowId: "w1" }),
    win({ handle: 2, windowId: "w2", appId: "files", title: "Files" }),
  ];
  const marked = markDiff(current, previous);
  assert.equal(marked[0].diff, "unchanged");
  assert.equal(marked[1].diff, "new");
});

test("markDiff: a moved or re-snapped window is changed", () => {
  const previous = [win({ handle: 1, windowId: "w1" })];
  const current = [win({ handle: 1, windowId: "w1", snappedTo: "left-half" })];
  assert.equal(markDiff(current, previous)[0].diff, "changed");
});

test("markDiff: minimizing shows as a change", () => {
  const previous = [win({ handle: 1, windowId: "w1" })];
  const current = [win({ handle: 1, windowId: "w1", isMinimized: true })];
  assert.equal(markDiff(current, previous)[0].diff, "changed");
});

test("markDiff: an untouched window stays unchanged", () => {
  const previous = [win({ handle: 1, windowId: "w1" })];
  const current = [win({ handle: 1, windowId: "w1" })];
  assert.equal(markDiff(current, previous)[0].diff, "unchanged");
});

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

test("describeWindow: handle, title, placement, focus", () => {
  const line = describeWindow(
    win({
      handle: 2,
      windowId: "w2",
      title: "Pentest",
      snappedTo: "right-half",
      isFocused: true,
    }),
  );
  assert.equal(line, "[2] Pentest — right half, focused");
});

test("describeWindow: a minimized window says so rather than giving a size", () => {
  const line = describeWindow(
    win({ handle: 3, windowId: "w3", title: "Files", isMinimized: true }),
  );
  assert.equal(line, "[3] Files — minimized");
});

test("serializeSnapshot: never leaks an internal window id", () => {
  const text = serializeSnapshot(
    snapshot([win({ handle: 1, windowId: ":r7:-win-3", title: "Chat" })]),
  );
  assert.ok(!text.includes(":r7:-win-3"), "internal ids must not reach the model");
  assert.ok(text.includes("[1] Chat"));
});

test("serializeSnapshot: marks new and changed windows", () => {
  const windows = [
    win({ handle: 1, windowId: "w1", title: "Chat" }),
    { ...win({ handle: 2, windowId: "w2", title: "Pentest" }), diff: "new" as const },
    { ...win({ handle: 3, windowId: "w3", title: "Files" }), diff: "changed" as const },
  ];
  const text = serializeSnapshot(snapshot(windows));
  assert.match(text, /\[2\] Pentest.*\*new/);
  assert.match(text, /\[3\] Files.*~changed/);
});

test("serializeSnapshot: an empty desktop says so plainly", () => {
  const text = serializeSnapshot(snapshot([]));
  assert.match(text, /WINDOWS \(0\) — the desktop is empty/);
});

test("serializeSnapshot: the catalogue is omitted unless asked for", () => {
  const base = snapshot([]);
  const withCatalog: DesktopSnapshot = {
    ...base,
    catalog: [
      { appId: "pentest", name: "pentest", description: "Penetration testing framework." },
    ],
  };
  assert.ok(!serializeSnapshot(withCatalog).includes("pentest"));
  assert.ok(
    serializeSnapshot(withCatalog, { includeCatalog: true }).includes("pentest"),
  );
});

test("serializeSnapshot: stays well inside the token budget for a busy desktop", () => {
  // NFR-4 budgets ~600 tokens. Eight windows plus a full dock must not come
  // close, because this is returned after every batch.
  const windows = Array.from({ length: 8 }, (_, i) =>
    win({
      handle: i + 1,
      windowId: `w${i}`,
      title: `Security App Number ${i}`,
      snappedTo: "left-half",
    }),
  );
  const busy: DesktopSnapshot = {
    ...snapshot(windows),
    dock: {
      system: [
        { appId: "chat", name: "Chat", openWindows: 1 },
        { appId: "apps", name: "Apps", openWindows: 0 },
        { appId: "app-store", name: "App Store", openWindows: 0 },
        { appId: "files", name: "Files", openWindows: 1 },
        { appId: "brain", name: "Brain", openWindows: 0 },
      ],
      pinned: [{ appId: "pentest", name: "Pentest", openWindows: 2 }],
      running: [{ appId: "soc2-readiness", name: "Soc2 Readiness", openWindows: 1 }],
    },
  };
  // ~4 chars per token is the usual rule of thumb; 600 tokens ≈ 2400 chars.
  assert.ok(
    serializeSnapshot(busy).length < 1200,
    "a busy desktop must serialise well under the budget",
  );
});

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

test("resolveHandle: finds a window by its handle", () => {
  const state = snapshot([win({ handle: 1, windowId: "w1", title: "Chat" })]);
  const found = resolveHandle(state, 1);
  assert.ok(!isResolutionError(found));
  assert.equal((found as WindowView).windowId, "w1");
});

test("resolveHandle: a hallucinated handle is a recoverable error naming the real ones", () => {
  const state = snapshot([
    win({ handle: 1, windowId: "w1" }),
    win({ handle: 2, windowId: "w2" }),
  ]);
  const result = resolveHandle(state, 9);
  assert.ok(isResolutionError(result));
  assert.equal(result.kind, "unknown-handle");
  assert.match(result.message, /\[1\], \[2\]/);
});

test("resolveHandle: on an empty desktop it says to open something first", () => {
  const result = resolveHandle(snapshot([]), 1);
  assert.ok(isResolutionError(result));
  assert.match(result.message, /desktop is empty/);
});
