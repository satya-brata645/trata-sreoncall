"use client";

import { useState } from "react";
import { ArrowUp, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";

type ChatRow = { id: number; author: "You" | "Builder"; text: string };

/**
 * The app's build-facing view. It deliberately does not fork the global chat:
 * a build request is a small, attributable patch conversation beside the live
 * dashboard, not a different inbox.
 */
export function AppBuildChat({ appName, onPromote }: { appName: string; onPromote: () => void }) {
  const [message, setMessage] = useState("");
  const [rows, setRows] = useState<ChatRow[]>([
    { id: 1, author: "Builder", text: `${appName} is using the current shipped build. Describe a change and I’ll validate it against the dashboard data shape.` },
  ]);

  const send = () => {
    const text = message.trim();
    if (!text) return;
    setRows((current) => [...current, { id: Date.now(), author: "You", text }, { id: Date.now() + 1, author: "Builder", text: "Patch composition is ready to wire to the Disco patch endpoint. The dashboard remains visible while the change is checked." }]);
    setMessage("");
  };

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Build chat">
      <header className="flex shrink-0 items-center justify-between border-b border-role-border-subtle px-md py-sm">
        <div><p className="text-body-sm font-medium text-role-content-heading">Build chat</p><p className="text-body-xs text-role-content-muted">Changes are staged before promotion.</p></div>
        <Button size="sm" variant="outline" onClick={onPromote}>Promote</Button>
      </header>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-md">
        {rows.map((row) => <div key={row.id} className={row.author === "You" ? "ml-5 rounded-sm bg-role-surface-component-selected p-sm" : "mr-3 rounded-sm border border-role-border-subtle bg-role-surface-container-subtle p-sm"}><p className="mb-1 text-body-xs font-medium text-role-content-muted">{row.author}</p><p className="text-body-sm text-role-content-body">{row.text}</p></div>)}
      </div>
      <form className="shrink-0 border-t border-role-border-subtle p-sm" onSubmit={(event) => { event.preventDefault(); send(); }}>
        <label className="sr-only" htmlFor="build-request">Describe a dashboard change</label>
        <div className="flex gap-2"><textarea id="build-request" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="e.g. show root-cause mix as a donut" rows={2} className="min-h-0 flex-1 resize-none rounded-2xs border border-role-border-subtle bg-transparent px-sm py-xs text-body-sm text-role-content-body outline-none focus:ring-1 focus:ring-role-border-focus" /><button type="submit" aria-label="Send build request" className="self-end rounded-2xs bg-role-surface-action p-2 text-role-foreground-on-inverse"><ArrowUp className="size-4" /></button></div>
        <button type="button" className="mt-2 flex items-center gap-1 text-body-xs text-role-content-muted hover:text-role-content-body"><Undo2 className="size-3" /> Undo latest staged change</button>
      </form>
    </section>
  );
}
