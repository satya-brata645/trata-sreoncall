"use client";

import { useMemo } from "react";
import { Search } from "lucide-react";

import { cn, formatCompactRelativeTime } from "@/lib/utils";
import { Icon, EmptyState } from "@/components/ui/primitives";
import { appGlyph } from "@/lib/os/appGlyphs";
import { useProjects, useInfiniteSessionSummariesWithRunning } from "@/lib/hooks/useComplianceData";
import { useWindowManager } from "@/lib/os/WindowManagerContext";
import { SECURITY_APP_ID } from "@/lib/os/registry";
import type { OsAppProps } from "@/lib/os/types";

/**
 * Apps — the durable surfaces.
 *
 * There is no concept of runs. You do not launch an app and wait for a result;
 * you open it and the answer is already there, which is the whole time-to-value
 * claim. What each tile therefore has to carry is *as of when* — no-runs
 * promises always-live, and the moment that promise breaks silently someone is
 * making a decision on stale data.
 *
 * Search is an `affordance`, not local state, so the agent can narrow this grid
 * rather than describing where in it something sits.
 */
export function LaunchpadApp({ params, setParams }: OsAppProps) {
  const query = params?.search ?? "";
  const { data, isLoading } = useProjects();
  const { data: sessionData } = useInfiniteSessionSummariesWithRunning();
  const { openApp } = useWindowManager();

  /** Newest wake-up per app — the freshness stamp, and whether one is running. */
  const freshness = useMemo(() => {
    const map = new Map<string, { at: string; running: boolean }>();
    for (const session of sessionData?.sessions ?? []) {
      const at = session.created_at ?? "";
      const current = map.get(session.project_id);
      if (!current || at > current.at) {
        map.set(session.project_id, { at, running: session.status === "running" });
      }
    }
    return map;
  }, [sessionData]);

  const apps = useMemo(() => {
    const all = data?.projects ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (app) =>
        app.name.toLowerCase().includes(q) ||
        app.description.toLowerCase().includes(q) ||
        (app.tags ?? []).some((tag) => tag.toLowerCase().includes(q)),
    );
  }, [data, query]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-none items-center gap-2.5 border-b border-role-border-subtle px-md py-2.5">
        <Icon icon={Search} className="text-role-icon-muted" />
        <input
          value={query}
          onChange={(e) => setParams({ search: e.target.value })}
          placeholder="Search apps"
          className="min-w-0 flex-1 bg-transparent text-body-md text-role-content-heading outline-none placeholder:text-role-content-placeholder"
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2.5 p-md">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-[92px] animate-pulse rounded-sm bg-role-surface-container-subtle"
            />
          ))}
        </div>
      ) : apps.length === 0 ? (
        <EmptyState title="No app matches that" hint="Try a capability, not a name" />
      ) : (
        /* `auto-fill` rather than a fixed column count: the window is
           resizable, and two columns at full width stretch each tile into a
           banner with three words in it. */
        <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2.5 overflow-y-auto p-md">
          {apps.map((app) => {
            const fresh = freshness.get(app.id);
            const glyph = appGlyph(app.id);
            return (
              <button
                key={app.id}
                type="button"
                onDoubleClick={() =>
                  openApp(SECURITY_APP_ID, { params: { appId: app.id }, title: app.name })
                }
                onClick={() =>
                  openApp(SECURITY_APP_ID, { params: { appId: app.id }, title: app.name })
                }
                className="flex flex-col gap-2 rounded-sm border border-role-border-subtle bg-role-surface-container-subtle p-3 text-left transition-colors hover:border-role-border hover:bg-role-surface-container"
              >
                <div className="flex items-center gap-2.5">
                  <span
                    style={{ color: glyph.tint }}
                    className="flex size-8 items-center justify-center rounded-xs bg-role-surface-component"
                  >
                    <Icon icon={glyph.icon} size={17} />
                  </span>
                  <span className="truncate text-heading-xs font-semibold text-role-content-heading">
                    {app.name}
                  </span>
                  {fresh?.running && (
                    <span className="ml-auto flex items-center gap-1.5">
                      <span className="size-1.5 animate-dos-pulse rounded-full bg-[var(--dos-violet)]" />
                      <span className="dos-label text-role-content-subtle">Live</span>
                    </span>
                  )}
                </div>
                <p className="line-clamp-2 text-body-xs text-role-content-muted">
                  {app.description}
                </p>
                <span className={cn("dos-label", !fresh && "text-role-content-placeholder")}>
                  {fresh
                    ? `As of ${formatCompactRelativeTime(fresh.at)}`
                    : "Never refreshed"}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
