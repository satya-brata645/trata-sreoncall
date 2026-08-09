"use client";

import { useMemo, useState } from "react";

import { EmptyState } from "@/components/ui/primitives";
import { useProjects } from "@/lib/hooks/useComplianceData";
import { useBuilds, usePromoteBuild, useSetCurrentBuild } from "@/lib/os/useBuilds";
import { useAppWakeUps } from "@/lib/os/useAppWakeUps";
import type { OsAppProps } from "@/lib/os/types";
import { ArtifactSurface } from "@/components/disco/artifact-surface";
import { parseSpec } from "@disco/core/spec";
import sreSpec from "@/artifacts/specs/sreoncall.json";
import sreDashboard from "@/artifacts/runs/2026-08-09T12-00-00-000Z/dashboard.json";
import { rebind } from "@/lib/artifacts/rebind";
import type { RunDocument } from "@/lib/artifacts/read";
import { AppActivityLog } from "./app/AppActivityLog";
import { AppBuildChat } from "./app/AppBuildChat";
import { AppRightPanel } from "./app/AppRightPanel";
import { AppSidebar, type DevPanel } from "./app/AppSidebar";
import { AppWindowChromeLeading, AppWindowChromeTrailing } from "./app/AppWindowChrome";
import { BuildHistory } from "./app/BuildHistory";

const DEV_PANEL: readonly DevPanel[] = ["chat", "history", "activity"];
const SRE_SPEC = parseSpec(sreSpec);
const { document: _seedDocument, ...SRE_INITIAL } = rebind(SRE_SPEC, sreDashboard as RunDocument);

function initialDevPanel(value: string | undefined): DevPanel {
  return DEV_PANEL.includes(value as DevPanel) ? value as DevPanel : "chat";
}

function ResizableDivider({ onResize }: { onResize: (delta: number) => void }) {
  return <div
    role="separator"
    aria-orientation="vertical"
    aria-label="Resize panel"
    onPointerDown={(event) => {
      let last = event.clientX;
      const move = (next: PointerEvent) => { onResize(next.clientX - last); last = next.clientX; };
      const stop = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); };
      window.addEventListener("pointermove", move); window.addEventListener("pointerup", stop);
    }}
    className="z-10 w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-role-border-focus focus:bg-role-border-focus"
  />;
}

/**
 * The MCS-shaped app window: the live answer always occupies the large centre
 * surface. Build machinery exists only in Dev Mode; files and notes exist only
 * outside it. That is a mode switch, not a route change, so the dashboard is
 * never unmounted while someone changes how they work on it.
 */
