/**
 * The file system's shape, per §6 of the OS concept.
 *
 * These pin the claims the concept note is explicit about, because they are the
 * ones a refactor would quietly break:
 *
 *  - two roots, `apps` and `chat`
 *  - the build sits **above** outputs (provenance / audit defensibility)
 *  - date is a level **inside** a build's outputs, never above the build
 *  - a refresh belongs to the build that was current when it ran
 *  - the tree is derived — an app with no refreshes has no folder
 */

import assert from "node:assert/strict";
import { describe, it, test } from "node:test";

import {
  assembleEntries,
  locationCrumbs,
  locationToPath,
  pathToLocation,
  ROOT_LOCATION,
  searchInRefresh,
  type FileSystemLocation,
} from "../fileSystemModel";
import type { Build } from "@/lib/api/builds";
import type { ProjectFile, SessionWithSummary } from "@/lib/api/types";

function session(id: string, createdAt: string, projectId = "threat-intel"): SessionWithSummary {
  return {
    session_id: id,
    project_id: projectId,
    created_at: createdAt,
    status: "completed",
  } as SessionWithSummary;
}

function build(number: number, promotedAt: string): Build {
  return { number, promoted_at: promotedAt } as Build;
}

function file(path: string, size = 100): ProjectFile {
  return {
    path,
    filename: path.split("/").pop() ?? path,
    size,
    mime_type: "application/octet-stream",
    modified_at: "2026-07-27T16:33:53Z",
  };
}

const NO_DATA = {
  appIds: [],
  chatIds: [],
  chatConversations: [],
  sessionsByApp: new Map<string, SessionWithSummary[]>(),
  builds: [],
  openSession: null,
  visibleFiles: [],
};

describe("roots", () => {
  it("has exactly two, apps and chat", () => {
    const entries = assembleEntries({ ...NO_DATA, location: ROOT_LOCATION });
    assert.deepEqual(
      entries.map((e) => e.name),
      ["apps", "chat"],
    );
    assert.ok(entries.every((e) => e.isDirectory));
  });

  it("counts what is inside each", () => {
    const entries = assembleEntries({
      ...NO_DATA,
      location: ROOT_LOCATION,
      appIds: ["a", "b"],
      chatIds: [{ id: "c1", title: "One" }],
    });
    assert.equal(entries[0].meta, "2 apps");
    assert.equal(entries[1].meta, "1 conversation");
  });
});

describe("apps level", () => {
  it("lists only apps that have produced a refresh", () => {
    const sessionsByApp = new Map([
      ["threat-intel", [session("s1", "2026-07-27T10:00:00Z")]],
    ]);
    const entries = assembleEntries({
      ...NO_DATA,
      location: { ...ROOT_LOCATION, root: "apps" },
      appIds: ["threat-intel"],
      sessionsByApp,
    });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].name, "threat-intel");
    assert.equal(entries[0].meta, "1 refresh");
  });

  it("shows nothing when no app has refreshed", () => {
    const entries = assembleEntries({
      ...NO_DATA,
      location: { ...ROOT_LOCATION, root: "apps" },
    });
    assert.deepEqual(entries, []);
  });
});

describe("build level — the provenance rule", () => {
  const sessionsByApp = new Map([
    [
      "threat-intel",
      [
        session("s3", "2026-07-27T10:00:00Z"),
        session("s2", "2026-07-20T10:00:00Z"),
        session("s1", "2026-07-01T10:00:00Z"),
      ],
    ],
  ]);
  const builds = [build(1, "2026-07-15T00:00:00Z"), build(2, "2026-07-25T00:00:00Z")];
  const location: FileSystemLocation = {
    ...ROOT_LOCATION,
    root: "apps",
    appId: "threat-intel",
  };

  it("groups refreshes under the build that was current when they ran", () => {
    const entries = assembleEntries({ ...NO_DATA, location, sessionsByApp, builds });
    assert.deepEqual(
      entries.map((e) => e.name),
      ["build 2", "build 1", "default"],
    );
    // s3 is after build 2's promotion; s2 falls between 1 and 2; s1 predates both.
    assert.equal(entries[0].meta, "1 refresh");
    assert.equal(entries[1].meta, "1 refresh");
    assert.equal(entries[2].meta, "1 refresh");
  });

  it("calls the pre-build state 'default', not build 0", () => {
    const entries = assembleEntries({ ...NO_DATA, location, sessionsByApp, builds });
    const fallback = entries.find((e) => e.name === "default");
    assert.ok(fallback);
    // `"default"` and not `null`: null is the level that *lists* builds.
    assert.equal(fallback.next?.build, "default");
  });

  it("omits a build that owns no refresh", () => {
    const entries = assembleEntries({
      ...NO_DATA,
      location,
      sessionsByApp,
      // Build 3 promoted after every refresh, so it owns none.
      builds: [...builds, build(3, "2026-07-30T00:00:00Z")],
    });
    assert.ok(!entries.some((e) => e.name === "build 3"));
  });
});

