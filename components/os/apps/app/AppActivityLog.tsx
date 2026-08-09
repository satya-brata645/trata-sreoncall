"use client";

import { EmptyState, Row, StatusDot } from "@/components/ui/primitives";
import type { SessionWithSummary } from "@/lib/api/types";
import { formatCompactRelativeTime } from "@/lib/utils";

function toneFor(status?: string): "live" | "critical" | "idle" {
  if (status === "running" || status === "in_progress") return "live";
  if (status === "failed" || status === "error") return "critical";
  return "idle";
}

function labelFor(status?: string): string {
  if (!status) return "unknown";
  if (status === "in_progress") return "running";
  return status.replace(/_/g, " ");
}

export function AppActivityLog({
  wakeUps,
  isLoading = false,
}: {
  wakeUps: SessionWithSummary[];
  isLoading?: boolean;
}) {
  if (isLoading && wakeUps.length === 0) {
    return <p className="p-md text-body-sm text-role-content-muted">Loading...</p>;
  }

  if (wakeUps.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-md">
        <EmptyState
          title="No activity yet"
          hint="This app has not refreshed yet."
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-md">
      <div className="flex flex-col gap-px">
        {wakeUps.map((wake) => (
          <Row key={wake.session_id} className="items-start">
            <StatusDot tone={toneFor(wake.status)} className="mt-1.5" />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-sm">
                <p className="truncate text-body-sm text-role-content-heading">
                  {wake.title}
                </p>
                <span className="shrink-0 text-body-xs text-role-content-muted">
                  {wake.created_at ? formatCompactRelativeTime(wake.created_at) : "—"}
                </span>
              </div>
              <p className="mt-1 text-body-xs text-role-content-muted">
                {labelFor(wake.status)}
                {wake.created_at && ` · ${new Date(wake.created_at).toLocaleString()}`}
              </p>
            </div>
          </Row>
        ))}
      </div>
    </div>
  );
}