export function SecurityAppWindow({ params, setParams }: OsAppProps) {
  const appId = params?.appId ?? "";
  const [devMode, setDevMode] = useState(false);
  const [devPanel, setDevPanel] = useState<DevPanel>(() => initialDevPanel(params?.panel));
  const [rightPanel, setRightPanel] = useState<"outputs" | "notes">("outputs");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [refreshRate, setRefreshRate] = useState("off");
  const [navWidth, setNavWidth] = useState(240);
  const [workWidth, setWorkWidth] = useState(380);
  const [rightWidth, setRightWidth] = useState(320);

  const { data: projectsData } = useProjects(true);
  const { data: buildsData } = useBuilds(appId || null);
  const promoteBuild = usePromoteBuild(appId || null);
  const setCurrentBuild = useSetCurrentBuild(appId || null);
  const { wakeUps, latestComplete, isLoading } = useAppWakeUps(appId || null);
  const latest = wakeUps[0] ?? null;
  const project = useMemo(() => (projectsData?.projects ?? []).find((candidate) => candidate.id === appId), [projectsData, appId]);
  const appName = project?.name ?? appId;
  const latestBuild = buildsData?.latest_build ?? null;
  const currentBuild = buildsData?.current_build ?? null;
  const buildLabel = currentBuild === null ? "Shipped default" : `Build ${currentBuild}`;
  const isPinned = currentBuild !== null && latestBuild !== null && currentBuild !== latestBuild;

  const changeDevMode = (next: boolean) => {
    setDevMode(next);
    if (!next) setParams({ panel: "overview" });
    else setParams({ panel: devPanel });
  };
  const selectDevPanel = (next: DevPanel) => { setDevPanel(next); setParams({ panel: next }); };
  const saveRefreshRate = async (next: string) => {
    setRefreshRate(next);
    if (next === "off") await fetch(`/api/schedule/${encodeURIComponent(appId)}`, { method: "DELETE" });
    else await fetch(`/api/schedule/${encodeURIComponent(appId)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ interval_seconds: Number(next), enabled: true }) });
  };

  if (!appId) return <div className="flex h-full items-center justify-center p-md"><EmptyState title="No app selected" /></div>;

  return <div className="flex h-full min-w-0 bg-role-surface-page">
    <AppWindowChromeLeading appId={appId} appName={appName} />
    <AppWindowChromeTrailing
      lastRefreshedAt={latestComplete?.created_at ?? null}
      isRefreshing={latest?.status === "running" || latest?.status === "in_progress"}
      buildLabel={buildLabel}
      isPinned={isPinned}
      devMode={devMode}
      onDevModeChange={changeDevMode}
      rightPanel={rightPanel}
      onSelectRightPanel={setRightPanel}
      onOpenSettings={() => setSettingsOpen((open) => !open)}
      onOpenBuild={() => { setDevMode(true); selectDevPanel("history"); }}
    />

    {devMode && <><div style={{ width: navWidth }} className="shrink-0"><AppSidebar appId={appId} appName={appName} description={project?.description} tags={project?.tags} panel={devPanel} onSelectPanel={selectDevPanel} /></div><ResizableDivider onResize={(delta) => setNavWidth((width) => Math.max(180, Math.min(360, width + delta)))} /></>}

    {devMode && <><section style={{ width: workWidth }} className="min-h-0 shrink-0 border-r border-role-border-subtle bg-role-surface-page">
      {devPanel === "chat" && <AppBuildChat appName={appName} onPromote={() => promoteBuild.mutate({})} />}
      {devPanel === "history" && <BuildHistory builds={buildsData?.builds ?? []} latestBuild={latestBuild} currentBuild={currentBuild} onMakeLive={(number) => setCurrentBuild.mutate(number)} isUpdating={setCurrentBuild.isPending} />}
      {devPanel === "activity" && <AppActivityLog wakeUps={wakeUps} isLoading={isLoading} />}
    </section><ResizableDivider onResize={(delta) => setWorkWidth((width) => Math.max(320, Math.min(720, width + delta)))} /></>}

    <main className="flex min-w-0 flex-1 flex-col overflow-hidden"><ArtifactSurface spec={SRE_SPEC} initial={SRE_INITIAL} fill="parent" /></main>
    {!devMode && <><ResizableDivider onResize={(delta) => setRightWidth((width) => Math.max(280, Math.min(560, width - delta)))} /><div style={{ width: rightWidth }} className="shrink-0"><AppRightPanel appId={appId} sessionId={latestComplete?.session_id ?? null} panel={rightPanel} buildLabel={buildLabel} /></div></>}

    {settingsOpen && <div className="absolute right-12 top-11 z-30 w-64 rounded-sm border border-role-border-subtle bg-role-surface-page p-md shadow-lg" data-os-window-no-drag>
      <p className="text-body-sm font-medium text-role-content-heading">Refresh cadence</p>
      <p className="mt-1 text-body-xs text-role-content-muted">Development rates are visible only while configuring this app.</p>
      <label className="mt-sm block text-body-xs text-role-content-body" htmlFor="refresh-rate">Refresh</label>
      <select id="refresh-rate" value={refreshRate} onChange={(event) => void saveRefreshRate(event.target.value)} className="mt-1 w-full rounded-2xs border border-role-border-subtle bg-transparent p-2 text-body-sm text-role-content-body">
        <option value="off">Not refreshing</option>{devMode && <><option value="60">Every minute (development)</option><option value="300">Every 5 minutes (development)</option></>}<option value="3600">Hourly</option>
      </select>
    </div>}
  </div>;
}
