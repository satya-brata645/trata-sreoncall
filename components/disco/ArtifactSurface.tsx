"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CircleCheck, Clock3, RefreshCw } from "lucide-react";

import { useLatestRun } from "@/lib/artifacts/useLatestRun";
import type { RunDocument } from "@/lib/artifacts/read";
import { cn } from "@/lib/utils";

function number(value: number, unit: string): string {
  if (unit === "%") return `${value.toFixed(value < 10 ? 2 : 1)}%`;
  if (unit === "ms") return `${Math.round(value)} ms`;
  if (unit === "min") return `${Math.round(value)} min`;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

function asOf(value: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(value));
}

function severityClass(severity: string): string {
  if (severity === "breach") return "border-role-status-critical-default/40 bg-role-status-critical-subtle";
  if (severity === "risk") return "border-role-status-medium-default/40 bg-role-status-medium-subtle";
  return "border-role-border-subtle bg-role-surface-container-subtle";
}

/**
 * The embedded artifact reader. The spec remains separately authored and the
 * run remains immutable; this component deliberately only renders the data
 * contract, so a refresh can swap a parsed document without blanking the app.
 */
export function ArtifactSurface({ initial }: { initial: RunDocument | null }) {
  const live = useLatestRun();
  const [run, setRun] = useState<RunDocument | null>(initial);

  useEffect(() => {
    if (live.run && live.run.run.id !== run?.run.id) setRun(live.run);
  }, [live.run, run?.run.id]);

  const attention = useMemo(() => [...(run?.attention ?? [])].sort((a, b) => b.urgency - a.urgency).slice(0, 4), [run]);
  const services = useMemo(() => [...(run?.services ?? [])].sort((a, b) => b.budget_burn - a.budget_burn).slice(0, 5), [run]);

  if (!run) {
    return <div className="flex h-full items-center justify-center p-md text-body-sm text-role-content-muted">Waiting for the first complete refresh…</div>;
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-md overflow-y-auto p-md" aria-label="Live app dashboard">
      <header className="flex flex-wrap items-start justify-between gap-sm">
        <div>
          <p className="text-heading-sm font-semibold text-role-content-heading">SRE on-call</p>
          <p className="mt-1 text-body-sm text-role-content-muted">Signal to postmortem, end to end</p>
        </div>
        <span className="flex items-center gap-2 text-body-xs text-role-content-muted" title={live.error ?? `run ${run.run.id}`}>
          <span className={cn("size-1.5 rounded-full", live.error ? "bg-role-status-critical-default" : "bg-role-status-low-default", live.isStreaming && "animate-pulse")} />
          {live.error ? "Showing last complete refresh" : `As of ${asOf(run.run.asOf)} UTC`}
        </span>
      </header>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-sm">
        {run.metrics.slice(0, 5).map((metric) => (
          <article key={metric.id} className="rounded-sm border border-role-border-subtle bg-role-surface-container-subtle p-sm">
            <p className="truncate text-body-xs text-role-content-muted">{metric.label}</p>
            <p className="mt-1 text-heading-sm font-semibold text-role-content-heading">{number(metric.value, metric.unit)}</p>
            <p className={cn("mt-1 text-body-xs", metric.breach ? "text-role-status-critical-foreground" : "text-role-content-muted")}>
              {metric.delta === null ? metric.basis : `${metric.delta > 0 ? "+" : ""}${metric.delta.toFixed(1)}% · ${metric.basis}`}
            </p>
          </article>
        ))}
      </div>

      <div className="grid min-h-0 grid-cols-1 gap-md xl:grid-cols-[1.15fr_0.85fr]">
        <article className="rounded-sm border border-role-border-subtle bg-role-surface-page p-sm">
          <div className="mb-sm flex items-center gap-2 text-body-sm font-medium text-role-content-heading"><AlertTriangle className="size-4" /> Needs attention</div>
          <div className="flex flex-col gap-2">
            {attention.map((item) => (
              <div key={item.id} className={cn("rounded-xs border p-sm", severityClass(item.severity))}>
                <div className="flex items-start justify-between gap-sm"><p className="text-body-sm font-medium text-role-content-heading">{item.title}</p><span className="shrink-0 text-body-xs text-role-content-muted">{item.meta}</span></div>
                <p className="mt-1 text-body-xs text-role-content-body">{item.detail}</p>
              </div>
            ))}
            {attention.length === 0 && <p className="text-body-sm text-role-content-muted">No material attention items.</p>}
          </div>
        </article>

        <article className="rounded-sm border border-role-border-subtle bg-role-surface-page p-sm">
          <div className="mb-sm flex items-center gap-2 text-body-sm font-medium text-role-content-heading"><CircleCheck className="size-4" /> Service health</div>
          <div className="flex flex-col divide-y divide-role-border-subtle">
            {services.map((service) => (
              <div className="flex items-center justify-between gap-sm py-2" key={service.service}>
                <div className="min-w-0"><p className="truncate text-body-sm text-role-content-heading">{service.service}</p><p className="text-body-xs text-role-content-muted">p95 {Math.round(service.p95_latency_ms)}ms · {service.error_rate_pct.toFixed(2)}% errors</p></div>
                <span className={cn("text-body-xs font-medium", service.budget_burn >= 1 ? "text-role-status-critical-foreground" : "text-role-content-muted")}>{Math.round(service.budget_burn * 100)}% budget</span>
              </div>
            ))}
          </div>
        </article>
      </div>

      <footer className="flex items-center gap-2 text-body-xs text-role-content-muted"><RefreshCw className="size-3" /> Immutable artifact {run.run.id}<Clock3 className="ml-2 size-3" /> {run.incidents.length} incidents in this window</footer>
    </section>
  );
}