describe("date level — inside a build, never above it", () => {
  const sessionsByApp = new Map([
    [
      "threat-intel",
      [
        session("s2", "2026-07-27T16:00:00Z"),
        session("s1", "2026-07-26T09:00:00Z"),
      ],
    ],
  ]);
  const builds = [build(1, "2026-07-01T00:00:00Z")];

  it("lists one folder per date the build refreshed on, newest first", () => {
    const entries = assembleEntries({
      ...NO_DATA,
      location: {
        ...ROOT_LOCATION,
        root: "apps",
        appId: "threat-intel",
        build: 1,
      },
      sessionsByApp,
      builds,
    });
    assert.deepEqual(
      entries.map((e) => e.name),
      ["2026-07-27", "2026-07-26"],
    );
  });

  it("excludes refreshes belonging to a different build", () => {
    const entries = assembleEntries({
      ...NO_DATA,
      location: {
        ...ROOT_LOCATION,
        root: "apps",
        appId: "threat-intel",
        build: "default",
      },
      sessionsByApp,
      builds,
    });
    // Both refreshes post-date build 1, so "default" holds none of them.
    assert.deepEqual(entries, []);
  });

  it("distinguishes 'no build chosen' from 'the default build'", () => {
    /**
     * Regression: `build: null` used to mean both, so the `default` folder was
     * un-openable — clicking it produced the location you were already at, and
     * the build list simply re-rendered.
     */
    // Needs a refresh that predates every build, so a "default" folder exists.
    const mixedSessions = new Map([
      [
        "threat-intel",
        [
          session("s2", "2026-07-27T10:00:00Z"),
          session("s1", "2026-07-01T10:00:00Z"),
        ],
      ],
    ]);
    const mixedBuilds = [build(1, "2026-07-15T00:00:00Z")];
    const location: FileSystemLocation = {
      ...ROOT_LOCATION,
      root: "apps",
      appId: "threat-intel",
      build: null,
    };

    const buildList = assembleEntries({
      ...NO_DATA,
      location,
      sessionsByApp: mixedSessions,
      builds: mixedBuilds,
    });
    const defaultFolder = buildList.find((e) => e.name === "default");
    assert.ok(defaultFolder, "expected a default folder");
    assert.equal(defaultFolder.next?.build, "default");

    // Opening it must land somewhere different from where we started.
    const opened = assembleEntries({
      ...NO_DATA,
      location: defaultFolder.next!,
      sessionsByApp: mixedSessions,
      builds: mixedBuilds,
    });
    assert.notDeepEqual(
      opened.map((e) => e.name),
      buildList.map((e) => e.name),
      "opening 'default' returned the build list again",
    );
    // It is the date level for the pre-build state: s1 is the only such refresh.
    assert.deepEqual(
      opened.map((e) => e.name),
      ["2026-07-01"],
    );
  });
});

describe("inside a refresh's outputs", () => {
  const openSession = session("s1", "2026-07-27T16:00:00Z");
  const visibleFiles = [
    file("reports/breaches/zenith.pdf", 92205),
    file("reports/threats/fastjson.pdf"),
    file("components/AdvisoriesPanel.tsx"),
    file("data/advisories_raw.json"),
  ];
  const base: FileSystemLocation = {
    ...ROOT_LOCATION,
    root: "apps",
    appId: "threat-intel",
    build: 1,
    date: "2026-07-27",
  };

  it("shows the refresh's own folder shape", () => {
    const entries = assembleEntries({
      ...NO_DATA,
      location: base,
      openSession,
      visibleFiles,
    });
    const names = entries.map((e) => e.name).sort();
    assert.deepEqual(names, ["components", "data", "reports"]);
    assert.ok(entries.every((e) => e.isDirectory));
  });

  it("descends into a nested folder and returns files with what sharing needs", () => {
    const entries = assembleEntries({
      ...NO_DATA,
      location: { ...base, inner: "reports/breaches" },
      openSession,
      visibleFiles,
    });
    assert.equal(entries.length, 1);
    const [entry] = entries;
    assert.equal(entry.name, "zenith.pdf");
    assert.equal(entry.isDirectory, false);
    assert.equal(entry.size, 92205);
    assert.equal(entry.sessionId, "s1");
    assert.equal(entry.filePath, "reports/breaches/zenith.pdf");
  });

  it("is empty for a folder that does not exist", () => {
    const entries = assembleEntries({
      ...NO_DATA,
      location: { ...base, inner: "nope/nowhere" },
      openSession,
      visibleFiles,
    });
    assert.deepEqual(entries, []);
  });

  it("is empty when the refresh could not be resolved", () => {
    const entries = assembleEntries({
      ...NO_DATA,
      location: base,
      openSession: null,
      visibleFiles,
    });
    assert.deepEqual(entries, []);
  });
});

