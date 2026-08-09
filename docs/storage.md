# Storage

Everything durable in this repository is a file. There is no database, no
migration, no connection pool — and that is a design decision rather than a
shortcut, because the two properties this system actually needs from storage
are *two uncoordinated writers must not lose each other's work* and *a reader
must never see half a document*. A local filesystem gives both for free. A
network object store gives neither, which is why the MCS lineage referenced
throughout this document had to build an apparatus to get them back.

There are two roots, and they are different kinds of thing:

| Root | Written by | Mutability | Keyed by |
|---|---|---|---|
| `.data/<scope>/` | the app itself (browser, heartbeat, routes) | append-mostly | the scope key |
| `artifacts/` | a producer outside the request path | immutable once complete | run id / spec id |

`.data/` is state. `artifacts/` is evidence. Deleting `.data/` is a complete
reset of the product; deleting `artifacts/` deletes the numbers the dashboards
are about.

## The scope key

`lib/auth/scope.ts` exports one function, and every store in the repository
calls it:

```ts
export function scopeKey(): string {
  return MOCK_ORG.id || MOCK_USER.userId;
}
```

`orgId || userId` — the org when there is one, the user when there is not. It
lives in its own module rather than in `mockUser.ts` because that file is
`"use client"`, and the conversation store, the event log, the heartbeat and
the ingest route all need the same key **on the server**. `mockUser`
re-exports the values, so the React-facing surface is unchanged.

Both halves are fixtures today (`org_trata`, `user_trata_demo`), and the shape
is still worth keeping exactly as it is. The key is a **path segment**:
`.data/org_trata/…`. Changing its shape does not fail, does not warn, and does
not migrate — it silently points every store at a directory that does not
exist yet, and a user who had pinned dashboards, read threads, promoted builds
and a heartbeat cursor now has none of them. Orphaned, not lost, which is
worse: the old directory is still there, still valid, and nothing will ever
read it again.

Namespacing every store by the key rather than by the caller is what makes
that a single decision instead of a dozen. Nothing in the codebase constructs
a `.data` path without going through `scopeKey()`.

## On disk

```
.data/
└── org_trata/                         ← scopeKey()
    ├── conversations/
    │   ├── .seeded                    ← seed marker; its existence is the guard
    │   ├── home.ndjson                ← the thread the app writes into unprompted
    │   ├── conv-dpflo-scope.ndjson
    │   ├── conv-freeze.ndjson
    │   └── conv-kode-reach.ndjson
    ├── builds/
    │   └── sreoncall.json             ← one document per app id
    ├── schedules/
    │   └── <appId>.json               ← one ScheduledJob per app id
    ├── events.ndjson                  ← the SRE event log
    ├── heartbeat-state.json           ← the cursor (lastSeen + announced)
    ├── agent-runs.ndjson              ← what the agent did to the desktop
    ├── working-set.json               ← short-term memory + protocol state
    ├── episodes.ndjson                ← episodic traces
    └── ltm.ndjson                     ← long-term traces

artifacts/
├── runs/
│   ├── 2026-08-09T08-51-44-000Z/      ← a run is a DIRECTORY, and immutable
│   │   ├── dashboard.json             ← the document; the parse gate is here
│   │   └── meta.json                  ← header + per-table row counts
│   ├── 2026-08-09T10-53-06-000Z/
│   ├── 2026-08-09T11-00-00-000Z/
│   ├── 2026-08-09T12-00-00-000Z/
│   └── 2026-08-09T12-21-46-000Z/
└── specs/
    ├── sreoncall.json                 ← AUTHORED and versioned
    ├── sreoncall-engineer.json
    ├── sre-oncall.json
    ├── dpflo.json
    ├── kodeshield.json
    └── auditiseasy.json
```

Note what the split under `artifacts/` is doing: specs are authored, runs are
produced. They are separate directories because they have separate lifetimes.

## Append-only NDJSON, and why

Two things write the home conversation and they do not know about each other:
the **browser**, when you say something, and the **heartbeat**, when the app
decides to speak first. This is the exact problem MCS hit, and MCS solved it
with a spool directory, monotonic ULIDs and a compaction pass — an apparatus
that exists entirely because S3 has no compare-and-swap, so a
read-modify-write of one `messages.json` silently drops whichever writer lost
the race.

