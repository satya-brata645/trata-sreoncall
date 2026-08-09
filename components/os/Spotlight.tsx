"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  CheckSquare,
  Cloud,
  GitBranch,
  Hash,
  HardDrive,
  KeyRound,
  Mail,
  SquareKanban,
  FileText,
  Files,
  Filter,
  Image as ImageIcon,
  MessageSquare,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  StickyNote,
  UserPlus,
  Users,
} from "lucide-react";

import { cn, formatRelativeTime, formatSize } from "@/lib/utils";
import { Chip, Icon, Kbd, SectionLabel } from "@/components/ui/primitives";
import { SparklesIcon } from "@/components/ui/SparklesIcon";
import { fileGlyph } from "@/lib/os/fileGlyphs";
import { PEOPLE, SOURCES, SPOTLIGHT_FILES, type Source } from "@/lib/mock/fixtures";

/** Lucide stand-ins for the connected sources — see `Source.glyph`. */
const SOURCE_GLYPHS = {
  cloud: Cloud,
  git: GitBranch,
  chat: Hash,
  mail: Mail,
  board: SquareKanban,
  pulse: Activity,
  key: KeyRound,
  drive: HardDrive,
} as const;
import { OS_DOCK_Z } from "@/lib/os/constants";
import { useWindowManager } from "@/lib/os/WindowManagerContext";

/**
 * Spotlight — find, then open.
 *
 * Deliberately a different surface to the command bar. **Spotlight finds; the
 * command bar talks.** One is a list you arrow through and press Enter on, the
 * other is a sentence you say to an agent, and merging them produces a control
 * that is bad at both — a search box that sometimes answers in prose, or a
 * conversation that keeps offering autocomplete.
 *
 * Everything it opens routes through the window manager's `openApp`, the same
 * entry point the agent's `open_app` verb ends at. One path, so a result that
 * opens for the user opens the same way for the agent.
 */

type TypeFilter = "people" | "task" | "pages" | "files" | "docs" | "messages" | "images";

const TYPE_FILTERS: Array<{
  id: TypeFilter;
  label: string;
  icon: typeof Users;
  /** Types with no source behind them yet. Shown, not hidden — see below. */
  unavailable?: boolean;
}> = [
  { id: "people", label: "People", icon: Users },
  { id: "task", label: "Task", icon: CheckSquare },
  { id: "pages", label: "Pages", icon: FileText },
  { id: "files", label: "Files", icon: Files },
  { id: "docs", label: "Docs", icon: FileText },
  { id: "messages", label: "Messages", icon: MessageSquare },
  // Rendered faint and inert rather than omitted: a filter that disappears
  // reads as a search that found nothing, and the honest signal is that this
  // kind of thing exists but has no connected source.
  { id: "images", label: "Images", icon: ImageIcon, unavailable: true },
];

interface QuickAction {
  id: string;
  label: string;
  icon: typeof Plus;
  shortcut: string;
  run: () => void;
}

/** One selectable row, flattened across sections so ↑/↓ crosses headings. */
interface Selectable {
  key: string;
  open: () => void;
}

