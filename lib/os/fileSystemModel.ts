/**
 * The file system's shape — §6 of the OS concept, as pure data rules.
 *
 * ```
 * /apps/<app>/<build>/outputs/<date>/…
 * /chat/<conversation>/…
 * ```
 *
 * Two roots, `apps` and `chat`. The **build sits above outputs** because "the
 * build *is* the analysis logic — scope, scoring, what gets computed", which is
 * what makes an output defensible: *this report came from this logic, on this
 * date.* Date is a level **inside** a build's outputs, never above it.
 *
 * No React here on purpose. Which rows a folder contains is a question about the
 * concept, not about rendering, so it is decided by functions that can be tested
 * without mounting anything. `useFileSystem` supplies the data; this decides the
 * shape.
 */

import { buildFileTree } from "@/components/ui/file-reference-input/utils";
import { buildForSession } from "./useBuilds";
import type { Build } from "@/lib/api/builds";
import type { ConversationFilesItem } from "@/lib/api/conversations";
import type { ProjectFile, SessionWithSummary } from "@/lib/api/types";

/** The two roots. */
export type FileSystemRoot = "apps" | "chat";

/**
 * Where the browser currently is.
 *
 * Modelled as the meaningful path segments rather than a string, so no code has
 * to parse a path back into "which app, which build". `null` fields mean "not
 * that deep yet"; the string path is derived for display, never for logic.
 */
export interface FileSystemLocation {
  root: FileSystemRoot | null;
  /** Under `apps`: the app id. Under `chat`: the conversation id. */
  appId: string | null;
  /**
   * Which build level is open.
   *
   * `null` means no build has been chosen yet — the level that *lists* builds.
   * `"default"` is a chosen level too: the state an app shipped with, before
   * anything was promoted. These must be distinct values, because with one
   * `null` doing both jobs the `default` folder could not be opened — clicking
   * it produced the location you were already at.
   */
  build: number | "default" | null;
  /** `YYYY-MM-DD` of one refresh under that build. */
  date: string | null;
  /** Folder path *inside* that refresh's outputs, e.g. `reports/breaches`. */
  inner: string;
}

export const ROOT_LOCATION: FileSystemLocation = {
  root: null,
  appId: null,
  build: null,
  date: null,
  inner: "",
};

/** One row: a folder to descend into, or a file to open. */
export interface FileSystemEntry {
  /** Stable within its folder — used as the React key. */
  id: string;
  name: string;
  isDirectory: boolean;
  /** Files only. */
  size?: number;
  modifiedAt?: string;
  /** Files only: the refresh and path needed to fetch or share the bytes. */
  sessionId?: string;
  filePath?: string;
  file?: ProjectFile;
  /** Where descending leads. Folders only. */
  next?: FileSystemLocation;
  /** Extra column text, e.g. "3 refreshes". */
  meta?: string;
}

/** The canonical path, for the breadcrumb and the copyable string. */
export function locationToPath(loc: FileSystemLocation): string {
  if (!loc.root) return "/";
  const parts: string[] = [loc.root];
  if (loc.appId) parts.push(loc.appId);
  if (loc.root === "apps" && loc.appId) {
    // "default" is honest: an app with nothing promoted is running the state it
    // shipped with, which is not build 0.
    if (typeof loc.build === "number") parts.push(`build-${loc.build}`);
    else if (loc.build === "default") parts.push("default");
    if (loc.date) parts.push("outputs", loc.date);
  }
  if (loc.inner) parts.push(loc.inner);
  return `/${parts.join("/")}`;
}

/**
 * The inverse of `locationToPath` — turn a path back into a location.
 *
 * Exists so the agent can be *given* a place rather than only told where it
 * is. Files is the one app whose address is genuinely compound (root, app,
 * build, date, inner), and that is exactly why it gets **one** affordance
 * carrying a whole path instead of five controls: five could disagree with
 * each other, and an agent that set the root while the date still pointed
 * somewhere else would produce a location no user ever navigated to.
 *
 * Returns `null` for anything it cannot parse, so a malformed path is one
 * corrected step rather than a window silently landing at the root.
 */
export function pathToLocation(path: string): FileSystemLocation | null {
  const trimmed = path.trim();
  if (!trimmed || trimmed === "/") return { ...ROOT_LOCATION };

  const parts = trimmed.split("/").filter(Boolean);
  const root = parts.shift();
  if (root !== "apps" && root !== "chat") return null;

  const location: FileSystemLocation = { ...ROOT_LOCATION, root };
  if (parts.length === 0) return location;

  location.appId = parts.shift() ?? null;

  if (root === "apps") {
    const build = parts[0];
    if (build === "default") {
      location.build = "default";
      parts.shift();
    } else if (build?.startsWith("build-")) {
      const n = Number(build.slice("build-".length));
      // A non-numeric build is a typo, not a level. Refusing beats guessing:
      // `NaN` would compare unequal to everything and strand the window.
      if (!Number.isInteger(n)) return null;
      location.build = n;
      parts.shift();
    }
    if (parts[0] === "outputs") {
      parts.shift();
      location.date = parts.shift() ?? null;
    }
  }

  // Whatever is left is the path within the folder, joined back as it came.
  if (parts.length) location.inner = parts.join("/");
  return location;
}