A local file gives us the primitive S3 withheld. `O_APPEND` on a small write is
atomic, so both writers simply append and neither can clobber the other. One
NDJSON line per record; read the whole file back; dedupe. No spool, no
compaction, no ULID clock.

Three properties follow, and every log in `.data/` relies on all three:

| Property | Mechanism | What it buys |
|---|---|---|
| No lost writes | `fs.appendFile`, one line per record | two writers, no lock |
| Idempotency | dedupe by `id` on read, **first occurrence wins** | a retried POST or a replayed beat is free |
| Stable order | sort by `at`, `id` as tiebreak | two records minted in the same millisecond never swap places between reads |

"First occurrence wins" is not arbitrary. In `lib/store/events.ts` the comment
records what happened when last-wins was tried: a retry carries a fresh server
`at` and whatever fields the producer happened to resend, so overwriting moved
an incident's start time forward and dropped the action items from the
original. A replay rewrote history instead of being ignored.

A torn line — the tail of a process killed mid-append — is skipped, never
fatal. It costs one record, not the log.

## `lib/store/conversations.ts`

| Symbol | What it is |
|---|---|
| `StoredMessage` | `MockMessage` plus optional `eventRef` — the SRE event this message answered |
| `StoredConversation` | `id`, `title`, `isHome?`, `updatedAt`, `unread`, `messages[]` |
| `HOME_CONVERSATION_ID` | `"home"` — the thread the app writes into unprompted |
| `appendMessage` / `appendMessages` | append one / a batch; **never throw** |
| `ensureSeeded` | put the fixture threads on disk the first time anyone looks |
| `readMessages` | read back, dedupe, order |
| `markThreadRead` | clear the unread badge, by appending |
| `listConversations` | the rail, with bodies only where asked for |

Conversation ids arrive from the URL and from tool input, so `logPath` collapses
anything outside `[a-zA-Z0-9_-]` and truncates at 120 characters: a traversal
attempt becomes a harmless sibling file.

**The appends never throw.** A conversation that cannot be written is worth
degrading over, not worth failing a turn over — the failure is a `console.warn`
and the user still gets their answer.

**`ensureSeeded`** exists so an empty `.data` does not mean an empty product.
The fixture threads in `lib/mock/fixtures` are the demo's backstory and were
once the only content chat ever had; seeding writes them to disk on first
touch, after which they are ordinary messages — editable, appendable, no longer
re-derived on every mount the way `useState(THREADS)` was. Because the seed
lives on disk and nothing else remembers it ran, **deleting `.data/` is a
complete reset**.

The guard is a marker file, `.seeded`, and the reason is a real bug. The guard
used to be "does any conversation exist", which ordering exposed: the heartbeat
can speak before anyone opens the app, and the `home.ndjson` it writes then
looks exactly like an already-seeded store. The fixtures never landed and the
rail came up almost empty. A marker answers the question actually being asked —
*has the seed run* — rather than a proxy something else can satisfy by
accident. The marker is written **last**, so a crash mid-seed leaves no marker,
the next start seeds again, and the appends are idempotent by message id anyway.

**Read state is the one genuinely mutable thing about a message**, and it is
still appended rather than rewritten. `markThreadRead` re-appends each unread
agent message with `read: true`; the reader folds it in as a one-way tombstone —
a later line can set `read` true, never back to false. That keeps the single
rule intact: nothing ever rewrites a line.

**`listConversations(bodiesFor)`** takes a predicate deciding which threads
ship their messages. The poll runs every 15s forever and only one conversation
is written to by anything other than this browser tab; sending every message of
every thread each time made the payload grow without bound in order to keep one
of them fresh. Summaries still carry `unread`, because that is what the rail and
the activity badge are actually asking for. Titles are **derived**, not stored —
the first user line in a thread — because storing them would mean a second
writer on a file whose whole design is append-only.

## `lib/store/events.ts` — the log and the cursor

Same NDJSON shape, same reason: the ingest route and the heartbeat run
concurrently and neither should hold a lock.

The interesting part is that this module contains **both** disciplines:

| File | Discipline | Writers |
|---|---|---|
| `events.ndjson` | append-only, dedupe on read | ingest route, anything replaying |
| `heartbeat-state.json` | read-modify-write, temp file + `rename` | the heartbeat, one beat at a time |

