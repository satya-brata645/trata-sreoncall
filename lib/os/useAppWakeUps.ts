"use client";

import { useEffect, useMemo } from "react";

import { useInfiniteSessionSummariesWithRunning } from "@/lib/hooks/useComplianceData";
import type { SessionWithSummary } from "@/lib/api/types";

/**
 * How far back to look for an app's wake-ups.
 *
 * The session hooks default to a 5-day window scoped to the calling user, which
 * is right for a "what did I do this week" list and wrong here: an app that
 * woke up 8 days ago would look like it had never run, and the freshness stamp
 * — the thing §4 says is mandatory — would be blank on exactly the quiet apps
 * where staleness matters most.
 */
const LOOKBACK_DAYS = 180;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * An app's wake-ups, newest first.
 *
 * A session *is* the app waking up to refresh its dashboard — runs are
 * self-managed, not user-launched — so this is the app's activity log and the
 * source of both the freshness stamp and the dashboard currently on screen.
 *
 * Scoped to the org rather than the caller: the app is the workspace's, and its
 * last refresh is a fact about the app, not about who happened to be looking.
 * (The backend still enforces user-only for non-admins, so this is a no-op for
 * them rather than a leak.)
 */
export function useAppWakeUps(appId: string | null) {
  const filter = useMemo(() => {
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - LOOKBACK_DAYS);
    return {
      scope: "org" as const,
      startDate: isoDate(start),
      endDate: isoDate(end),
    };
  }, []);

  const result = useInfiniteSessionSummariesWithRunning(filter, {
    enabled: !!appId,
  });
  // Destructured so the paging effect below can depend on these values rather
  // than on `result`, which is a fresh object every render.
  const { isLoading, isLoadingMore, hasMore, loadMore } = result;

  const wakeUps = useMemo(() => {
    const all: SessionWithSummary[] = result.data?.sessions ?? [];
    return all
      .filter((s) => s.project_id === appId)
      .sort((a, b) =>
        (b.created_at ?? "").localeCompare(a.created_at ?? ""),
      );
  }, [result.data, appId]);

  /**
   * Keep paging until this app appears, or the list is exhausted.
   *
   * The filter above runs over whatever pages are loaded, and a page is 20
   * sessions across the *whole org*. So an app whose newest wake-up is not among
   * the 20 most recent would read "never refreshed" — reintroducing, through
   * pagination, exactly the staleness the 180-day window above exists to
   * prevent. A busy workspace makes that the common case, not the edge one.
   *
   * This is a stopgap. The real fix is a `project_id` filter on
   * `GET /project/sessions` so the server answers the question being asked
   * instead of the client discarding 19 rows in 20.
   */
  useEffect(() => {
    if (!appId) return;
    if (wakeUps.length > 0) return;
    if (isLoading || isLoadingMore || !hasMore) return;
    loadMore();
  }, [appId, wakeUps.length, isLoading, isLoadingMore, hasMore, loadMore]);

  /**
   * The wake-up whose dashboard the app should show: the most recent one that
   * actually finished. A running or failed refresh must not blank the screen —
   * the last good dashboard stays up, which is why the freshness stamp exists.
   */
  const latestComplete = useMemo(
    () =>
      wakeUps.find(
        (s) => s.status === "completed" || s.status === "complete",
      ) ?? null,
    [wakeUps],
  );

  return {
    wakeUps,
    latestComplete,
    // `isPending` is deliberately excluded: TanStack keeps it true forever while
    // a query is disabled, which would report a permanent load rather than "no
    // app selected". Also true while paging, so the caller does not flash an
    // empty state before the search for this app's wake-ups finishes.
    isLoading: isLoading || isLoadingMore,
    loadMore,
    hasMore,
  };
}
