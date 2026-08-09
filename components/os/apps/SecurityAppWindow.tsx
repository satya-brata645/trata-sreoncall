"use client";

import { useMemo } from "react";
import { FileText } from "lucide-react";

import { cn, formatCompactRelativeTime, formatSize } from "@/lib/utils";
import { EmptyState, Icon, Row, SectionLabel, StatusDot } from "@/components/ui/primitives";
import { useProjects, useSessionFiles } from "@/lib/hooks/useComplianceData";
import { useBuilds, useSetCurrentBuild } from "@/lib/os/useBuilds";
import { useAppWakeUps } from "@/lib/os/useAppWakeUps";
import type { OsAppProps } from "@/lib/os/types";
import { AppActivityLog } from "./app/AppActivityLog";
import { AppSidebar } from "./app/AppSidebar";
import { AppWindowChromeLeading, AppWindowChromeTrailing, type SecurityPanel } from "./app/AppWindowChrome";
import { BuildHistory } from "./app/BuildHistory";

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
function panelFrom(value: string | undefined): SecurityPanel {
  if (value === "history" || value === "activity") return value;
  return "overview";
}

function severityTone(level?: string): "critical" | "high" | "medium" | "low" {
  if (level === "critical") return "critical";
  if (level === "high") return "high";
  if (level === "low") return "low";
  return "medium";
}

export function SecurityAppWindow({ params, setParams }: OsAppProps) {
  const appId = params?.appId ?? "";
  const panel = panelFrom(params?.panel);

  const { data: projectsData } = useProjects(true);
  const { data: buildsData } = useBuilds(appId || null);
  const setCurrentBuild = useSetCurrentBuild(appId || null);
  const { wakeUps, latestComplete, isLoading } = useAppWakeUps(appId || null);
  const latest = wakeUps[0] ?? null;
  const { data: filesData } = useSessionFiles(latestComplete?.session_id ?? null);

  const project = useMemo(
    () => (projectsData?.projects ?? []).find((candidate) => candidate.id === appId),
    [projectsData, appId],
  );
  const appName = project?.name ?? appId;
  const summary =
    latestComplete?.summary?.human_readable_summary ??
    latestComplete?.result_summary?.human_readable_summary;
  const files = useMemo(() => filesData?.files ?? [], [filesData]);

  if (!appId) {
    return (
      <div className="flex h-full items-center justify-center p-md">
        <EmptyState title="No app selected" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 bg-role-surface-page">
      <AppWindowChromeLeading appId={appId} appName={appName} />
      <AppWindowChromeTrailing
        panel={panel}
        onSelectPanel={(next) => setParams({ panel: next })}
        lastRefreshedAt={latestComplete?.created_at ?? null}
        isRefreshing={latest?.status === "running" || latest?.status === "in_progress"}
      />

      <AppSidebar
        appId={appId}
        appName={appName}
        description={project?.description}
        tags={project?.tags}
      />

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto pb-md">
        {panel === "overview" && (
          <div className="flex flex-col gap-md p-md">
            {!summary ? (
              <EmptyState
                title="Nothing to show yet"
                hint="This app has not produced a completed refresh yet."
              />
            ) : (
              <>
                <div className="min-w-0">
                  <h2 className="text-heading-md font-semibold text-role-content-heading">
                    {summary.headline}
                  </h2>
                  <p className="mt-2 max-w-[76ch] text-body-md text-role-content-body">
                    {summary.narrative}
                  </p>
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
                            <StatusDot tone={severityTone(summary.criticality_level)} />
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
          <BuildHistory
            builds={buildsData?.builds ?? []}
            latestBuild={buildsData?.latest_build ?? null}
            currentBuild={buildsData?.current_build ?? null}
            onMakeLive={(buildNumber) => setCurrentBuild.mutate(buildNumber)}
            isUpdating={setCurrentBuild.isPending}
          />
        )}

        {panel === "activity" && (
          <AppActivityLog wakeUps={wakeUps} isLoading={isLoading} />
        )}
      </div>
    </div>
  );
}