The cursor *is* read-modify-write, which the log deliberately is not — and
that is safe only because exactly one thing writes it and only one beat runs at
a time. `withBeatLock` is a single in-process promise chain, and it is the whole
concurrency story:

```ts
let beating: Promise<unknown> = Promise.resolve();
export function withBeatLock<T>(run: () => Promise<T>): Promise<T> { … }
```

It exists because the early-wake trigger can land on top of the standing
interval. Serialising there is cheaper and clearer than making the cursor a log
too.

`writeHeartbeatState` stages to a **uniquely named** temp file
(`…json.<pid>.<random>.tmp`) before renaming. A fixed `state.json.tmp` is the
bug MCS shipped: two writers stage into the same path and the second `rename`
finds nothing there.

Constants worth knowing:

| Constant | Value | Why |
|---|---|---|
| `LOOKBACK_DAYS` | `2` | a beat resuming after a long silence briefs on what is current, not on the archive |
| `ANNOUNCED_CAP` | `500` | the announced-id list is trimmed on write so the cursor cannot grow forever |

`eventsForBeat` is bounded three ways — the lookback window, the cursor, and a
per-beat `limit` (default 10) — so a backlog produces one sensible message
rather than a burst. It filters on **`receivedAt`, not `at`**: the cursor is an
arrival cursor, because producer clocks can be slow or can backfill old causal
times, and filtering on `at` would discard those events forever.

`readEvents` caches parsed events keyed by `(path, mtimeMs)`. Polling tabs and
beats read the same append-only log repeatedly; caching by mtime rather than by
elapsed time means a just-arrived event is never delayed.

## `lib/store/memory.ts`

Three files, two disciplines, matching the pattern above exactly:

| File | Shape | Written by |
|---|---|---|
| `working-set.json` | `{ traces, protocols, updatedAt }` | `writeWorkingMemory` — single-writer atomic replacement |
| `episodes.ndjson` | trace log | `appendEpisodes` |
| `ltm.ndjson` | trace log | `appendLongTerm` |

`writeWorkingMemory` uses the same unique-temp-then-`rename` sequence as
`heartbeat-state.json`, for the same reason: the working set is a snapshot with
one writer, so replacement is correct and appending would be noise. The two
trace logs are append-only and deduped by `id` on read, so one torn append
cannot hide the rest of a durable memory log.

`readMemory` returns a `MemorySnapshot` — `working`, `episodes`, `longTerm`,
`protocols`, `updatedAt` — with each half falling back to empty rather than
throwing.

## `lib/builds/store.ts`

**A build is a promoted snapshot of an app's logic** — its scope, its scoring,
what gets computed — not just its presentation. That is the whole reason the
concept exists, and it is what makes the mapping rule non-negotiable: **an
output belongs to the build that was current when it was produced.** "This
report came from this logic, on this date." A build that only described layout
would not be worth recording.

```ts
interface BuildRecord {
  number; promoted_at; promoted_by?; conversation_id?; session_id?;
  spec?; scope?; refresh_rate?; metadata?;
}
interface BuildDocument { app_id; builds[]; latest_build; current_build; }
```

`scope` is the logic: `queries`, `detectors`, `tables`. `conversation_id` is
lineage — the build chat this came from. `session_id` is the wake-up whose
dashboard was promoted.

| Field | Meaning |
|---|---|
| `latest_build` | the highest number ever promoted |
| `current_build` | what the app opens on |

They differ only after a rollback, and the difference is **shown rather than
hidden**, because a silent pin to an old build is how people end up stranded on
a worse version.

`SHIPPED_BUILDS` gives a fresh checkout a visible, inspectable pointer without
writing anything: `sreoncall` ships builds 2 and 1, the other three apps ship
build 1. These are *shipped defaults, not user promotions* — the first real
promotion simply becomes build N+1 and is durably written to `.data/`, after
which the file wins and the defaults are never consulted again.

App ids are validated against `/^[a-z][a-z0-9_-]{0,63}$/` before becoming a
filename. Writes stage to a unique temp file and rename; `normalize` recomputes
`latest_build` from the records and falls `current_build` back to latest if it
points at a build that is not there.

`buildForSession(builds, startedAt)` is the mapping function: the newest build
whose `promoted_at <= startedAt`, ties broken by number, `null` when the
session has no start time. Pure, so it is testable without a disk.

