"use client";

import { useMemo } from "react";
import { EmptyState } from "@/components/ui/primitives";
import { useProjects } from "@/lib/hooks/useComplianceData";
import { useBuilds, useSetCurrentBuild } from "@/lib/os/useBuilds";
import { useAppWakeUps } from "@/lib/os/useAppWakeUps";
import type { OsAppProps } from "@/lib/os/types";
import { ArtifactSurface } from "@/components/disco/ArtifactSurface";
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

export function SecurityAppWindow({ params, setParams }: OsAppProps) {
  const appId = params?.appId ?? "";
  const panel = panelFrom(params?.panel);

  const { data: projectsData } = useProjects(true);
  const { data: buildsData } = useBuilds(appId || null);
  const setCurrentBuild = useSetCurrentBuild(appId || null);
  const { wakeUps, latestComplete, isLoading } = useAppWakeUps(appId || null);
  const latest = wakeUps[0] ?? null;

  const project = useMemo(
    () => (projectsData?.projects ?? []).find((candidate) => candidate.id === appId),
    [projectsData, appId],
  );
  const appName = project?.name ?? appId;

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
          <ArtifactSurface initial={null} />
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
