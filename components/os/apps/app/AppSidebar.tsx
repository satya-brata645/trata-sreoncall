"use client";

import { AppNotes } from "./AppNotes";
import { APP_SIDEBAR_WIDTH_PX } from "./AppWindowChrome";
import { Icon, SectionLabel } from "@/components/ui/primitives";
import { appGlyph } from "@/lib/os/appGlyphs";

export function AppSidebar({
  appId,
  appName,
  description,
  tags,
}: {
  appId: string;
  appName: string;
  description?: string | null;
  tags?: readonly string[];
}) {
  const glyph = appGlyph(appId, { name: appName, description, tags });

  return (
    <aside
      style={{ width: APP_SIDEBAR_WIDTH_PX }}
      className="flex h-full shrink-0 flex-col border-r border-role-border-subtle"
    >
      <div className="border-b border-role-border-subtle px-md py-md">
        <div className="flex items-start gap-sm">
          <span
            style={{ color: glyph.tint }}
            className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xs bg-role-surface-component"
          >
            <Icon icon={glyph.icon} size={18} />
          </span>
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

      <SectionLabel>Notes</SectionLabel>
      <div className="min-h-0 flex-1">
        {/*
          Notes live in the sidebar because the title-bar switcher is reserved
          for the app's runtime surfaces: the answer, the build lineage, and the
          activity behind it. Notes are personal context, not another state of
          the app itself.
        */}
        <AppNotes appId={appId} />
      </div>
    </aside>
  );
}