export function Spotlight({ onClose }: { onClose: () => void }) {
  const { openApp } = useWindowManager();
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");
  const [types, setTypes] = useState<TypeFilter[]>([]);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const q = query.trim().toLowerCase();
  const wants = (type: TypeFilter) => types.length === 0 || types.includes(type);

  const people = useMemo(
    () =>
      !wants("people")
        ? []
        : PEOPLE.filter(
            (p) =>
              !q || p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q),
          ),
    [q, types],
  );

  const files = useMemo(
    () =>
      !wants("files") && !wants("docs")
        ? []
        : SPOTLIGHT_FILES.filter(
            (f) =>
              !q ||
              f.name.toLowerCase().includes(q) ||
              f.category.toLowerCase().includes(q),
          ),
    [q, types],
  );

  const quickActions: QuickAction[] = useMemo(
    () => [
      {
        id: "task",
        label: "Create new task",
        icon: Plus,
        shortcut: "⌘T",
        run: () => openApp("brain", { params: { panel: "cortex" } }),
      },
      {
        id: "note",
        label: "Create note",
        icon: StickyNote,
        shortcut: "⌘N",
        run: () => openApp("chat", { params: { panel: "home" } }),
      },
      {
        id: "member",
        label: "Add member",
        icon: UserPlus,
        shortcut: "⌘M",
        run: () => openApp("app-store", { params: { panel: "discover" } }),
      },
    ],
    [openApp],
  );

  const visibleActions = quickActions.filter(
    (a) => !q || a.label.toLowerCase().includes(q),
  );

  /** Flat selection order — ↑/↓ walks the whole result set, headings included. */
  const selectables: Selectable[] = useMemo(
    () => [
      ...people.map((p) => ({
        key: `person-${p.id}`,
        open: () => {
          openApp("chat", { params: { panel: "threads" } });
          onClose();
        },
      })),
      ...files.map((f) => ({
        key: `file-${f.id}`,
        open: () => {
          openApp("files", { params: { location: `/${f.path}` } });
          onClose();
        },
      })),
      ...visibleActions.map((a) => ({
        key: `action-${a.id}`,
        open: () => {
          a.run();
          onClose();
        },
      })),
    ],
    [people, files, visibleActions, openApp, onClose],
  );

  // A shrinking result set must not strand the cursor past the end — otherwise
  // Enter opens nothing and the palette looks broken rather than empty.
  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, selectables.length - 1)));
  }, [selectables.length]);

  const activeKey = selectables[cursor]?.key;

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((c) => Math.min(c + 1, selectables.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      selectables[cursor]?.open();
    }
  }

  // Keep the cursor on screen when the arrow keys walk it past the fold.
  useEffect(() => {
    if (!activeKey) return;
    listRef.current
      ?.querySelector(`[data-key="${activeKey}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeKey]);

  const toggleType = (id: TypeFilter) =>
    setTypes((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));

  return (
    <div
      style={{ zIndex: OS_DOCK_Z + 5 }}
      className="fixed inset-0 flex items-start justify-center bg-[rgba(0,0,0,0.4)] pt-[7vh]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="flex max-h-[80vh] w-[min(880px,92vw)] animate-dos-fadeup flex-col overflow-hidden rounded-xl border border-role-border-subtle bg-role-surface-page shadow-600"
      >
        {/* 1 — the field */}
        <div className="flex flex-none items-center gap-3 px-md py-3.5">
          <Icon icon={Search} className="text-role-icon-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Start typing here..."
            aria-activedescendant={activeKey}
            className="min-w-0 flex-1 bg-transparent text-heading-sm text-role-content-heading outline-none placeholder:font-normal placeholder:text-role-content-placeholder"
          />
          <Kbd>⌘</Kbd>
          <Kbd>A</Kbd>
          <SparklesIcon size={16} className="text-role-foreground-accent" />
        </div>

        {/* 2 — sources. The one row where colour is not the accent: these are
            other companies' marks, and desaturating them would make them
            unrecognisable, which is the only thing they are for. */}
        <div className="flex flex-none items-center gap-1 overflow-x-auto border-b border-role-border-subtle px-md scrollbar-hidden">
          <SourceTab
            active={source === "all"}
            onSelect={() => setSource("all")}
            label="All"
          />
          {SOURCES.map((s) => (
            <SourceTab
              key={s.id}
              active={source === s.id}
              onSelect={() => setSource(s.id)}
              label={s.label}
              source={s}
            />
          ))}
          <button
            type="button"
            aria-label="Connect a source"
            className="ml-1 flex size-7 shrink-0 items-center justify-center rounded-full border border-role-border-subtle text-role-icon-muted hover:bg-role-surface-component-hover hover:text-role-content-heading"
          >
            <Icon icon={Plus} size={13} />
          </button>
        </div>

        {/* 3 — type filters */}
        <div className="flex flex-none items-center gap-2 border-b border-role-border-subtle px-md py-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto scrollbar-hidden">
            {TYPE_FILTERS.map((filter) => (
              <Chip
                key={filter.id}
                icon={filter.icon}
                disabled={filter.unavailable}
                active={types.includes(filter.id)}
                onClick={() => toggleType(filter.id)}
              >
                {filter.label}
              </Chip>
            ))}
          </div>
          <IconChip icon={Filter} label="Filter" />
          <IconChip icon={SlidersHorizontal} label="Sort" />
        </div>

        {/* 4 — results */}
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto pb-2">
          {selectables.length === 0 && (
            <p className="px-md py-xl text-center text-body-sm text-role-content-muted">
              Nothing matches “{query}”.
            </p>
          )}

          {people.length > 0 && (
            <>
              <SectionLabel className="px-md pt-3" count={people.length}>
                Recent
              </SectionLabel>
              <div className="px-2.5">
                {people.map((person) => (
                  <ResultRow
                    key={person.id}
                    dataKey={`person-${person.id}`}
                    active={activeKey === `person-${person.id}`}
                    onOpen={() => selectables.find((s) => s.key === `person-${person.id}`)?.open()}
                  >
                    <span
                      style={{ background: person.tint }}
                      className="flex size-7 shrink-0 items-center justify-center rounded-xs text-label-lg font-semibold tracking-normal text-[var(--dos-ink)]"
                    >
                      {person.initials}
                    </span>
                    <span className="truncate text-body-md text-role-content-heading">
                      {person.name}
                    </span>
                    <span className="text-role-content-placeholder">·</span>
                    <span className="truncate text-body-md text-role-content-subtle">
                      {person.email}
                    </span>
                    <span className="ml-auto flex items-center gap-1.5 text-role-content-subtle">
                      <Icon icon={MessageSquare} size={13} />
                      <span className="text-body-sm">{person.messages}</span>
                    </span>
                  </ResultRow>
                ))}
              </div>
            </>
          )}

          {files.length > 0 && (
            <>
              <SectionLabel className="px-md pt-3" count={files.length}>
                Files
              </SectionLabel>
              <div className="px-2.5">
                {files.map((file) => {
                  const glyph = fileGlyph(`x.${file.kind.toLowerCase()}`);
                  return (
                    <ResultRow
                      key={file.id}
                      dataKey={`file-${file.id}`}
                      active={activeKey === `file-${file.id}`}
                      onOpen={() => selectables.find((s) => s.key === `file-${file.id}`)?.open()}
                      align="start"
                    >
                      <span
                        style={{ background: glyph?.tint ?? "var(--dos-elevated)" }}
                        className="mt-0.5 flex h-6 w-7 shrink-0 items-center justify-center rounded-[5px] text-[8px] font-semibold tracking-[0.04em] text-white"
                      >
                        {file.kind}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-body-md text-role-content-heading">
                            {file.name}
                          </span>
                          <span className="text-role-content-placeholder">·</span>
                          <span className="shrink-0 text-body-md text-role-content-subtle">
                            {file.category}
                          </span>
                        </span>
                        <span className="block truncate text-body-sm text-role-content-muted">
                          {formatSize(file.size)} · Modified {formatRelativeTime(file.modifiedAt)}{" "}
                          by {file.modifiedBy}
                        </span>
                      </span>
                      <Icon icon={ArrowUpRight} size={15} className="mt-1 text-role-icon-subtle" />
                    </ResultRow>
                  );
                })}
              </div>
            </>
          )}

          {visibleActions.length > 0 && (
            <>
              <SectionLabel className="px-md pt-3">Quick actions</SectionLabel>
              <div className="px-2.5">
                {visibleActions.map((action) => (
                  <ResultRow
                    key={action.id}
                    dataKey={`action-${action.id}`}
                    active={activeKey === `action-${action.id}`}
                    onOpen={() => selectables.find((s) => s.key === `action-${action.id}`)?.open()}
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-xs border border-role-border-subtle bg-role-surface-container-subtle text-role-icon-muted">
                      <Icon icon={action.icon} size={13} />
                    </span>
                    <span className="text-body-md text-role-content-heading">
                      {action.label}
                    </span>
                    <span className="ml-auto">
                      <Kbd>{action.shortcut}</Kbd>
                    </span>
                  </ResultRow>
                ))}
              </div>
            </>
          )}
        </div>

        {/* 5 — the key legend */}
        <div className="flex flex-none items-center gap-md border-t border-role-border-subtle px-md py-2.5">
          <Legend keys={["⇅"]} label="Select" />
          <Legend keys={["↵"]} label="Open" />
          <Legend keys={["⌘R"]} label="Open in new tab" />
          <Legend keys={["⌘L"]} label="Copy Link" />
          <Legend keys={["ESC"]} label="Close" />
          <button
            type="button"
            aria-label="Search settings"
            className="ml-auto text-role-icon-subtle hover:text-role-content-heading"
          >
            <Icon icon={Settings} />
          </button>
        </div>
      </div>
    </div>
  );
}

function SourceTab({
  label,
  source,
  active,
  onSelect,
}: {
  label: string;
  source?: Source;
  active: boolean;
  onSelect: () => void;
}) {
  const Glyph = source ? SOURCE_GLYPHS[source.glyph] : null;
  return (
    <button
      type="button"
      onClick={onSelect}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "relative flex h-11 shrink-0 items-center px-2.5 text-body-sm transition-colors",
        active
          ? "text-role-content-heading"
          : "text-role-content-subtle hover:text-role-content-body",
      )}
    >
      {Glyph && source ? (
        // Its own tile, its own colour — the source row is the one place the
        // monochrome rule yields, because telling Slack from Drive at 18px is
        // the entire job of this control.
        <span
          style={{ color: source.tint, opacity: active ? 1 : 0.75 }}
          className="flex size-6 items-center justify-center rounded-[6px] bg-role-surface-component-subtle transition-opacity"
        >
          <Icon icon={Glyph} size={14} />
        </span>
      ) : (
        <span className="px-1">{label}</span>
      )}
      {active && (
        <span className="absolute inset-x-1.5 bottom-0 h-0.5 rounded-full bg-role-surface-action" />
      )}
    </button>
  );
}

function IconChip({ icon, label }: { icon: typeof Filter; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="flex size-8 shrink-0 items-center justify-center rounded-full border border-role-border-subtle text-role-icon-muted hover:bg-role-surface-component-hover hover:text-role-content-heading"
    >
      <Icon icon={icon} size={14} />
    </button>
  );
}

function ResultRow({
  children,
  dataKey,
  active,
  onOpen,
  align = "center",
}: {
  children: React.ReactNode;
  dataKey: string;
  active: boolean;
  onOpen: () => void;
  align?: "center" | "start";
}) {
  return (
    <div
      id={dataKey}
      data-key={dataKey}
      role="option"
      aria-selected={active}
      tabIndex={-1}
      onClick={onOpen}
      className={cn(
        "flex cursor-pointer gap-3 rounded-sm px-2.5 py-2",
        align === "start" ? "items-start" : "items-center",
        active ? "bg-role-surface-component-selected" : "hover:bg-role-surface-component-hover",
      )}
    >
      {children}
    </div>
  );
}

function Legend({ keys, label }: { keys: string[]; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      {keys.map((k) => (
        <Kbd key={k}>{k}</Kbd>
      ))}
      <span className="text-body-sm text-role-content-subtle">{label}</span>
    </span>
  );
}