## `lib/schedule/`

`due.ts` holds the type and the arithmetic and touches nothing else:

```ts
interface ScheduledJob {
  app_id; enabled; interval_hours?; interval_seconds?;
  last_run?; run_count; max_runs?; end_at?;
}
```

`intervalMs` prefers `interval_seconds` over `interval_hours` and returns
`null` when neither is a positive number — which makes a job with no usable
interval permanently not-due rather than instantly due.

`due(job, now)` **takes `now` as an argument, by design.** It is the repository's
purity convention: no ambient clock, so every branch — disabled, run-count
exhausted, past `end_at`, never run, interval not yet elapsed — is testable in
`node --test` with no fake timers.

`store.ts` is one JSON document per app id under `.data/<scope>/schedules/`,
reusing `normalizeAppId` from the build store so both stores validate filenames
identically. `putSchedule` refuses a job without a positive interval; `getSchedule`
returns `null` for anything unreadable; `listSchedules` reads the directory.

## `artifacts/` — runs, specs, and the parse gate

**A run is an immutable directory**: `artifacts/runs/<runId>/dashboard.json`
plus a small `meta.json`. Nothing is ever edited in place, so a reader never has
to reason about a document changing underneath it — it either sees the whole run
or it does not see the run at all.

That "or not at all" is the entire reason `lib/artifacts/read.ts` is more than a
`readFileSync`.

### The parse gate

A producer writes the directory, then the document. **The gap between those two
is real.** For a few milliseconds there is a run directory on disk holding a
truncated JSON file. Listing directories would hand the dashboard a half-parsed
document, and the failure mode is not an error — it is a screen of blanks, on a
page whose entire job is numbers.

So the gate is **the parse itself**. A run exists once its `dashboard.json`
parses *and* carries a valid `run` header, and not one moment earlier:

- `headerOf` reads and parses the document, validates the header shape
  (`id: string`, `asOf: string`, `windowDays: number`, optional
  `source: "sre-engineer"`, optional `incidentId`), and returns `null` for a
  truncated write, a directory with no document, or a document whose `run`
  block is missing.
- `listRuns` includes only directories that clear the gate. `latestRun` is
  `listRuns()[0]`.
- `readRun` applies the same gate to the full document before returning it.

Two supporting details that are easy to get wrong:

- **The directory name is authoritative.** `headerOf` overwrites `run.id` with
  the directory name, because that is what the reader asked for and what every
  other id in the system refers to.
- **Sorting is a byte comparison, never `localeCompare`.** Run ids are
  ISO-derived and fixed-width (`2026-08-09T11-00-00-000Z`), so lexical order
  *is* chronological order. `localeCompare` would look right and be a bug: it
  reads the runtime's locale, and Node and Chrome need not agree — the same
  class of mistake that once put Indian digit grouping on a server-rendered
  number and desynced hydration for every figure on the page.

Parsed headers are cached by `(mtimeMs, size)`. The SSE watcher calls
`latestRun()` on every filesystem event and the poller calls it every fifteen
seconds; re-parsing a 700-row document each time is pure waste, and the
completeness gate *requires* a parse. Stamping on mtime+size keeps the gate
honest — an edited file has a new stamp — while making the steady state a
single `stat`.

Run ids are also validated as a single path segment
(`/^[A-Za-z0-9][A-Za-z0-9._-]*$/`) because `readRun` is reachable from a query
string and `join(dir, "../../etc")` resolves happily.

### The swap rule

`lib/artifacts/useLatestRun.ts` is the client half, and it states the rule
plainly:

> **The run on screen is replaced only by a run that has been fetched and
> parsed in full.**

A failed fetch, a truncated document, a 503 from a directory being rewritten —
none of them clear state. `load()` awaits `res.json()` and runs `isCompleteRun`
*before* anything touches React state, so a truncated body throws while the
previous run is still standing; the catch sets `error` and leaves `run`
untouched.

Anything else means the dashboard blanks whenever the producer is mid-write,
which is precisely when someone is most likely to be looking at it. **An error
is a line of chrome next to stale-but-real numbers, never an empty screen.**

The rest of the hook is ordinary: `EventSource` on `/api/runs/stream` is the
fast path, a 15s poll is the fallback, `open` stops the poller and `error`
restarts it, and the current run id lives in a ref so a new run does not tear
down and re-establish the event source. The `run` event carries an id, not a
document; `load` decides whether the id is new.