describe("chat root", () => {
  const chatConversations = [
    {
      conversation_id: "conv-1",
      title: "Log4j questions",
      files: [file("evidence.pdf", 5000)],
    },
  ];

  it("lists conversations that have files", () => {
    const entries = assembleEntries({
      ...NO_DATA,
      location: { ...ROOT_LOCATION, root: "chat" },
      chatIds: [{ id: "conv-1", title: "Log4j questions" }],
      chatConversations,
    });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].name, "Log4j questions");
    assert.ok(entries[0].isDirectory);
  });

  it("lists a conversation's files without a session to fetch them from", () => {
    const entries = assembleEntries({
      ...NO_DATA,
      location: { ...ROOT_LOCATION, root: "chat", appId: "conv-1" },
      chatConversations,
    });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].name, "evidence.pdf");
    // Conversation uploads are not a refresh's outputs, so there is no session
    // id — the caller uses this to know preview and sharing don't apply yet.
    assert.equal(entries[0].sessionId, undefined);
  });
});

describe("paths and breadcrumbs", () => {
  it("builds the canonical path", () => {
    assert.equal(locationToPath(ROOT_LOCATION), "/");
    assert.equal(
      locationToPath({
        root: "apps",
        appId: "threat-intel",
        build: 1,
        date: "2026-07-27",
        inner: "reports/breaches",
      }),
      "/apps/threat-intel/build-1/outputs/2026-07-27/reports/breaches",
    );
  });

  it("says 'default' when no build was promoted", () => {
    assert.equal(
      locationToPath({
        root: "apps",
        appId: "threat-intel",
        build: "default",
        date: "2026-07-01",
        inner: "",
      }),
      "/apps/threat-intel/default/outputs/2026-07-01",
    );
  });

  it("gives every level a crumb that navigates back to it", () => {
    const crumbs = locationCrumbs({
      root: "apps",
      appId: "threat-intel",
      build: 2,
      date: "2026-07-27",
      inner: "reports/breaches",
    });
    assert.deepEqual(
      crumbs.map((c) => c.label),
      ["apps", "threat-intel", "build 2", "2026-07-27", "reports", "breaches"],
    );
    // The nested crumb must return to its own level, not the whole path.
    assert.equal(crumbs[4].location.inner, "reports");
    assert.equal(crumbs[5].location.inner, "reports/breaches");
    // And going back up a level must clear what is below it.
    assert.equal(crumbs[2].location.date, null);
  });

  it("stops at the conversation for the chat root", () => {
    const crumbs = locationCrumbs({
      root: "chat",
      appId: "conv-1",
      build: null,
      date: null,
      inner: "",
    });
    assert.deepEqual(
      crumbs.map((c) => c.label),
      ["chat", "conv-1"],
    );
  });
});

