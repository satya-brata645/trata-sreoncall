"use client";

import { useMemo } from "react";
import { Check, Send } from "lucide-react";

import { cn } from "@/lib/utils";
import { EmptyState, Icon, SectionLabel } from "@/components/ui/primitives";
import { AppIcon } from "@/components/os/icons/AppIcon";
import { useAppStoreCatalog } from "@/lib/hooks/useAppStore";
import type { OsAppProps } from "@/lib/os/types";

/**
 * App Store — what you have, and what you could have.
 *
 * A different query to the Launchpad's on purpose: that one is the *owned*
 * list. Two queries over the same library is the honest shape, because the
 * store must not widen what the rest of the OS thinks you can open.
 */
type Panel = "discover" | "requests";

export function AppStoreApp({ params, setParams }: OsAppProps) {
  const panel: Panel = params?.panel === "requests" ? "requests" : "discover";
  const { data, isLoading } = useAppStoreCatalog();

  const { owned, available } = useMemo(() => {
    const apps = data?.apps ?? [];
    return {
      owned: apps.filter((a) => a.enabled),
      available: apps.filter((a) => !a.enabled),
    };
  }, [data]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-none items-center gap-1 border-b border-role-border-subtle px-sm py-2">
        {(["discover", "requests"] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setParams({ panel: id })}
            className={cn(
              "rounded-xs px-2.5 py-1 text-body-sm",
              panel === id
                ? "bg-role-surface-component-selected text-role-content-heading"
                : "text-role-content-subtle hover:bg-role-surface-component-hover",
            )}
          >
            {id === "discover" ? "Discover" : "Your requests"}
          </button>
        ))}
      </div>

      {panel === "requests" ? (
        <EmptyState
          icon={Send}
          title="Nothing requested yet"
          hint="Ask for an app and its reference appears here"
        />
      ) : isLoading ? (
        <div className="flex flex-col gap-1.5 p-md">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-sm bg-role-surface-container-subtle" />
          ))}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto pb-md">
          <SectionLabel count={owned.length}>In this workspace</SectionLabel>
          <div className="flex flex-col gap-1 px-2.5">
            {owned.map((app) => (
              <StoreRow key={app.id} id={app.id} name={app.name} blurb={app.description} owned />
            ))}
          </div>
          <SectionLabel count={available.length} className="pt-md">
            Available
          </SectionLabel>
          <div className="flex flex-col gap-1 px-2.5">
            {available.map((app) => (
              <StoreRow key={app.id} id={app.id} name={app.name} blurb={app.description} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StoreRow({
  id,
  name,
  blurb,
  owned,
}: {
  id: string;
  name: string;
  blurb: string;
  owned?: boolean;
}) {
  return (
    <div className="flex items-start gap-sm rounded-sm px-2.5 py-2.5 hover:bg-role-surface-component-hover">
      {/* A store row is a product listing, so it shows the product's own mark —
          SREonCall's is its real logo. An app you are being asked to adopt and
          one you already run should look like the same thing, because they are:
          the store is the same library the Launchpad reads. */}
      <AppIcon appId={id} name={name} description={blurb} size={38} className="mt-px" />
      <div className="min-w-0 flex-1">
        <p className="text-heading-xs font-semibold text-role-content-heading">{name}</p>
        <p className="text-body-xs text-role-content-muted">{blurb}</p>
      </div>
      {owned ? (
        <span className="flex items-center gap-1.5 rounded-xs px-2 py-1 dos-label text-role-content-subtle">
          <Icon icon={Check} size={12} />
          Installed
        </span>
      ) : (
        <button
          type="button"
          className="rounded-xs bg-role-surface-action px-2.5 py-1 text-body-xs font-medium text-role-foreground-on-inverse hover:bg-role-surface-action-hover"
        >
          Request
        </button>
      )}
    </div>
  );
}
