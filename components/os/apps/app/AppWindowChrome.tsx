"use client";

import { ChromeLeading, ChromeTrailing, PanelSwitcher } from "@/components/os/apps/PanelSwitcher";
import { StatusDot } from "@/components/ui/primitives";
import { AppIcon } from "@/components/os/icons/AppIcon";
import { formatCompactRelativeTime } from "@/lib/utils";

export type SecurityPanel = "overview" | "history" | "activity";

/** Shared with the body sidebar so the divider stays one continuous line. */
export const APP_SIDEBAR_WIDTH_PX = 272;

const PANELS: ReadonlyArray<{ id: SecurityPanel; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "history", label: "Build history" },
  { id: "activity", label: "App logs" },
];

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
  panel,
  onSelectPanel,
  lastRefreshedAt,
  isRefreshing,
}: {
  panel: SecurityPanel;
  onSelectPanel: (panel: SecurityPanel) => void;
  lastRefreshedAt: string | null;
  isRefreshing: boolean;
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
      <PanelSwitcher
        panels={PANELS}
        active={panel}
        onSelect={onSelectPanel}
      />
    </ChromeTrailing>
  );
}