### Specs are authored; runs are produced

| | `artifacts/specs/<id>.json` | `artifacts/runs/<runId>/` |
|---|---|---|
| Origin | authored, by a reader | produced, by a generator |
| Lifetime | versioned, edited | immutable once written |
| On a new run | unchanged | a new directory appears |

`bindDashboard(specId, runId?)` loads the spec, picks the run (explicit or
latest), reads the document through the gate, and calls `rebind`. **A new run
rebinds the same spec — it does not regenerate one.** That is what lets a
reader's edits survive a producer dropping a new document every few minutes.
Recomposing instead would discard every edit, on every tick.

`bindDashboard` returns `null` rather than throwing when either half is
missing, because the common case is not an error — it is a checkout where
nobody has run `npm run seed:artifacts` yet, and the page should say so.

`rebind(spec, document)` profiles the document and builds the base tables, and
takes `spec` **without reading it**: the parameter is there to state at the call
site that the spec is the thing that survives a new run. First paint goes
through the same binder the run stream uses, so a server-rendered dashboard and
one that has swallowed three new runs cannot have been built by different code.

### The `import type` trick

`read.ts` imports `node:fs`. `dashboard.ts` imports `read.ts`. Importing either
from a client component drags `node:fs` into the browser bundle and the build
fails.

Both `rebind.ts` and `useLatestRun.ts` avoid this by importing only the *type*:

```ts
import type { RunDocument } from "./read";
```

`import type` is erased before the bundler ever sees the module, so the
type-level contract is shared and no runtime edge exists. That is why `rebind`
lives in its own file at all rather than inside `dashboard.ts` — it is the
half that must be reachable from the browser, because the client receives whole
documents over the run stream and re-profiles them there, keeping first paint
and every subsequent run on exactly one code path.

## The backend seam

`lib/api/client.ts` is **the only place in the app that calls `fetch` for app
data**:

```ts
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
export const USING_FIXTURES = !API_BASE_URL;

export async function fetchBackend<T>(path, options = {}): Promise<T> {
  if (USING_FIXTURES) return handleFixture<T>(path, { body: options.body });
  …
}
```

Unset — the default — and every resource resolves from the fixture backend in
`lib/mock/server.ts`. Set it and the identical call signatures go to the real
service, with `Authorization: Bearer <token>` and `X-Org-Slug` attached from
`FetchOptions`. A non-2xx becomes
`Error("API error <status>: <body>")`.

Because nothing else fetches, **landing the backend is a per-endpoint change
rather than a per-component one**: a resource moves across by deleting its case
in `lib/mock/server.ts`.

What the fixture backend still handles:

| Route | Response |
|---|---|
| `/projects` (`?all=true`) | `{ projects, success }` — `ALL_APPS` when `all=true`, else `OWNED_APPS` |
| `/app-store/catalog` | `{ branch: "main", apps: ALL_APPS }` |
| `/app-store/requests` | `[]` |
| `/builds/{appId}` | `{ app_id, builds, latest_build, current_build }` from `BUILDS` |
| `/conversations/files` | `{ conversations, total_files }` from `CONVERSATION_FILES` |
| `/project/sessions` | `{ sessions, total, success }` — one page holds the whole fixture workspace, so paging terminates on the first request rather than looping the caller's "keep paging" effect |
| `/project/files/{id}` | `{ files, success }` from `WAKE_UP_FILES` |

Anything else rejects with a message naming the route and both ways out: add a
case, or point `NEXT_PUBLIC_API_BASE_URL` at a backend.

**The 140ms delay is deliberate.** Instant resolution hides every loading state,
and a skeleton nobody ever sees is a skeleton nobody notices is broken.

### What is *not* behind the seam

**Conversations and events are real.** They do not go through `fetchBackend`;
they go through this app's own routes to this app's own disk, because the
heartbeat has to write where the browser reads. A fixture conversation store
would mean the proactive loop speaks into a void, which is the one thing the
product is about. Builds are the near case: `lib/api/builds.ts` declares the
wire types and the fixture backend still has a `/builds/{appId}` case, but the
functions call `/api/builds/…` on this server against `lib/builds/store.ts`.
Schedules and runs likewise have local routes and no seam at all.
