"use client";

import { ChromeLeading, ChromeTrailing } from "@/components/os/apps/PanelSwitcher";
import { StatusDot } from "@/components/ui/primitives";
import { AppIcon } from "@/components/os/icons/AppIcon";
import { formatCompactRelativeTime } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { FileText, NotebookPen, Settings2 } from "lucide-react";

/** Shared with the body sidebar so the divider stays one continuous line. */
export const APP_SIDEBAR_WIDTH_PX = 272;

export function AppWindowChromeLeading({
  appId,
  appName,
}: {
  appId: string;
  appName: string;
}) {
  return (
    <ChromeLeading width={APP_SIDEBAR_WIDTH_PX}>
      {/* The same icon the dock tile shows, so the window someone just opened is
          visibly the thing they clicked. */}
      <AppIcon appId={appId} name={appName} size={26} />
      <span className="truncate text-body-sm font-medium text-role-content-heading">
        {appName}
      </span>
    </ChromeLeading>
  );
}

export function AppWindowChromeTrailing({
  lastRefreshedAt,
  isRefreshing,
  buildLabel,
  isPinned,
  devMode,
  onDevModeChange,
  rightPanel,
  onSelectRightPanel,
  onOpenSettings,
  onOpenBuild,
}: {
  lastRefreshedAt: string | null;
  isRefreshing: boolean;
  buildLabel: string;
  isPinned: boolean;
  devMode: boolean;
  onDevModeChange: (checked: boolean) => void;
  rightPanel: "outputs" | "notes";
  onSelectRightPanel: (panel: "outputs" | "notes") => void;
  onOpenSettings: () => void;
  onOpenBuild: () => void;
}) {
  return (
    <ChromeTrailing>
      <span className="flex items-center gap-2">
        {isRefreshing && <StatusDot tone="live" />}
        <span
          className="dos-label"
          title={lastRefreshedAt ? new Date(lastRefreshedAt).toLocaleString() : undefined}
        >
          {lastRefreshedAt
            ? `As of ${formatCompactRelativeTime(lastRefreshedAt)}`
            : "Never refreshed"}
        </span>
      </span>
      <button type="button" onClick={onOpenBuild} className="rounded-2xs border border-role-border-subtle px-2 py-1 text-body-xs text-role-content-body hover:bg-role-surface-component-hover" title="Open build history">
        {buildLabel}{isPinned ? " · pinned" : " · latest"}
      </button>
      <span className="flex items-center gap-1.5 text-body-xs text-role-content-body">
        <Switch checked={devMode} onCheckedChange={onDevModeChange} aria-label="Dev Mode" />
        Dev Mode
      </span>
      {!devMode && (
        <span className="flex items-center gap-0.5">
          <button type="button" aria-label="Show outputs" aria-pressed={rightPanel === "outputs"} onClick={() => onSelectRightPanel("outputs")} className="rounded-2xs p-1.5 text-role-content-muted hover:bg-role-surface-component-hover hover:text-role-content-heading"><FileText className="size-3.5" /></button>
          <button type="button" aria-label="Show notes" aria-pressed={rightPanel === "notes"} onClick={() => onSelectRightPanel("notes")} className="rounded-2xs p-1.5 text-role-content-muted hover:bg-role-surface-component-hover hover:text-role-content-heading"><NotebookPen className="size-3.5" /></button>
        </span>
      )}
      <button type="button" aria-label="App settings" onClick={onOpenSettings} className="rounded-2xs p-1.5 text-role-content-muted hover:bg-role-surface-component-hover hover:text-role-content-heading"><Settings2 className="size-3.5" /></button>
    </ChromeTrailing>
  );
}
