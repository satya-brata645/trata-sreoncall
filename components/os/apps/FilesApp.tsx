"use client";

import { useMemo } from "react";
import { ChevronRight, File, Folder, Search } from "lucide-react";

import { cn, formatCompactRelativeTime, formatSize } from "@/lib/utils";
import { EmptyState, Icon, Row } from "@/components/ui/primitives";
import { fileGlyph } from "@/lib/os/fileGlyphs";
import {
  locationCrumbs,
  locationToPath,
  pathToLocation,
  ROOT_LOCATION,
  useFileSystem,
} from "@/lib/os/useFileSystem";
import type { OsAppProps } from "@/lib/os/types";

/**
 * Files — the frozen half.
 *
 * In-app content is live; files are snapshots. That line is the whole reason
 * this app exists separately from the apps themselves: a snapshot is citable,
 * shareable and defensible, and a live dashboard is none of those.
 *
 * The tree is derived, not authored. There is no new folder, no move, no
 * rename — those would be filing labour, and the file system is managed by the
 * apps and the agent.
 *
 * Location is an `affordance` rather than local state, so the agent can put
 * someone in front of a file instead of telling them how to find it.
 */
export function FilesApp({ params, setParams }: OsAppProps) {
  const location = useMemo(
    () => pathToLocation(params?.location ?? "") ?? ROOT_LOCATION,
    [params?.location],
  );
  const query = params?.search ?? "";
  const { entries, isLoading, appIds, chatIds, sessionsTruncated } = useFileSystem(
    location,
    query,
  );

  /** Conversations are addressed by id but read by title. */
  const crumbs = locationCrumbs(
    location,
    (appId) => chatIds.find((c) => c.id === appId)?.title ?? appId,
  );

  return (
    <div className="flex h-full min-h-0">
      {/* Tree — the two roots, never more. */}
      <div className="flex w-[168px] flex-none flex-col gap-px overflow-y-auto border-r border-role-border-subtle p-2.5">
        {(["apps", "chat"] as const).map((root) => (
          <button
            key={root}
            type="button"
            onClick={() => setParams({ location: `/${root}` })}
            className={cn(
              "flex items-center gap-2 rounded-xs px-2 py-1.5 text-body-sm text-role-content-body hover:bg-role-surface-component-hover",
              location.root === root && "bg-role-surface-component-selected text-role-content-heading",
            )}
          >
            <Icon icon={Folder} size={13} className="text-role-icon-subtle" />
            {root}
          </button>
        ))}
        <div className="mt-2 flex flex-col gap-px">
          {(location.root === "chat" ? chatIds.map((c) => ({ id: c.id, name: c.title })) : appIds.map((id) => ({ id, name: id }))).map(
            (item) => (
              <button
                key={item.id}
                type="button"
                onClick={() =>
                  setParams({ location: `/${location.root ?? "apps"}/${item.id}` })
                }
                className={cn(
                  "truncate rounded-xs px-2 py-1 pl-[26px] text-left text-body-xs text-role-content-muted hover:bg-role-surface-component-hover hover:text-role-content-body",
                  location.appId === item.id && "text-role-content-heading",
                )}
              >
                {item.name}
              </button>
            ),
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Address + search. One control for the whole path: five separate ones
            could contradict each other and land the window somewhere nobody
            navigated to. */}
        <div className="flex flex-none items-center gap-2 border-b border-role-border-subtle px-sm py-2">
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
            {crumbs.map((crumb, i) => (
              <span key={crumb.label + i} className="flex min-w-0 items-center gap-1">
                {i > 0 && (
                  <Icon icon={ChevronRight} size={12} className="text-role-icon-subtle" />
                )}
                <button
                  type="button"
                  onClick={() => setParams({ location: locationToPath(crumb.location) })}
                  className={cn(
                    "truncate rounded-[7px] px-1.5 py-0.5 text-body-sm hover:bg-role-surface-component-hover",
                    i === crumbs.length - 1
                      ? "text-role-content-heading"
                      : "text-role-content-muted",
                  )}
                >
                  {crumb.label}
                </button>
              </span>
            ))}
          </div>
          <div className="flex w-[168px] flex-none items-center gap-2 rounded-xs border border-role-border-subtle bg-role-surface-container-subtle px-2 py-1">
            <Icon icon={Search} size={13} className="text-role-icon-muted" />
            <input
              value={query}
              onChange={(e) => setParams({ search: e.target.value })}
              placeholder="Find a file"
              className="min-w-0 flex-1 bg-transparent text-body-xs text-role-content-heading outline-none placeholder:text-role-content-placeholder"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
          {isLoading ? (
            <div className="flex flex-col gap-1">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-9 animate-pulse rounded-sm bg-role-surface-container-subtle"
                />
              ))}
            </div>
          ) : entries.length === 0 ? (
            <EmptyState title="Nothing here" hint="Files appear as apps produce them" />
          ) : (
            entries.map((entry) => {
              const glyph = entry.isDirectory ? null : fileGlyph(entry.name);
              return (
                <Row
                  key={entry.id}
                  onClick={
                    entry.next
                      ? () => setParams({ location: locationToPath(entry.next!) })
                      : undefined
                  }
                >
                  {entry.isDirectory ? (
                    <Icon icon={Folder} size={13} className="text-role-icon-muted" />
                  ) : glyph ? (
                    <span
                      style={{ background: glyph.tint }}
                      className="flex h-[18px] w-6 shrink-0 items-center justify-center rounded-[4px] text-[7px] font-semibold tracking-[0.06em] text-white"
                    >
                      {glyph.label}
                    </span>
                  ) : (
                    <Icon icon={File} size={13} className="text-role-icon-muted" />
                  )}
                  <span className="flex-1 truncate text-body-sm text-role-content-heading">
                    {entry.name}
                  </span>
                  {entry.meta && (
                    <span className="text-body-xs text-role-content-muted">{entry.meta}</span>
                  )}
                  {entry.size !== undefined && (
                    <span className="text-body-xs text-role-content-muted">
                      {formatSize(entry.size)}
                    </span>
                  )}
                  {entry.modifiedAt && (
                    <span className="w-[84px] shrink-0 text-right text-body-xs text-role-content-muted">
                      {formatCompactRelativeTime(entry.modifiedAt)}
                    </span>
                  )}
                </Row>
              );
            })
          )}

          {sessionsTruncated && (
            <p className="px-2.5 pt-md text-body-xs text-role-content-muted">
              Showing the most recent refreshes only — older ones exist but were not loaded.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
