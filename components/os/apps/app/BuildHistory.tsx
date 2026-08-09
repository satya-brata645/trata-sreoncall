"use client";

import { Check, RotateCcw } from "lucide-react";

import { EmptyState, Icon, Row, StatusDot } from "@/components/ui/primitives";
import type { Build } from "@/lib/api/builds";
import { cn, formatCompactRelativeTime } from "@/lib/utils";

function sourceLabel(build: Build): string {
  return build.conversation_id
    ? `Build chat ${build.conversation_id.slice(0, 8)}`
    : "Shipped default";
}

export function BuildHistory({
  builds,
  latestBuild,
  currentBuild,
  onMakeLive,
  isUpdating = false,
}: {
  builds: Build[];
  latestBuild: number | null;
  currentBuild: number | null;
  onMakeLive: (buildNumber: number) => void;
  isUpdating?: boolean;
}) {
  if (builds.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-md">
        <EmptyState
          title="Running the shipped default"
          hint="Nothing has been promoted for this app yet."
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-md">
      {currentBuild !== null && latestBuild !== null && currentBuild !== latestBuild && (
        <p className="mb-md rounded-sm border border-role-border-subtle bg-role-surface-container-subtle px-3 py-2 text-body-sm text-role-content-heading">
          Live build is {currentBuild}. Latest build is {latestBuild}, so this app is pinned to an older version.
        </p>
      )}

      <div className="flex flex-col gap-px">
        {builds.map((build) => {
          const isCurrent = build.number === currentBuild;
          const isLatest = build.number === latestBuild;

          return (
            <Row
              key={build.number}
              selected={isCurrent}
              className="items-start gap-md"
            >
              <div className="flex min-w-0 flex-1 items-start gap-sm">
                <StatusDot tone={isCurrent ? "live" : "idle"} className="mt-1.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-body-sm font-medium text-role-content-heading">
                      Build {build.number}
                    </span>
                    {isCurrent && (
                      <span className="rounded-[5px] bg-role-surface-action px-[5px] py-[1px] text-label-lg font-medium tracking-normal text-role-foreground-on-inverse">
                        Live
                      </span>
                    )}
                    {isLatest && !isCurrent && (
                      <span className="rounded-[5px] bg-role-surface-component px-[5px] py-[1px] text-label-lg font-medium tracking-normal text-role-content-subtle">
                        Latest
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-body-sm text-role-content-body">
                    {sourceLabel(build)}
                  </p>
                  <p className="mt-1 text-body-xs text-role-content-muted">
                    Promoted {formatCompactRelativeTime(build.promoted_at)}
                    {build.promoted_by ? ` by ${build.promoted_by}` : ""}
                  </p>
                </div>
              </div>

              {isCurrent ? (
                <span className="mt-0.5 flex shrink-0 items-center gap-1 text-body-xs text-role-content-muted">
                  <Icon icon={Check} size={12} />
                  Current
                </span>
              ) : (
                <button
                  type="button"
                  disabled={isUpdating}
                  onClick={() => onMakeLive(build.number)}
                  className={cn(
                    "mt-0.5 flex shrink-0 items-center gap-1 rounded-2xs border border-role-border-subtle px-xs py-3xs text-body-xs text-role-content-body transition-colors",
                    "hover:bg-role-surface-component-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-role-border-focus",
                    isUpdating && "opacity-50",
                  )}
                >
                  <Icon icon={RotateCcw} size={12} />
                  Make live
                </button>
              )}
            </Row>
          );
        })}
      </div>
    </div>
  );
}
