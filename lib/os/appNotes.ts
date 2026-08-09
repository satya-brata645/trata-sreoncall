"use client";

/**
 * Per-app notes.
 *
 * §6: "I can write notes for myself, per app" — and those notes are supposed to
 * feed the brain, so that noting "this host is a known scanner, ignore it" stops
 * it being flagged.
 *
 * **Why not the knowledge library.** Mechanically it would fit — it is a named
 * HTML key/value store with full CRUD. But `get_org_context` concatenates *every*
 * knowledge page into the context injected into *every* app's runs. Per-app notes
 * stored there would leak into unrelated apps' prompts and grow that injected
 * document linearly with the number of apps. Feeding the brain needs a filtering
 * hook on the assembler that does not exist yet; until it does, notes live here.
 *
 * So this is local for now, and deliberately marked as such: the notes are real
 * and persist per person, but they do not reach the agent yet. Promoting them to
 * a backend store is the follow-up that makes the §6 promise true.
 *
 * **Many notes, not one blob.** A note has an identity — you open one, edit it,
 * and save or discard that edit. A single shared textarea has no discard, because
 * every keystroke is already committed; there is nothing to revert to.
 */

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useAuth, useOrganization } from "@/lib/auth/mockUser";

export interface AppNote {
  id: string;
  title: string;
  body: string;
  /** ISO 8601. Drives the ordering — most recently edited first. */
  updatedAt: string;
}

interface NotesState {
  scope: string | null;
  /** appId → that app's notes. */
  notes: Record<string, AppNote[]>;
}

const STORAGE_PREFIX = "sos:app:notes";

const EMPTY: NotesState = { scope: null, notes: {} };
const NO_NOTES: AppNote[] = [];

let current: NotesState = EMPTY;
const listeners = new Set<() => void>();

function storageKey(scope: string): string {
  return `${STORAGE_PREFIX}:${scope}`;
}

function isNote(value: unknown): value is AppNote {
  if (!value || typeof value !== "object") return false;
  const n = value as Record<string, unknown>;
  return (
    typeof n.id === "string" &&
    typeof n.title === "string" &&
    typeof n.body === "string" &&
    typeof n.updatedAt === "string"
  );
}

function load(scope: string): Record<string, AppNote[]> {
  try {
    const raw = window.localStorage.getItem(storageKey(scope));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    const out: Record<string, AppNote[]> = {};
    for (const [appId, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      // Migrate the single-string payload this store used to write, so an
      // existing note survives the change rather than silently disappearing.
      if (typeof value === "string") {
        if (value.trim()) {
          out[appId] = [
            {
              id: `${appId}-migrated`,
              title: "Note",
              body: value,
              updatedAt: new Date(0).toISOString(),
            },
          ];
        }
        continue;
      }
      if (Array.isArray(value)) out[appId] = value.filter(isNote);
    }
    return out;
  } catch {
    return {};
  }
}

function commit(next: NotesState): void {
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function getSnapshot(): NotesState {
  return current;
}

function getServerSnapshot(): NotesState {
  return EMPTY;
}

function hydrate(scope: string): void {
  if (current.scope === scope) return;
  commit({ scope, notes: load(scope) });
}

/** Write one app's list through, leaving every other app's untouched. */
function persist(appId: string, next: AppNote[]): void {
  const scope = current.scope;
  if (!scope) return;
  const notes = { ...current.notes, [appId]: next };
  try {
    window.localStorage.setItem(storageKey(scope), JSON.stringify(notes));
  } catch {
    // Ignored — see load(). A full or blocked store must not break editing.
  }
  commit({ scope, notes });
}

export interface UseAppNotesResult {
  notes: AppNote[];
  /** Creates when `id` is null, updates otherwise. Returns the note's id. */
  saveNote: (
    id: string | null,
    fields: { title: string; body: string },
  ) => string | null;
  deleteNote: (id: string) => void;
}

export function useAppNotes(appId: string | null): UseAppNotesResult {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const { userId } = useAuth();
  const { organization } = useOrganization();

  const scope = organization?.id ?? userId ?? null;

  useEffect(() => {
    if (scope) hydrate(scope);
  }, [scope]);

  const saveNote = useCallback(
    (id: string | null, fields: { title: string; body: string }) => {
      if (!current.scope || !appId) return null;
      const existing = current.notes[appId] ?? [];
      const updatedAt = new Date().toISOString();
      // Untitled notes are normal — the first line of the body is a better
      // name than forcing a title field before anything can be written.
      const title =
        fields.title.trim() ||
        fields.body.trim().split("\n")[0]?.slice(0, 60) ||
        "Untitled note";

      if (id) {
        persist(
          appId,
          existing.map((n) =>
            n.id === id ? { ...n, title, body: fields.body, updatedAt } : n,
          ),
        );
        return id;
      }

      const newId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      persist(appId, [
        { id: newId, title, body: fields.body, updatedAt },
        ...existing,
      ]);
      return newId;
    },
    [appId],
  );

  const deleteNote = useCallback(
    (id: string) => {
      if (!current.scope || !appId) return;
      persist(appId, (current.notes[appId] ?? []).filter((n) => n.id !== id));
    },
    [appId],
  );

  const ready = state.scope != null && state.scope === scope;
  const notes = ready && appId ? (state.notes[appId] ?? NO_NOTES) : NO_NOTES;

  return { notes, saveNote, deleteNote };
}
