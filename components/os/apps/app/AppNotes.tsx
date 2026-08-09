"use client";

import { useState } from "react";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";

import { EmptyState, Icon } from "@/components/ui/primitives";
import { useAppNotes, type AppNote } from "@/lib/os/appNotes";
import { cn } from "@/lib/utils";

function formatEdited(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime()) || date.getTime() === 0) return "";
  return `${date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })} ${date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

const BUTTON =
  "rounded-2xs px-xs py-3xs text-body-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-role-border-focus disabled:opacity-50";

export function AppNotes({ appId }: { appId: string }) {
  const { notes, saveNote, deleteNote } = useAppNotes(appId);

  const [editing, setEditing] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");

  const open = (note: AppNote) => {
    setEditing(note.id);
    setDraftTitle(note.title);
    setDraftBody(note.body);
  };

  const startNew = () => {
    setEditing("new");
    setDraftTitle("");
    setDraftBody("");
  };

  const close = () => {
    setEditing(null);
    setDraftTitle("");
    setDraftBody("");
  };

  const current =
    editing && editing !== "new"
      ? notes.find((note) => note.id === editing)
      : undefined;

  const openEditor = editing === "new" || current ? editing : null;
  const dirty = current
    ? draftTitle !== current.title || draftBody !== current.body
    : draftTitle.trim() !== "" || draftBody.trim() !== "";

  const onSave = () => {
    if (!draftTitle.trim() && !draftBody.trim()) return close();
    saveNote(editing === "new" ? null : editing, {
      title: draftTitle,
      body: draftBody,
    });
    close();
  };

  if (openEditor) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center gap-2xs border-b border-role-border-subtle px-md py-xs">
          <button
            type="button"
            onClick={close}
            aria-label="Back to notes"
            className={cn(BUTTON, "text-role-content-muted hover:text-role-content-body")}
          >
            <Icon icon={ArrowLeft} size={13} />
          </button>
          <input
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
            placeholder="Title"
            aria-label="Note title"
            className={cn(
              "min-w-0 flex-1 bg-transparent text-body-sm font-medium outline-none",
              "text-role-content-heading placeholder:text-role-content-placeholder",
            )}
          />
          {current && (
            <button
              type="button"
              onClick={() => {
                deleteNote(current.id);
                close();
              }}
              aria-label="Delete note"
              className={cn(
                BUTTON,
                "text-role-content-muted hover:text-role-status-critical-foreground",
              )}
            >
              <Icon icon={Trash2} size={13} />
            </button>
          )}
        </div>

        <textarea
          value={draftBody}
          onChange={(event) => setDraftBody(event.target.value)}
          placeholder="Write a note for yourself about this app..."
          aria-label="Note body"
          autoFocus
          className={cn(
            "min-h-0 flex-1 resize-none bg-transparent p-md outline-none",
            "text-body-sm text-role-content-body placeholder:text-role-content-placeholder",
          )}
        />

        <div className="flex shrink-0 items-center justify-end gap-xs border-t border-role-border-subtle px-md py-xs">
          <button
            type="button"
            onClick={close}
            className={cn(
              BUTTON,
              "border border-role-border-subtle text-role-content-body",
              "hover:bg-role-surface-component-hover",
            )}
          >
            Discard
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!dirty}
            className={cn(
              BUTTON,
              "bg-role-surface-action text-role-foreground-on-inverse",
              "hover:bg-role-surface-action-hover",
            )}
          >
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-xs px-md py-xs">
        <span className="text-body-xs text-role-content-muted">
          {notes.length === 0
            ? "No notes yet"
            : `${notes.length} ${notes.length === 1 ? "note" : "notes"}`}
        </span>
        <button
          type="button"
          onClick={startNew}
          className={cn(
            BUTTON,
            "flex items-center gap-2xs border border-role-border-subtle text-role-content-body",
            "hover:bg-role-surface-component-hover",
          )}
        >
          <Icon icon={Plus} size={12} />
          New note
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {notes.length === 0 ? (
          <div className="flex h-full items-center justify-center px-md">
            <EmptyState
              title="Nothing saved yet"
              hint="Saved on this device. Not yet read by the agent."
            />
          </div>
        ) : (
          notes.map((note) => (
            <button
              key={note.id}
              type="button"
              onClick={() => open(note)}
              className={cn(
                "flex w-full flex-col gap-3xs px-md py-2xs text-left transition-colors",
                "hover:bg-role-surface-component-hover",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-role-border-focus",
              )}
            >
              <span className="truncate text-body-sm text-role-content-body">
                {note.title}
              </span>
              <span className="truncate text-body-xs text-role-content-muted">
                {formatEdited(note.updatedAt)}
                {note.body.trim() ? ` · ${note.body.trim().slice(0, 60)}` : ""}
              </span>
            </button>
          ))
        )}
      </div>

      {notes.length > 0 && (
        <p className="shrink-0 px-md py-xs text-body-xs text-role-content-muted">
          Saved on this device. Not yet read by the agent.
        </p>
      )}
    </div>
  );
}
