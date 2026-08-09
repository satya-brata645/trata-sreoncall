"use client";

import { useMemo } from "react";
import { ArrowUpRight, FileText } from "lucide-react";

import { cn, formatCompactRelativeTime, formatSize } from "@/lib/utils";
import { EmptyState, Icon, Row, SectionLabel, StatusDot } from "@/components/ui/primitives";
import { appGlyph } from "@/lib/os/appGlyphs";
import { useBuilds } from "@/lib/os/useBuilds";
import { useAppWakeUps } from "@/lib/os/useAppWakeUps";
import { useSessionFiles } from "@/lib/hooks/useComplianceData";
import type { OsAppProps } from "@/lib/os/types";

/**
 * One security app, in a window.
 *
 * The registry holds a single entry for all of them — which app is showing
 * lives in `params.appId`, not in an entry per app — so adding an app to the
 * workspace never touches the OS.
 *
 * Overview is the answer, not the machinery. History and Activity are the
 * machinery, and they sit behind their own panels because "what did it find"
 * and "why did it find that" are different questions asked at different times.
 */
type Panel = "overview" | "history" | "activity";

const PANELS: Array<{ id: Panel; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "history", label: "Build history" },
  { id: "activity", label: "App logs" },
];

export function SecurityAppWindow({ params, setParams }: OsAppProps) {
  const appId = params?.appId ?? "";
  const panel: Panel =
    params?.panel === "history" || params?.panel === "activity"
      ? (params.panel as Panel)
      : "overview";

  const { data: buildsData } = useBuilds(appId || null);
  const { wakeUps, isLoading } = useAppWakeUps(appId || null);
  const latest = wakeUps[0] ?? null;
  const { data: filesData } = useSessionFiles(latest?.session_id ?? null);

  const glyph = appGlyph(appId);
  const summary = latest?.summary?.human_readable_summary;
  const files = useMemo(() => filesData?.files ?? [], [filesData]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-none items-center gap-1 border-b border-role-border-subtle px-sm py-2">
        {PANELS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setParams({ panel: p.id })}
            className={cn(
              "rounded-xs px-2.5 py-1 text-body-sm",
              panel === p.id
                ? "bg-role-surface-component-selected text-role-content-heading"
                : "text-role-content-subtle hover:bg-role-surface-component-hover",
            )}
          >
            {p.label}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-2">
          {latest?.status === "running" && <StatusDot tone="live" />}
          <span className="dos-label">
            {latest?.created_at
              ? `As of ${formatCompactRelativeTime(latest.created_at)}`
              : isLoading
                ? "Loading"
                : "Never refreshed"}
          </span>
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-md">
        {panel === "overview" && (
          <div className="flex flex-col gap-md p-md">
            {!summary ? (
              <EmptyState title="Nothing to show yet" hint="This app has not refreshed" />
            ) : (
              <>
                <div className="flex items-start gap-sm">
                  <span
                    style={{ color: glyph.tint }}
                    className="flex size-9 shrink-0 items-center justify-center rounded-xs bg-role-surface-component"
                  >
                    <Icon icon={glyph.icon} size={18} />
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-heading-md font-semibold text-role-content-heading">
                      {summary.headline}
                    </h2>
                    {/* Prose gets a measure. A window can be dragged to
                        2000px wide, and a 200-character line is unreadable
                        however good the type is. */}
                    <p className="mt-1 max-w-[76ch] text-body-md text-role-content-body">
                      {summary.narrative}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
                  {summary.key_metrics.map((metric) => (
                    <div
                      key={metric}
                      className="rounded-sm border border-role-border-subtle bg-role-surface-container-subtle px-3 py-2.5 text-body-sm text-role-content-heading"
                    >
                      {metric}
                    </div>
                  ))}
                </div>

                {summary.action_items.length > 0 && (
                  <div>
                    <SectionLabel className="px-0">Needs you</SectionLabel>
                    <div className="flex flex-col gap-1">
                      {summary.action_items.map((item) => (
                        <Row key={item} className="px-0">
                          <StatusDot
                            tone={summary.criticality_level === "critical" ? "critical" : "medium"}
                          />
                          <span className="text-body-md text-role-content-heading">{item}</span>
                        </Row>
                      ))}
                    </div>
                  </div>
                )}

                {files.length > 0 && (
                  <div>
                    <SectionLabel className="px-0" count={files.length}>
                      Outputs
                    </SectionLabel>
                    <div className="flex flex-col gap-px">
                      {files.map((file) => (
                        <Row key={file.path} className="px-0">
                          <Icon icon={FileText} size={13} className="text-role-icon-subtle" />
                          <span className="flex-1 truncate text-body-sm text-role-content-heading">
                            {file.filename}
                          </span>
                          <span className="text-body-xs text-role-content-muted">
                            {formatSize(file.size)}
                          </span>
                          <Icon
                            icon={ArrowUpRight}
                            size={13}
                            className="text-role-icon-subtle"
                          />
                        </Row>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {panel === "history" && (
          <>
            <SectionLabel count={buildsData?.builds.length ?? 0}>Builds</SectionLabel>
            <div className="flex flex-col gap-px px-2.5">
              {(buildsData?.builds ?? []).map((build) => (
                <Row key={build.number}>
                  <span className="dos-label w-14">Build {build.number}</span>
                  <span className="flex-1 text-body-sm text-role-content-heading">
                    {build.conversation_id
                      ? "Promoted from a build chat"
                      : "Shipped default"}
                  </span>
                  <span className="text-body-xs text-role-content-muted">
                    {formatCompactRelativeTime(build.promoted_at)}
                  </span>
                  {build.number === buildsData?.current_build && (
                    <span className="rounded-[5px] bg-role-surface-action px-1.5 py-px text-label-lg font-medium tracking-normal text-role-foreground-on-inverse">
                      Live
                    </span>
                  )}
                </Row>
              ))}
            </div>
          </>
        )}

        {panel === "activity" && (
          <>
            <SectionLabel count={wakeUps.length}>Wake-ups</SectionLabel>
            <div className="flex flex-col gap-px px-2.5">
              {wakeUps.map((wake) => (
                <Row key={wake.session_id} className="items-start">
                  <StatusDot tone={wake.status === "running" ? "live" : "idle"} className="mt-1.5" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body-sm text-role-content-heading">
                      {wake.title}
                    </p>
                    <span className="dos-label">
                      {wake.created_at ? formatCompactRelativeTime(wake.created_at) : "—"}
                    </span>
                  </div>
                </Row>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