/** Human breadcrumb segments, each with the location it navigates to. */
export function locationCrumbs(
  loc: FileSystemLocation,
  appName?: (appId: string) => string,
): Array<{ label: string; location: FileSystemLocation }> {
  const crumbs: Array<{ label: string; location: FileSystemLocation }> = [];
  if (!loc.root) return crumbs;

  crumbs.push({ label: loc.root, location: { ...ROOT_LOCATION, root: loc.root } });
  if (!loc.appId) return crumbs;

  crumbs.push({
    label: appName ? appName(loc.appId) : loc.appId,
    location: { ...ROOT_LOCATION, root: loc.root, appId: loc.appId },
  });

  if (loc.root !== "apps") {
    // A conversation's files are flat; there is no build or date below it.
    return crumbs;
  }

  if (loc.build !== null) {
    crumbs.push({
      label: typeof loc.build === "number" ? `build ${loc.build}` : "default",
      location: {
        ...ROOT_LOCATION,
        root: "apps",
        appId: loc.appId,
        build: loc.build,
      },
    });
  }

  if (loc.date) {
    crumbs.push({
      label: loc.date,
      location: {
        ...ROOT_LOCATION,
        root: "apps",
        appId: loc.appId,
        build: loc.build,
        date: loc.date,
      },
    });
  }

  // Each inner folder is its own crumb, so a file three levels down is still
  // navigable back to any level above it.
  if (loc.inner) {
    let accumulated = "";
    for (const segment of loc.inner.split("/")) {
      accumulated = accumulated ? `${accumulated}/${segment}` : segment;
      crumbs.push({
        label: segment,
        location: { ...loc, inner: accumulated },
      });
    }
  }

  return crumbs;
}

/**
 * Does this refresh belong to the open build level?
 *
 * Translates between the two vocabularies: `buildForSession` answers `null` for a
 * refresh that predates every promotion, while the location calls that level
 * `"default"`.
 */
export function ownedByBuildLevel(
  builds: Build[],
  session: SessionWithSummary,
  level: number | "default" | null,
): boolean {
  const owner = buildForSession(builds, session.created_at);
  if (level === "default") return owner === null;
  return owner === level;
}

/**
 * Search a refresh's outputs — the current folder **and everything below it**.
 *
 * §6 scopes filtering to *"in there"*, inside a build's outputs, because
 * *"'the Log4j one' is how people actually search"*. That scope is also the one
 * that is honestly searchable: a refresh's whole file list arrives in a single
 * response, so every descendant is already in hand. Above this level the tree is
 * lazy — searching "all apps" would mean fetching every refresh in the workspace
 * to answer one keystroke, so there the query filters what is listed.
 *
 * Results are flat, each carrying its path **relative to where you are
 * standing**, so a hit three folders down is still locatable.
 */
