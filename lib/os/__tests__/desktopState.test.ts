import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildAppCatalog,
  buildDesktopSnapshot,
  effectiveAppId,
  OS_APP_AGENT_DESCRIPTIONS,
  type DesktopSnapshotInput,
  type OsAppDescriptor,
} from "../desktopState";
import { serializeSnapshot } from "../agentProtocol";
import type { OsWindowInstance } from "../types";
import type { Project } from "@/lib/api/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

/** Stands in for the registry, which the pure builder deliberately cannot import. */
const OS_APPS_FIXTURE: OsAppDescriptor[] = [
  { appId: "chat", title: "Chat", description: OS_APP_AGENT_DESCRIPTIONS.chat },
  { appId: "apps", title: "Apps", description: OS_APP_AGENT_DESCRIPTIONS.apps },
  {
    appId: "app-store",
    title: "App Store",
    description: OS_APP_AGENT_DESCRIPTIONS["app-store"],
  },
  { appId: "files", title: "Files", description: OS_APP_AGENT_DESCRIPTIONS.files },
  { appId: "brain", title: "Brain", description: OS_APP_AGENT_DESCRIPTIONS.brain },
];

function input(
  overrides: Partial<DesktopSnapshotInput> = {},
): DesktopSnapshotInput {
  return {
    windows: [],
    focusedWindowId: null,
    pinned: [],
    osApps: OS_APPS_FIXTURE,
    catalog: [],
    viewport: { width: 1512, height: 789 },
    mode: "collab",
    previous: null,
    ...overrides,
  };
}

