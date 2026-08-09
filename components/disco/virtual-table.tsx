"use client";

import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatValue, n, type Format } from "@disco/core/format";

export interface Column {
  field: string;
  label: string;
  format?: Format;
  align: "left" | "right";
}

/**
 * The detail table. Windowed above a couple of hundred rows, because the
 * alternative — fifty thousand DOM nodes — is a frozen tab, and a dashboard
 * that locks the browser is worse than one that shows nothing.
 *
 * Deliberately not the shadcn <Table>: virtualization needs absolute row
 * positioning, which a semantic <tbody> cannot give. Same visual language,
 * different mechanics.
 */
export function VirtualTable({
  rows,
  columns,
  virtualize,
  pageSize,
  height,
}: {
  rows: Record<string, unknown>[];
  columns: Column[];
  virtualize: boolean;
  pageSize: number;
  /** Assigned by the layout solver. The table never picks its own height. */
  height?: number;
}) {
  const [sort, setSort] = React.useState<{ field: string; dir: "asc" | "desc" } | null>(null);
  const parentRef = React.useRef<HTMLDivElement>(null);

  const sorted = React.useMemo(() => {
    if (!sort) return rows;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = a[sort.field];
      const y = b[sort.field];
      const nx = typeof x === "number" ? x : Number(x);
      const ny = typeof y === "number" ? y : Number(y);
      if (Number.isFinite(nx) && Number.isFinite(ny)) return (nx - ny) * dir;
      return String(x ?? "").localeCompare(String(y ?? "")) * dir;
    });
  }, [rows, sort]);

  const visible = virtualize ? sorted : sorted.slice(0, pageSize);

  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 34,
    overscan: 12,
  });

  const toggleSort = (field: string) =>
    setSort((s) =>
      s?.field !== field ? { field, dir: "desc" } : s.dir === "desc" ? { field, dir: "asc" } : null,
    );

  // 30px header + 26px footer is the chrome the scroller does not get.
  const available = height ? Math.max(height - 56, 68) : 380;
  const scrollerHeight = virtualize ? available : Math.min(visible.length * 34 + 4, available);

  const grid = { gridTemplateColumns: columns.map((c) => (c.align === "right" ? "minmax(90px,0.7fr)" : "minmax(120px,1fr)")).join(" ") };

  return (
    <div className="overflow-hidden rounded-md border border-border/70">
      <div className="grid gap-x-4 border-b border-border/70 bg-muted/40 px-3 py-2" style={grid}>
        {columns.map((c) => {
          const active = sort?.field === c.field;
          const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
          return (
            <button
              key={c.field}
              type="button"
              onClick={() => toggleSort(c.field)}
              className={cn(
                "flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground",
                c.align === "right" && "justify-end",
              )}
            >
              <span className="truncate">{c.label}</span>
              <Icon className={cn("size-3 shrink-0", !active && "opacity-30")} aria-hidden />
            </button>
          );
        })}
      </div>

      <div
        ref={parentRef}
        className="overflow-auto"
        style={{ height: scrollerHeight }}
      >
        <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
          {virtualizer.getVirtualItems().map((v) => {
            const row = visible[v.index];
            return (
              <div
                key={v.key}
                className="grid items-center gap-x-4 border-b border-border/40 px-3 text-xs last:border-0 hover:bg-muted/30"
                style={{
                  ...grid,
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: v.size,
                  transform: `translateY(${v.start}px)`,
                }}
              >
                {columns.map((c) => (
                  <span
                    key={c.field}
                    className={cn("truncate", c.align === "right" ? "text-right tabular-nums" : "text-left text-muted-foreground")}
                    title={String(row[c.field] ?? "")}
                  >
                    {c.format ? formatValue(row[c.field], c.format) : String(row[c.field] ?? "—")}
                  </span>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      <div className="border-t border-border/70 bg-muted/20 px-3 py-1.5 text-[11px] text-muted-foreground">
        {virtualize
          ? `${n(rows.length)} rows · windowed`
          : `showing ${n(visible.length)} of ${n(rows.length)} rows`}
      </div>
    </div>
  );
}
