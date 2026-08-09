"use client";

/**
 * The file system's model — §6 of the OS concept, as data.
 *
 * The shape is fixed by the concept note and is not negotiable:
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
 * **Why levels resolve lazily.** React hooks cannot be called in a loop, so
 * `useBuilds(appId)` and `useSessionFiles(sessionId)` cannot be fanned out across
 * every app and every refresh. That constraint happens to match how a file
 * browser should behave anyway: one org-wide session list is fetched up front to
 * know which apps exist, and everything deeper is fetched for the path you have
 * actually opened. Opening `apps/` costs nothing extra; opening one date folder
 * costs one request.
 *
 * The tree is **derived, not authored**. §6: "the file system is managed by the
 * apps and the agent autonomously… I'm not doing filing labor." There is no
 * create-folder, no move, no rename — those would be filing labor.
 */

import { useEffect, useMemo } from "react";
import { useOrganization } from "@/lib/auth/mockUser";
import { useQuery } from "@tanstack/react-query";

import { getConversationFiles } from "@/lib/api/conversations";
import { useAuthFetch } from "@/lib/hooks/useAuthFetch";
import {
  useInfiniteSessionSummariesWithRunning,
  useSessionFiles,
} from "@/lib/hooks/useComplianceData";
import { filterCustomerOutputFiles } from "@/lib/utils/output-file-visibility";
import { useBuilds } from "./useBuilds";
import {
  assembleEntries,
  ownedByBuildLevel,
  refreshDate,
  searchInRefresh,
  type FileSystemEntry,
  type FileSystemLocation,
} from "./fileSystemModel";
import type { SessionWithSummary } from "@/lib/api/types";

// Re-exported so callers have one import for the file system.
export {
  locationCrumbs,
  locationToPath,
  pathToLocation,
  ROOT_LOCATION,
  type FileSystemEntry,
  type FileSystemLocation,
  type FileSystemRoot,
} from "./fileSystemModel";

/**
 * How far back the file system looks.
 *
 * Matches `useAppWakeUps`: the session hooks default to 5 days scoped to one
 * user, which is right for "what did I do this week" and wrong here — a report
 * from six weeks ago is exactly what someone opens Files to find.
 */
const LOOKBACK_DAYS = 180;

/**
 * Cap on how many pages of sessions we will pull in.
 *
 * A page is 20 sessions org-wide, so this is 400 refreshes — well past what any
 * workspace produces in 180 days today. It exists so a pathological workspace
 * cannot spin the client forever, and `sessionsTruncated` below reports when it
 * bites rather than silently showing a partial file system.
 */
const MAX_SESSION_PAGES = 20;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface UseFileSystemResult {
  location: FileSystemLocation;
  entries: FileSystemEntry[];
  /** True while the *current* folder's contents are being fetched. */
  isLoading: boolean;
  error: unknown;
  /** Set when the session page cap was hit, so the caller can say so. */
  sessionsTruncated: boolean;
  /** Every app that has produced at least one refresh, for the tree. */
  appIds: string[];
  /** Conversations that have files, for the tree. */
  chatIds: Array<{ id: string; title: string }>;
}

/**
 * The contents of one location.
 *
 * A single hook rather than one per level, because every level's data comes from
 * the same three sources and the caller should not have to know which level it is
 * looking at.
 */