export function searchInRefresh({
  location,
  visibleFiles,
  openSession,
  query,
}: {
  location: FileSystemLocation;
  visibleFiles: ProjectFile[];
  openSession: SessionWithSummary | null;
  query: string;
}): FileSystemEntry[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0 || !openSession) return [];

  const prefix = location.inner ? `${location.inner}/` : "";

  return visibleFiles
    .filter((file) => file.path.startsWith(prefix))
    .filter((file) => {
      // Match the name and the path below here, not the prefix — every result
      // shares that, so including it would make any query for a folder you are
      // already inside match everything.
      const relative = file.path.slice(prefix.length);
      const haystack = `${file.filename} ${relative}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    })
    .map((file) => {
      const relative = file.path.slice(prefix.length);
      const folder = relative.includes("/")
        ? relative.slice(0, relative.lastIndexOf("/"))
        : "";
      return {
        id: file.path,
        name: file.filename,
        isDirectory: false,
        size: file.size,
        modifiedAt: file.modified_at,
        sessionId: openSession.session_id,
        filePath: file.path,
        file,
        // Where it was found, blank for a hit in this very folder.
        meta: folder || undefined,
      };
    });
}

/** `YYYY-MM-DD` for a refresh — the date level inside a build's outputs. */
export function refreshDate(session: SessionWithSummary): string {
  return (session.created_at ?? "").slice(0, 10);
}

/**
 * Assemble one folder's rows from the loaded sources.
 *
 * A pure function at module scope rather than a `useMemo` body: the React
 * Compiler could not preserve a manual memo this size, and it memoizes a plain
 * call for us. Being pure also makes each level's rules testable without
 * mounting anything.
 */
export function assembleEntries({
  location,
  appIds,
  chatIds,
  chatConversations,
  sessionsByApp,
  builds,
  openSession,
  visibleFiles,
}: {
  location: FileSystemLocation;
  appIds: string[];
  chatIds: Array<{ id: string; title: string }>;
  chatConversations: ConversationFilesItem[];
  sessionsByApp: Map<string, SessionWithSummary[]>;
  builds: Build[];
  openSession: SessionWithSummary | null;
  visibleFiles: ProjectFile[];
}): FileSystemEntry[] {

  // Level 0: the two roots.
  if (!location.root) {
    return [
      {
        id: "apps",
        name: "apps",
        isDirectory: true,
        next: { ...ROOT_LOCATION, root: "apps" },
        meta: `${appIds.length} ${appIds.length === 1 ? "app" : "apps"}`,
      },
      {
        id: "chat",
        name: "chat",
        isDirectory: true,
        next: { ...ROOT_LOCATION, root: "chat" },
        meta: `${chatIds.length} ${chatIds.length === 1 ? "conversation" : "conversations"}`,
      },
    ];
  }

  // Level 1 under chat: a folder per conversation that has files.
  if (location.root === "chat") {
    if (!location.appId) {
      return chatIds.map((c) => ({
        id: c.id,
        name: c.title,
        isDirectory: true,
        next: { ...ROOT_LOCATION, root: "chat", appId: c.id },
      }));
    }
    const conversation = chatConversations.find(
      (c) => c.conversation_id === location.appId,
    );
    return (conversation?.files ?? []).map((file) => ({
      id: file.path,
      name: file.filename,
      isDirectory: false,
      size: file.size,
      modifiedAt: file.modified_at,
      // Conversation uploads are not a refresh's outputs, so there is no
      // session to fetch them from — hence no sessionId, and the caller knows
      // not to offer preview or sharing for them yet.
      file,
    }));
  }

  // Level 1 under apps: a folder per app that has produced a refresh.
  if (!location.appId) {
    return appIds.map((appId) => {
      const count = sessionsByApp.get(appId)?.length ?? 0;
      return {
        id: appId,
        name: appId,
        isDirectory: true,
        next: { ...ROOT_LOCATION, root: "apps", appId },
        meta: `${count} ${count === 1 ? "refresh" : "refreshes"}`,
      };
    });
  }

  const appSessions = sessionsByApp.get(location.appId) ?? [];

  // Level 2: a folder per build (plus "default" for refreshes predating any
  // promotion). Only builds that actually own a refresh are shown — a build
  // with no outputs yet would be an empty folder.
  if (location.build === null) {
    const byBuild = new Map<number | null, SessionWithSummary[]>();
    for (const session of appSessions) {
      const owner = buildForSession(builds, session.created_at);
      const list = byBuild.get(owner);
      if (list) list.push(session);
      else byBuild.set(owner, [session]);
    }

    return [...byBuild.entries()]
      // Newest build first; "default" (null) last, since it is the oldest state.
      .sort((a, b) => (b[0] ?? -1) - (a[0] ?? -1))
      .map(([buildNumber, list]) => ({
        id: `build-${buildNumber ?? "default"}`,
        name: buildNumber != null ? `build ${buildNumber}` : "default",
        isDirectory: true,
        next: {
          ...ROOT_LOCATION,
          root: "apps" as const,
          appId: location.appId,
          // `"default"` rather than null: null is the level that lists builds,
          // so reusing it here would make this folder un-openable.
          build: buildNumber ?? ("default" as const),
        },
        meta: `${list.length} ${list.length === 1 ? "refresh" : "refreshes"}`,
      }));
  }

  // Level 3: a folder per date this build refreshed on.
  if (!location.date) {
    const dates = new Map<string, number>();
    for (const session of appSessions) {
      // Via the translator: `buildForSession` says `null` for a pre-build
      // refresh, while this level is called `"default"`.
      if (!ownedByBuildLevel(builds, session, location.build)) continue;
      const date = refreshDate(session);
      dates.set(date, (dates.get(date) ?? 0) + 1);
    }
    return [...dates.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, count]) => ({
        id: date,
        name: date,
        isDirectory: true,
        next: {
          ...ROOT_LOCATION,
          root: "apps" as const,
          appId: location.appId,
          build: location.build,
          date,
        },
        meta: count > 1 ? `${count} refreshes` : undefined,
      }));
  }

  // Level 4+: inside one refresh's outputs, following its own folder shape.
  if (!openSession) return [];

  const tree = buildFileTree(visibleFiles, openSession.session_id);
  let nodes = tree;
  if (location.inner) {
    for (const segment of location.inner.split("/")) {
      const found = nodes.find((n) => n.isDirectory && n.name === segment);
      if (!found?.children) return [];
      nodes = found.children;
    }
  }

  const byPath = new Map(visibleFiles.map((f) => [f.path, f]));

  return nodes.map((node) => {
    if (node.isDirectory) {
      const childCount = node.children?.length ?? 0;
      return {
        id: node.path,
        name: node.name,
        isDirectory: true,
        next: {
          ...location,
          inner: location.inner ? `${location.inner}/${node.name}` : node.name,
        },
        meta: `${childCount} ${childCount === 1 ? "item" : "items"}`,
      };
    }
    const file = byPath.get(node.path);
    return {
      id: node.path,
      name: node.name,
      isDirectory: false,
      size: file?.size,
      modifiedAt: file?.modified_at,
      sessionId: openSession.session_id,
      filePath: node.path,
      file,
    };
  });
}