describe("search — the folder and everything below it", () => {
  const openSession = session("s1", "2026-07-27T16:00:00Z");
  const visibleFiles = [
    file("reports/breaches/zenith_log4j.pdf", 92205),
    file("reports/threats/fastjson.pdf"),
    file("reports/threats/log4j_followup.pdf"),
    file("components/AdvisoriesPanel.tsx"),
    file("data/advisories_raw.json"),
  ];
  const base: FileSystemLocation = {
    ...ROOT_LOCATION,
    root: "apps",
    appId: "threat-intel",
    build: 1,
    date: "2026-07-27",
  };

  it("finds hits nested below the current folder", () => {
    // "the Log4j one" — §6's own example of how people search.
    const hits = searchInRefresh({
      location: base,
      visibleFiles,
      openSession,
      query: "log4j",
    });
    assert.deepEqual(
      hits.map((h) => h.name).sort(),
      ["log4j_followup.pdf", "zenith_log4j.pdf"],
    );
    assert.ok(hits.every((h) => !h.isDirectory));
  });

  it("reports where each hit was found, relative to where you stand", () => {
    const hits = searchInRefresh({
      location: base,
      visibleFiles,
      openSession,
      query: "log4j",
    });
    const byName = Object.fromEntries(hits.map((h) => [h.name, h.meta]));
    assert.equal(byName["zenith_log4j.pdf"], "reports/breaches");
    assert.equal(byName["log4j_followup.pdf"], "reports/threats");
  });

  it("scopes to the current folder, not the whole refresh", () => {
    const hits = searchInRefresh({
      location: { ...base, inner: "reports/threats" },
      visibleFiles,
      openSession,
      query: "log4j",
    });
    assert.deepEqual(
      hits.map((h) => h.name),
      ["log4j_followup.pdf"],
    );
    // Standing in the folder it lives in, there is no sub-path to report.
    assert.equal(hits[0].meta, undefined);
  });

  it("does not match on the prefix every result shares", () => {
    /**
     * Standing in `reports/`, a query for "reports" must not match everything
     * merely because the shared prefix is in every path.
     */
    const hits = searchInRefresh({
      location: { ...base, inner: "reports" },
      visibleFiles,
      openSession,
      query: "reports",
    });
    assert.deepEqual(hits, []);
  });

  it("requires every term, so a query narrows", () => {
    const hits = searchInRefresh({
      location: base,
      visibleFiles,
      openSession,
      query: "log4j breaches",
    });
    assert.deepEqual(
      hits.map((h) => h.name),
      ["zenith_log4j.pdf"],
    );
  });

  it("carries what preview and sharing need", () => {
    const [hit] = searchInRefresh({
      location: base,
      visibleFiles,
      openSession,
      query: "zenith",
    });
    assert.equal(hit.sessionId, "s1");
    assert.equal(hit.filePath, "reports/breaches/zenith_log4j.pdf");
    assert.equal(hit.size, 92205);
  });

  it("is empty for a blank query or an unresolved refresh", () => {
    assert.deepEqual(
      searchInRefresh({ location: base, visibleFiles, openSession, query: "   " }),
      [],
    );
    assert.deepEqual(
      searchInRefresh({ location: base, visibleFiles, openSession: null, query: "log4j" }),
      [],
    );
  });

  it("matches case-insensitively", () => {
    const hits = searchInRefresh({
      location: base,
      visibleFiles,
      openSession,
      query: "LOG4J",
    });
    assert.equal(hits.length, 2);
  });
});

// ---------------------------------------------------------------------------
// pathToLocation — the agent's way of being GIVEN a place (Stage 9.4)
//
// Files gets one affordance carrying a whole path rather than one control per
// segment, so this parser is the entire boundary. Anything it gets wrong lands
// the window in a folder nobody asked for.
// ---------------------------------------------------------------------------

test("a path round-trips through the location model", () => {
  const paths = [
    "/apps/pentest",
    "/apps/pentest/build-3",
    "/apps/pentest/default",
    "/apps/pentest/build-3/outputs/2026-08-06",
    "/apps/pentest/build-3/outputs/2026-08-06/reports/summary.md",
    "/chat/abc-123",
    "/chat/abc-123/notes.md",
  ];
  for (const path of paths) {
    const location = pathToLocation(path);
    assert.ok(location, `${path} failed to parse`);
    assert.equal(locationToPath(location), path, `${path} did not round-trip`);
  }
});

test("the root parses to the root", () => {
  const location = pathToLocation("/");
  assert.ok(location);
  assert.equal(location.root, null);
  assert.equal(locationToPath(location), "/");
});

test("'default' and build-0 stay distinct", () => {
  // The model is explicit that these are different states — an app running
  // what it shipped with is not build 0 — and collapsing them here would make
  // the `default` folder unopenable.
  assert.equal(pathToLocation("/apps/x/default")?.build, "default");
  assert.equal(pathToLocation("/apps/x/build-0")?.build, 0);
});

test("an unknown root is refused rather than guessed at", () => {
  assert.equal(pathToLocation("/nonsense/x"), null);
  assert.equal(pathToLocation("nonsense"), null);
});

test("a malformed build number is refused, not coerced", () => {
  // `Number("three")` is NaN, which compares unequal to everything and would
  // strand the window in a folder that can never match.
  assert.equal(pathToLocation("/apps/x/build-three"), null);
});

test("a deep inner path is kept whole", () => {
  const location = pathToLocation("/chat/abc/a/b/c.md");
  assert.equal(location?.inner, "a/b/c.md");
});

test("whitespace and a missing leading slash are tolerated", () => {
  assert.equal(pathToLocation("  /apps/x  ")?.appId, "x");
  assert.equal(pathToLocation("apps/x")?.appId, "x");
});
