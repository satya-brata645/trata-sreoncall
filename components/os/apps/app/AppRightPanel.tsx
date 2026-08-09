"use client";

import { FileText } from "lucide-react";

import { AppNotes } from "./AppNotes";
import { useSessionFiles } from "@/lib/hooks/useComplianceData";
import { formatSize } from "@/lib/utils";

export function AppRightPanel({ appId, sessionId, panel, buildLabel }: { appId: string; sessionId: string | null; panel: "outputs" | "notes"; buildLabel: string }) {
  const { data } = useSessionFiles(sessionId);
  const files = data?.files ?? [];
  return <aside className="flex h-full min-h-0 w-[320px] shrink-0 flex-col border-l border-role-border-subtle bg-role-surface-page" aria-label={panel === "notes" ? "App notes" : "App outputs"}>
    <header className="shrink-0 border-b border-role-border-subtle px-md py-sm"><p className="text-body-sm font-medium text-role-content-heading">{panel === "notes" ? "Notes" : "Outputs"}</p><p className="mt-0.5 truncate text-body-xs text-role-content-muted">/apps/{appId}/{buildLabel}/outputs</p></header>
    {panel === "notes" ? <div className="min-h-0 flex-1"><AppNotes appId={appId} /></div> : <div className="min-h-0 flex-1 overflow-y-auto p-sm">{files.length === 0 ? <p className="p-sm text-body-sm text-role-content-muted">No frozen outputs for this refresh.</p> : files.map((file) => <div className="flex items-center gap-2 rounded-2xs px-sm py-xs" key={file.path}><FileText className="size-3.5 text-role-icon-subtle" /><span className="min-w-0 flex-1 truncate text-body-sm text-role-content-body">{file.filename}</span><span className="text-body-xs text-role-content-muted">{formatSize(file.size)}</span></div>)}</div>}
  </aside>;
}
