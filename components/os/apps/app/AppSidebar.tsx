"use client";

import { APP_SIDEBAR_WIDTH_PX } from "./AppWindowChrome";
import { SectionLabel } from "@/components/ui/primitives";
import { AppIcon } from "@/components/os/icons/AppIcon";
import { cn } from "@/lib/utils";
import { MessageSquare, ScrollText, History } from "lucide-react";

export type DevPanel = "chat" | "history" | "activity";

export function AppSidebar({
  appId,
  appName,
  description,
  tags,
  panel,
  onSelectPanel,
}: {
  appId: string;
  appName: string;
  description?: string | null;
  tags?: readonly string[];
  panel: DevPanel;
  onSelectPanel: (panel: DevPanel) => void;
}) {
  return (
    <aside
      style={{ width: APP_SIDEBAR_WIDTH_PX }}
      className="flex h-full shrink-0 flex-col border-r border-role-border-subtle"
    >
      <div className="border-b border-role-border-subtle px-md py-md">
        <div className="flex items-start gap-sm">
          <AppIcon
            appId={appId}
            name={appName}
            description={description}
            tags={tags}
            size={36}
            className="mt-0.5"
          />
          <div className="min-w-0">
            <h2 className="truncate text-heading-xs font-semibold text-role-content-heading">
              {appName}
            </h2>
            {description && (
              <p className="mt-1 text-body-xs text-role-content-muted">
                {description}
              </p>
            )}
          </div>
        </div>

        {tags && tags.length > 0 && (
          <div className="mt-sm flex flex-wrap gap-1.5">
            {tags.slice(0, 6).map((tag) => (
              <span
                key={tag}
                className="rounded-[5px] bg-role-surface-component px-[5px] py-[1px] text-label-lg font-medium tracking-normal text-role-content-subtle"
              >
                {tag.replace(/^[^:]+:/, "")}
              </span>
            ))}
          </div>
        )}
      </div>

      <SectionLabel>Build</SectionLabel>
      <nav className="flex flex-col gap-1 px-xs" aria-label="Build tools">
        {[
          { id: "chat" as const, label: "Build chat", icon: MessageSquare },
          { id: "history" as const, label: "Build history", icon: History },
          { id: "activity" as const, label: "App logs", icon: ScrollText },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelectPanel(item.id)}
            className={cn(
              "flex h-8 items-center gap-2 rounded-2xs px-sm text-left text-body-sm transition-colors",
              panel === item.id
                ? "bg-role-surface-component-selected text-role-content-heading"
                : "text-role-content-subtle hover:bg-role-surface-component-hover hover:text-role-content-body",
            )}
          >
            <item.icon className="size-3.5" aria-hidden />
            {item.label}
          </button>
        ))}
      </nav>
    </aside>
  );
}
