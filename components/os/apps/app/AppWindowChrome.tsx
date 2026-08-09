"use client";

import { ChromeLeading, ChromeTrailing, PanelSwitcher } from "@/components/os/apps/PanelSwitcher";
import { Icon, StatusDot } from "@/components/ui/primitives";
import { appGlyph } from "@/lib/os/appGlyphs";
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
  const glyph = appGlyph(appId);

  return (
    <ChromeLeading width={APP_SIDEBAR_WIDTH_PX}>
      <span
        style={{ color: glyph.tint }}
        className="flex size-8 shrink-0 items-center justify-center rounded-xs bg-role-surface-component"
      >
        <Icon icon={glyph.icon} size={18} />
      </span>
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