export function useFileSystem(
  location: FileSystemLocation,
  query = "",
): UseFileSystemResult {
  const { organization, isLoaded: isOrgLoaded } = useOrganization();
  const orgId = organization?.id;
  const { getAuthParams } = useAuthFetch();

  // --- Source 1: every refresh in the org, fetched once. ---

  const filter = useMemo(() => {
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - LOOKBACK_DAYS);
    return {
      // The workspace's files, not the caller's. An app belongs to the org, so
      // its outputs do too. (The backend still enforces user-only for
      // non-admins, so this is a no-op for them rather than a leak.)
      scope: "org" as const,
      startDate: isoDate(start),
      endDate: isoDate(end),
    };
  }, []);

  const sessionsResult = useInfiniteSessionSummariesWithRunning(filter);
  const {
    isLoading: sessionsLoading,
    isLoadingMore,
    hasMore,
    loadMore,
  } = sessionsResult;

  const sessions: SessionWithSummary[] = useMemo(
    () => sessionsResult.data?.sessions ?? [],
    [sessionsResult.data],
  );

  const pagesLoaded = Math.ceil(sessions.length / 20);
  const atPageCap = pagesLoaded >= MAX_SESSION_PAGES;

  /**
   * Page until the window is exhausted.
   *
   * Unlike `useAppWakeUps`, which stops as soon as its one app appears, the file
   * system needs the whole window: it lists *every* app that has outputs, so
   * stopping early would hide apps rather than merely delay them.
   *
   * Still a stopgap for the same reason documented there — the real fix is
   * server-side filtering on `GET /project/sessions`.
   */
  useEffect(() => {
    if (sessionsLoading || isLoadingMore || !hasMore) return;
    if (atPageCap) return;
    loadMore();
  }, [sessionsLoading, isLoadingMore, hasMore, atPageCap, loadMore]);

  /** Refreshes per app, newest first. */
  const sessionsByApp = useMemo(() => {
    const byApp = new Map<string, SessionWithSummary[]>();
    for (const session of sessions) {
      const appId = session.project_id;
      if (!appId) continue;
      // A refresh with no date cannot be placed in the date level, and a file
      // you cannot locate is worse than one that is absent.
      if (!refreshDate(session)) continue;
      const list = byApp.get(appId);
      if (list) list.push(session);
      else byApp.set(appId, [session]);
    }
    for (const list of byApp.values()) {
      list.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
    }
    return byApp;
  }, [sessions]);

  const appIds = useMemo(
    () => [...sessionsByApp.keys()].sort((a, b) => a.localeCompare(b)),
    [sessionsByApp],
  );

  // --- Source 2: the opened app's builds. ---

  const {
    data: buildsData,
    isLoading: buildsLoading,
    error: buildsError,
  } = useBuilds(location.root === "apps" ? location.appId : null);

  const builds = useMemo(() => buildsData?.builds ?? [], [buildsData]);

  // --- Source 3: conversation files, for the chat root. ---

  const {
    data: chatData,
    isLoading: chatLoading,
    error: chatError,
  } = useQuery({
    queryKey: ["conversation-files", orgId ?? "personal"],
    queryFn: async () => getConversationFiles(await getAuthParams()),
    enabled: isOrgLoaded,
  });

  const chatIds = useMemo(
    () =>
      (chatData?.conversations ?? []).map((c) => ({
        id: c.conversation_id,
        title: c.title || c.conversation_id.slice(0, 8),
      })),
    [chatData],
  );

  // --- Source 4: the opened refresh's files. ---

  /**
   * Which refresh the opened date folder means.
   *
   * A build can have several refreshes on one day; the newest is the one whose
   * outputs the folder shows, matching what the app itself displays.
   */
  const openSession = useMemo(() => {
    if (location.root !== "apps" || !location.appId || !location.date) return null;
    const forApp = sessionsByApp.get(location.appId) ?? [];
    return (
      forApp.find(
        (s) =>
          refreshDate(s) === location.date &&
          ownedByBuildLevel(builds, s, location.build),
      ) ?? null
    );
  }, [location, sessionsByApp, builds]);

  const {
    data: filesData,
    isLoading: filesLoading,
    error: filesError,
  } = useSessionFiles(openSession?.session_id ?? null);

  /** The visibility gate every file surface applies. */
  const visibleFiles = useMemo(() => {
    const raw = filesData?.files ?? [];
    return filterCustomerOutputFiles(raw, {
      email: undefined,
      isProd: process.env.NEXT_PUBLIC_APP_ENV === "production",
    });
  }, [filesData]);

  // --- Assemble the current folder. ---

  const folderEntries = assembleEntries({
    location,
    appIds,
    chatIds,
    chatConversations: chatData?.conversations ?? [],
    sessionsByApp,
    builds,
    openSession,
    visibleFiles,
  });

  /**
   * What the list shows: the folder, or the search result.
   *
   * Inside a refresh the search descends — every file in that refresh is already
   * loaded, so "and everything below it" is answerable without another request.
   * Above that level the tree is lazy, so the query filters the rows on screen;
   * searching every app would mean fetching the whole workspace per keystroke.
   */
  const entries = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) return folderEntries;

    if (location.date && openSession) {
      return searchInRefresh({
        location,
        visibleFiles,
        openSession,
        query: trimmed,
      });
    }

    const terms = trimmed.toLowerCase().split(/\s+/);
    return folderEntries.filter((entry) =>
      terms.every((term) => entry.name.toLowerCase().includes(term)),
    );
  }, [folderEntries, query, location, openSession, visibleFiles]);

  /**
   * Loading state for *this* folder only.
   *
   * A level that needs no request must not inherit a spinner from one that does —
   * `apps/` is already known once sessions land, and showing it as loading while
   * a deeper query runs is what makes a browser feel slow.
   */
  const isLoading = useMemo(() => {
    if (!location.root) return sessionsLoading;
    if (location.root === "chat") return chatLoading;
    if (!location.appId) return sessionsLoading || isLoadingMore;
    if (location.date) return filesLoading;
    return sessionsLoading || isLoadingMore || buildsLoading;
  }, [
    location,
    sessionsLoading,
    isLoadingMore,
    chatLoading,
    buildsLoading,
    filesLoading,
  ]);

  const error = useMemo(() => {
    if (location.root === "chat") return chatError;
    if (location.date) return filesError;
    if (location.appId) return buildsError;
    return null;
  }, [location, chatError, filesError, buildsError]);

  return {
    location,
    entries,
    isLoading,
    error,
    sessionsTruncated: atPageCap && hasMore,
    appIds,
    chatIds,
  };
}