function project(overrides: Partial<Project> & { id: string }): Project {
  return {
    name: overrides.id,
    description: "",
    path: `projects/${overrides.id}`,
    url: "https://example.invalid",
    has_claude_md: true,
    has_project_json: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// App identity
// ---------------------------------------------------------------------------

test("effectiveAppId: a security app is named by its project, not by the shared registry id", () => {
  const window = osWindow({
    id: "w1",
    appId: "security-app",
    params: { appId: "pentest" },
  });
  assert.equal(effectiveAppId(window), "pentest");
});

test("effectiveAppId: an OS app is named by its registry id", () => {
  assert.equal(effectiveAppId(osWindow({ id: "w1", appId: "chat" })), "chat");
});

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

test("buildDesktopSnapshot: handles are 1-based and follow creation order", () => {
  const snapshot = buildDesktopSnapshot(
    input({
      windows: [
        osWindow({ id: "w1", appId: "chat" }),
        osWindow({ id: "w2", appId: "files" }),
      ],
    }),
  );
  assert.deepEqual(
    snapshot.windows.map((w) => [w.handle, w.windowId]),
    [
      [1, "w1"],
      [2, "w2"],
    ],
  );
});

test("buildDesktopSnapshot: stacking order does not renumber handles", () => {
  // Focusing a window only mutates `z`, never array order — so a handle the
  // agent is holding across a turn keeps meaning the same window.
  const windows = [
    osWindow({ id: "w1", appId: "chat", z: 99 }),
    osWindow({ id: "w2", appId: "files", z: 11 }),
  ];
  const before = buildDesktopSnapshot(input({ windows }));
  const after = buildDesktopSnapshot(
    input({
      windows: [
        { ...windows[0], z: 11 },
        { ...windows[1], z: 99 },
      ],
    }),
  );
  assert.deepEqual(
    before.windows.map((w) => w.handle),
    after.windows.map((w) => w.handle),
  );
});

test("buildDesktopSnapshot: marks the focused window", () => {
  const snapshot = buildDesktopSnapshot(
    input({
      windows: [
        osWindow({ id: "w1", appId: "chat" }),
        osWindow({ id: "w2", appId: "files" }),
      ],
      focusedWindowId: "w2",
    }),
  );
  assert.equal(snapshot.windows[0].isFocused, false);
  assert.equal(snapshot.windows[1].isFocused, true);
});

test("buildDesktopSnapshot: the title falls back to the registry when the opener set none", () => {
  const snapshot = buildDesktopSnapshot(
    input({ windows: [osWindow({ id: "w1", appId: "chat" })] }),
  );
  assert.equal(snapshot.windows[0].title, "Chat");
});

test("buildDesktopSnapshot: an instance title wins over the registry", () => {
  const snapshot = buildDesktopSnapshot(
    input({
      windows: [
        osWindow({
          id: "w1",
          appId: "security-app",
          params: { appId: "pentest" },
          title: "Pentest",
        }),
      ],
    }),
  );
  assert.equal(snapshot.windows[0].title, "Pentest");
  assert.equal(snapshot.windows[0].appId, "pentest");
});

test("buildDesktopSnapshot: focus alone does not change the epoch", () => {
  // The epoch guards handle validity, and focusing changes nothing about which
  // windows exist — so a plan made before the user clicked is still good.
  const windows = [osWindow({ id: "w1", appId: "chat" })];
  const before = buildDesktopSnapshot(input({ windows }));
  const after = buildDesktopSnapshot(input({ windows, focusedWindowId: "w1" }));
  assert.equal(before.epoch, after.epoch);
});

test("buildDesktopSnapshot: opening a window changes the epoch", () => {
  const before = buildDesktopSnapshot(
    input({ windows: [osWindow({ id: "w1", appId: "chat" })] }),
  );
  const after = buildDesktopSnapshot(
    input({
      windows: [
        osWindow({ id: "w1", appId: "chat" }),
        osWindow({ id: "w2", appId: "files" }),
      ],
    }),
  );
  assert.notEqual(before.epoch, after.epoch);
});

test("buildDesktopSnapshot: diffs against the previous read", () => {
  const first = buildDesktopSnapshot(
    input({ windows: [osWindow({ id: "w1", appId: "chat" })] }),
  );
  const second = buildDesktopSnapshot(
    input({
      windows: [
        osWindow({ id: "w1", appId: "chat" }),
        osWindow({ id: "w2", appId: "files" }),
      ],
      previous: first.windows,
    }),
  );
  assert.equal(second.windows[0].diff, "unchanged");
  assert.equal(second.windows[1].diff, "new");
});

// ---------------------------------------------------------------------------
// Dock
// ---------------------------------------------------------------------------

test("buildDesktopSnapshot: the dock lists the OS's own apps with window counts", () => {
  const snapshot = buildDesktopSnapshot(
    input({ windows: [osWindow({ id: "w1", appId: "chat" })] }),
  );
  const chat = snapshot.dock.system.find((entry) => entry.appId === "chat");
  assert.ok(chat);
  assert.equal(chat.openWindows, 1);
  // The security-app registry entry has showInDock: false and must not appear.
  assert.ok(!snapshot.dock.system.some((e) => e.appId === "security-app"));
});

test("buildDesktopSnapshot: a minimized window still counts as open", () => {
  const snapshot = buildDesktopSnapshot(
    input({ windows: [osWindow({ id: "w1", appId: "chat", isMinimized: true })] }),
  );
  assert.equal(
    snapshot.dock.system.find((entry) => entry.appId === "chat")?.openWindows,
    1,
  );
});

test("buildDesktopSnapshot: running-but-unpinned apps are their own group", () => {
  const snapshot = buildDesktopSnapshot(
    input({
      windows: [
        osWindow({
          id: "w1",
          appId: "security-app",
          params: { appId: "pentest" },
          title: "Pentest",
        }),
      ],
    }),
  );
  assert.deepEqual(
    snapshot.dock.running.map((entry) => entry.appId),
    ["pentest"],
  );
  assert.equal(snapshot.dock.pinned.length, 0);
});

test("buildDesktopSnapshot: a pinned app is not repeated in the running group", () => {
  const snapshot = buildDesktopSnapshot(
    input({
      windows: [
        osWindow({
          id: "w1",
          appId: "security-app",
          params: { appId: "pentest" },
          title: "Pentest",
        }),
      ],
      pinned: [{ id: "pentest", name: "pentest" }],
    }),
  );
  assert.deepEqual(
    snapshot.dock.pinned.map((entry) => entry.appId),
    ["pentest"],
  );
  assert.equal(snapshot.dock.running.length, 0);
});

test("buildDesktopSnapshot: two windows of one app are counted once in the dock", () => {
  const snapshot = buildDesktopSnapshot(
    input({
      windows: [
        osWindow({ id: "w1", appId: "security-app", params: { appId: "pentest" } }),
        osWindow({ id: "w2", appId: "security-app", params: { appId: "pentest" } }),
      ],
    }),
  );
  assert.equal(snapshot.dock.running.length, 1);
  assert.equal(snapshot.dock.running[0].openWindows, 2);
});

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

test("buildAppCatalog: the OS's own apps are always openable", () => {
  const catalog = buildAppCatalog(OS_APPS_FIXTURE, undefined);
  const ids = catalog.map((entry) => entry.appId);
  assert.ok(ids.includes("chat"));
  assert.ok(ids.includes("files"));
  // Never the shared security-app registry id — it is not a thing to open.
  assert.ok(!ids.includes("security-app"));
});

test("buildAppCatalog: every OS app carries a description the agent can act on", () => {
  for (const entry of buildAppCatalog(OS_APPS_FIXTURE, undefined)) {
    assert.ok(
      entry.description && entry.description.length > 0,
      `${entry.appId} needs a description`,
    );
  }
});

test("buildAppCatalog: locked apps are excluded", () => {
  // Offering an app the workspace does not have would have the agent
  // confidently open something that cannot open.
  const catalog = buildAppCatalog(OS_APPS_FIXTURE, [
    project({ id: "pentest", enabled: true }),
    project({ id: "soc2-readiness", enabled: false }),
  ]);
  const ids = catalog.map((entry) => entry.appId);
  assert.ok(ids.includes("pentest"));
  assert.ok(!ids.includes("soc2-readiness"));
});

test("buildAppCatalog: descriptions and tags ride along for grounding", () => {
  const catalog = buildAppCatalog(OS_APPS_FIXTURE, [
    project({
      id: "aws-vulnerability-prioritizer",
      description: "AWS container vulnerability analysis.",
      tags: ["domain:cloud"],
      enabled: true,
    }),
  ]);
  const entry = catalog.find((e) => e.appId === "aws-vulnerability-prioritizer");
  assert.ok(entry);
  assert.equal(entry.description, "AWS container vulnerability analysis.");
  assert.deepEqual(entry.tags, ["domain:cloud"]);
});

// ---------------------------------------------------------------------------
// End to end through the serializer
// ---------------------------------------------------------------------------

test("a staged desktop serialises to something the agent can act on", () => {
  const snapshot = buildDesktopSnapshot(
    input({
      windows: [
        osWindow({ id: "w1", appId: "chat", snappedTo: "left-half" }),
        osWindow({
          id: "w2",
          appId: "security-app",
          params: { appId: "pentest" },
          title: "Pentest",
          snappedTo: "right-half",
        }),
      ],
      focusedWindowId: "w1",
    }),
  );

  const text = serializeSnapshot(snapshot);
  assert.match(text, /\[1\] Chat — left half, focused/);
  assert.match(text, /\[2\] Pentest — right half/);
  assert.ok(!text.includes("w1"), "internal ids must not reach the model");
});

// ---------------------------------------------------------------------------
// Addressing inside a window (Phase 9, Stage 9.1)
//
// Two shipped bugs that every deeper addressing scheme would have inherited.
// Both were invisible in the cases the original tests covered, which is why
// they are pinned here by the exact case that broke.
// ---------------------------------------------------------------------------

const PANELLED_APPS: OsAppDescriptor[] = [
  {
    appId: "brain",
    title: "Brain",
    panels: [
      { id: "config", label: "Config" },
      { id: "memory", label: "Memory" },
    ],
  },
  {
    appId: "security-app",
    title: "Security",
    panels: [
      { id: "overview", label: "Overview" },
      { id: "findings", label: "Findings" },
    ],
  },
];

test("a project window carries its host app's panels", () => {
  // The bug: panels were looked up by `params.appId ?? appId`, and for a
  // security app `params.appId` is the *project* id — which is not in the OS
  // app list, so the lookup missed and the window could never be addressed
  // inside at all. It looked correct for OS apps only because there the two
  // ids are the same value.
  const snapshot = buildDesktopSnapshot(
    input({
      windows: [
        osWindow({
          id: "w1",
          appId: "security-app",
          params: { appId: "pentest-findings" },
        }),
      ],
      osApps: PANELLED_APPS,
    }),
  );

  assert.deepEqual(
    snapshot.windows[0].panels?.map((p) => p.id),
    ["overview", "findings"],
  );
  // The window is still *named* by its project — that part was right.
  assert.equal(snapshot.windows[0].appId, "pentest-findings");
});

test("a freshly opened app reports the panel it is actually showing", () => {
  // `params.panel` is unset until somebody sets it, so a new Brain window
  // reported no active panel while visibly displaying Config. The agent could
  // not distinguish "showing Config" from "showing nothing", which makes
  // "switch to Memory" and "you are already there" the same observation.
  const snapshot = buildDesktopSnapshot(
    input({
      windows: [osWindow({ id: "w1", appId: "brain" })],
      osApps: PANELLED_APPS,
    }),
  );
  assert.equal(snapshot.windows[0].activePanel, "config");
});

test("an explicitly set panel wins over the default", () => {
  const snapshot = buildDesktopSnapshot(
    input({
      windows: [
        osWindow({ id: "w1", appId: "brain", params: { panel: "memory" } }),
      ],
      osApps: PANELLED_APPS,
    }),
  );
  assert.equal(snapshot.windows[0].activePanel, "memory");
});

test("an app with no panels reports none, rather than inventing one", () => {
  const snapshot = buildDesktopSnapshot(
    input({
      windows: [osWindow({ id: "w1", appId: "chat" })],
      osApps: [{ appId: "chat", title: "Chat" }],
    }),
  );
  assert.equal(snapshot.windows[0].panels, undefined);
  assert.equal(snapshot.windows[0].activePanel, undefined);
});

test("the serialized snapshot names the panel it is showing", () => {
  // The model reads the text rendering, not the object, so the fix only
  // counts if it survives serialization.
  const snapshot = buildDesktopSnapshot(
    input({
      windows: [osWindow({ id: "w1", appId: "brain" })],
      osApps: PANELLED_APPS,
    }),
  );
  const text = serializeSnapshot(snapshot, { includeCatalog: false });
  assert.ok(!/showing: —/.test(text), `still reporting an unknown panel:\n${text}`);
  assert.match(text, /config/i);
});

// ---------------------------------------------------------------------------
// Affordances — controls inside a window (Phase 9, Stage 9.4)
// ---------------------------------------------------------------------------

const CONTROLLED_APPS: OsAppDescriptor[] = [
  {
    appId: "apps",
    title: "Apps",
    affordances: [
      { id: "search", label: "Search", kind: "search" },
      {
        id: "severity",
        label: "Severity",
        kind: "filter",
        options: ["critical", "high"],
      },
    ],
  },
];

test("a window reports its controls and what each is set to", () => {
  // The current value is the load-bearing half. Without it the agent cannot
  // tell "I set that filter" from "I meant to", and re-sets it every turn.
  const snapshot = buildDesktopSnapshot(
    input({
      windows: [
        osWindow({ id: "w1", appId: "apps", params: { search: "pentest" } }),
      ],
      osApps: CONTROLLED_APPS,
    }),
  );

  const controls = snapshot.windows[0].affordances;
  assert.equal(controls?.length, 2);
  assert.equal(controls?.find((c) => c.id === "search")?.value, "pentest");
  assert.equal(
    controls?.find((c) => c.id === "severity")?.value,
    undefined,
    "an unset control must read as unset, not as empty string",
  );
});

test("an app with no controls reports none", () => {
  const snapshot = buildDesktopSnapshot(
    input({
      windows: [osWindow({ id: "w1", appId: "chat" })],
      osApps: [{ appId: "chat", title: "Chat" }],
    }),
  );
  assert.equal(snapshot.windows[0].affordances, undefined);
});

test("the serialized snapshot shows controls with their values and options", () => {
  const snapshot = buildDesktopSnapshot(
    input({
      windows: [
        osWindow({ id: "w1", appId: "apps", params: { search: "pentest" } }),
      ],
      osApps: CONTROLLED_APPS,
    }),
  );
  const text = serializeSnapshot(snapshot, { includeCatalog: false });
  assert.match(text, /controls:/);
  assert.match(text, /search="pentest"/);
  assert.match(text, /critical\|high/, "a filter must name what it accepts");
});
