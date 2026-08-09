# HTTP API

Every route under `app/api`. All of them are `runtime = "nodejs"` — they touch
the filesystem, the clock or an upstream API — and almost all are
`dynamic = "force-dynamic"`, because a cached response would pin the app to
whatever state existed at build time.

There are three kinds of caller here and they authenticate differently:

| Caller | Routes | Auth |
|---|---|---|
| The browser, same-origin | most of them | none — the trust boundary is the process, not the request |
| A machine producer (the SRE agent, a real cron) | `/api/events`, `/api/heartbeat` | `x-internal-secret` shared secret |
| An operator debugging | `/api/agent/debug` | an environment variable, not a header |

Nothing here reads a session or a bearer token. `lib/api/client.ts` attaches
`Authorization` and `X-Org-Slug` — but only to the *external* backend, never to
these routes. Scope is server-side: `scopeKey()` decides which `.data/`
directory a route touches, and no request can influence it.

## Every route

| Method | Path | Purpose | Auth |
|---|---|---|---|
| `POST` | `/api/agent` | Run a turn; SSE | none |
| `GET` | `/api/agent/debug` | Recent model calls (metadata only) | `DOS_AGENT_DEBUG` |
| `GET` | `/api/agent/policy` | Workspace mode ceiling | none |
| `GET` | `/api/agent/runs` | What the agent did to the desktop | none |
| `POST` | `/api/agent/runs` | Record a desktop run | none |
| `POST` | `/api/voice` | Summarize an answer for speech, and synthesize it | none |
| `GET` | `/api/conversations` | The conversation rail | none |
| `GET` | `/api/conversations/{id}` | One thread's messages | none |
| `POST` | `/api/conversations/{id}` | Append messages, or mark read | none |
| `POST` | `/api/events` | Ingest an SRE event | `SRE_INGEST_SECRET` |
| `GET` | `/api/events` | The last 100 events, newest first | none |
| `POST` | `/api/heartbeat` | Beat now | `SRE_INGEST_SECRET` |
| `GET` | `/api/heartbeat` | What the last beat decided | none |
| `GET` | `/api/brain/memory` | Ranked, decayed memory view | none |
| `GET` | `/api/runs` | Index of SRE-engineer runs | none |
| `GET` | `/api/runs/latest` | The newest complete run document | none |
| `GET` | `/api/runs/stream` | SSE: "a new run landed" | none |
| `GET` | `/api/runs/{runId}` | One complete run document | none |
| `GET` | `/api/builds/{appId}` | The app's promoted builds | none |
| `POST` | `/api/builds/{appId}/promote` | Promote a new build | none |
| `POST` | `/api/builds/{appId}/current` | Roll back to an existing build | none |
| `GET` | `/api/schedule/{appId}` | The app's schedule, or null | none |
| `PUT` | `/api/schedule/{appId}` | Create or replace the schedule | none |
| `DELETE` | `/api/schedule/{appId}` | Remove the schedule | none |

---

## Agent

### `POST /api/agent`

Run one turn of the live desktop agent and stream it back.

**Request**

```jsonc
{
  "messages": [ /* LiveAgentMessage[] — required, non-empty */ ],
  "voice": true,        // optional: start on the reasoning lane
  "forceHeavy": true,   // optional: same
  "agentMode": "collab" // optional preference; never an authorization
}
```

`LiveAgentMessage` is `{ role: "user", content: string }`,
`{ role: "assistant", content: LiveAgentContent[] }`, or
`{ role: "tool", toolUseId, content: string }`. Only the last 40 are sent
upstream.

**Response — `text/event-stream`**, frames as `data: <LiveAgentFrame>`:

| Frame | Meaning |
|---|---|
| `{ type: "text_delta", text }` | a fragment of the reply, as generated |
| `{ type: "discard" }` | the light lane is withdrawing what it just said, on its way to handing the turn to the reasoning lane |
| `{ type: "done", response: { content, lane, mode, ceiling } }` | the assembled turn |
| `{ type: "error", error }` | the turn failed |

Text streams; tool calls do not. A tool call's arguments arrive as fragments of
JSON and half a plan is not actionable, so they are assembled server-side and
appear once, inside `done`, in the same `LiveAgentContent[]` shape the buffered
route returned — which is what keeps the next request's history byte-identical.

**Status codes**

| Code | When |
|---|---|
| `200` | the stream opened |
| `400` | `messages` is not a non-empty array |
| `500` | the request body itself could not be handled |

**The failure mode worth knowing.** The route answers **200 before it knows the
turn will succeed** — headers go out with the stream, and by the time a model
call fails there is no status code left to change. So failures arrive *in the
stream*, as an `error` frame, and a client that only checks `res.ok` will
believe every turn succeeded. Missing credentials
(`ANTHROPIC_API_KEY` / `CLAUDE_OAUTH_TOKEN`) surface exactly this way.

**Mode clamping.** The client sends a preference; a preference is never an
authorization. The server re-reads `DOS_AGENT_MODE_CEILING` per request and
clamps. It fails closed — an unset or misspelled ceiling is `collab`, not
`auto` — because the cost of guessing low is one approval click and the cost of
guessing high is an agent reaching inside an app nobody said it could touch. The
mode that actually ran is echoed in `done.response.mode`, since the browser
executes the desktop verbs and has to be told what it is allowed to do.

Response headers include `x-accel-buffering: no`: Nginx and friends buffer SSE
by default, which turns a stream back into the blocking request this replaced.

### `GET /api/agent/debug`

The last few model calls, newest first — timestamps, model, lane, requested
mode / ceiling / effective mode, tool names offered, message count, outcome
(text-block count, tool calls, whether it deferred), duration, and any error.
Prompts-adjacent metadata; never the conversation.

**Response** `{ "calls": AgentCall[] }`.

| Code | When |
|---|---|
| `200` | `DOS_AGENT_DEBUG` is set |
| `404` | it is not — `{ "error": "Not found" }` |

**It 404s rather than 403s, deliberately, so the route does not advertise
itself.** A 403 tells an unauthenticated prober that something is there and
worth coming back for; a 404 is indistinguishable from the route not existing.
Leaving it on in a dev environment leaks nothing about the user, but it has no
business existing in a deployed one.

### `GET /api/agent/policy`

What the workspace permits and what this user last chose.

**Response** `{ "preference": null, "ceiling": OsAgentMode }`. Always `200`.

`ceiling` is the same value `/api/agent` re-reads per request. This endpoint
exists so the mode selector can *explain* a downgrade instead of silently
applying one — nothing the client does with the answer can raise what the agent
is allowed to do. `preference` is `null` because there is no per-user store yet;
the browser's own `localStorage` remains the source of the user's choice until
one lands.

### `POST /api/agent/runs`

Record what the agent did to the desktop. Appends one line to
`.data/<scope>/agent-runs.ndjson`.

**Request** — accepted fields: `requested_mode`, `mode`, `origin`
(`"typed" | "voice"`), `conversation_id`, `tool_call_id`, `approved`, `ended`
(`"completed" | "stopped"`), `steps: [{ verb, app_id?, detail?, status }]`.

The server stamps `id` and `recorded_at`, and **recomputes `ceiling` from the
environment rather than taking it from the client** — a record that repeated
whatever the browser claimed would be worthless as evidence of anything.

**Response** `{ ok: true, id }`, or `{ ok: false }` if the write failed. Always
`200`: the action has already happened, and failing the turn over the
bookkeeping would be worse than losing the record.

Steps name the **resolved app**, never the handle. `[2]` means nothing once the
window set has changed; `Files` means something forever.

### `GET /api/agent/runs`

The desktop's history: `{ "runs": RunRecord[] }`, last 100, newest first.
Unparseable lines are skipped; a missing file returns `{ "runs": [] }`. Always
`200`.

Distinct from `/api/agent/debug`, and the distinction matters: debug is the
model's side of a turn, in memory, gone on reload. This is the desktop's side,
on disk, and it is what answers "why did my windows move" a week later.

> **Not yet on `main`.** This describes work on `codex/sreoncall-colored-run-outputs`; see the scope note in [docs/README.md](README.md).

### `POST /api/voice`

Turn a written answer into a short spoken line, and optionally into audio.

**Request** `{ answer?: string, userAsk?: string, spoken?: string }`. At least
one of `answer` or `spoken` must be non-empty.

**Response** `{ spoken, provider, mimeType?, audioBase64? }` where `provider` is
`"elevenlabs"`, `"browser"` or `"silent"`.

| Code | When |
|---|---|
| `200` | including the `provider: "silent"` case |
| `400` | neither `answer` nor `spoken` supplied |
| `500` | the request could not be parsed |

Two rules are load-bearing. **A direct `spoken` line bypasses the summarizer**
and is reserved for already-authored voice copy such as a consent prompt;
normal answers always pass through it. And when summarization yields nothing,
the route returns `provider: "silent"` and **never falls back to reading
`answer`** — silence is safer than turning the screen's markdown into an
accidental audiobook. A TTS failure degrades to `provider: "browser"` inside a
`catch`, so it can never take down the visible answer.

---

## Conversations

Neither of these routes is behind the fixture seam. They read and write real
files, because the heartbeat has to write where the browser reads.

### `GET /api/conversations`

The rail. Calls `ensureSeeded()` first, so a fresh `.data` produces the fixture
threads rather than an empty product.

| Query | Effect |
|---|---|
| `?with=<id>` | include that thread's messages |
| `?all=1` | include every thread's messages |

The home thread's messages are **always** included, because it is the one
something other than this browser writes to. Everything else ships as a
summary — id, title, `isHome`, `updatedAt`, `unread`, empty `messages` — until
it is opened. `?all=1` exists for the activity panel, which genuinely reads
across every thread; asking for it explicitly keeps it out of the 15s poll that
runs whether or not anyone is looking.

**Response** `{ "conversations": StoredConversation[] }`, newest activity first.
Always `200`.

### `GET /api/conversations/{id}`

**Response** `{ id, messages }`, ordered by `at` with `id` as tiebreak, deduped.
Always `200` — an unknown id is an empty array, not a 404, because a thread that
has never been written to and a thread that does not exist are the same thing in
an append-only store.

This is what the chat polls, and it is the only way a message written by
something other than this browser tab — the heartbeat — becomes visible.

### `POST /api/conversations/{id}`

Two jobs, distinguished by the body.

```jsonc
{ "markRead": true }                    // clear the unread badge
{ "messages": [ /* StoredMessage[] */ ] } // append
```

Messages are filtered before writing: each must have string `id`, `at` and
`text`. Invalid entries are dropped silently and `written` reports what actually
landed.

**Response** `{ ok: true, written: number }`.

| Code | When |
|---|---|
| `200` | appended, or marked read (`written: 0`) |
| `400` | `messages` is not an array and `markRead` is not `true` |

The append is deliberately a **batch**: a turn produces a user line, several
trace rows and a reply, and sending them as one write keeps the ordering the
browser already decided. Marking read is also a write — the badge has to be
clearable or it only ever counts up — and it is implemented as an append too, so
the log stays append-only.

---

## Events & heartbeat

Both of these are authorized by a **shared secret rather than a session**,
because the caller is a process, not a person:

```ts
const expected = process.env.SRE_INGEST_SECRET;
if (!expected) return true;
return request.headers.get("x-internal-secret") === expected;
```

A mismatch is `401 { "error": "Unauthorized" }`. An unset `SRE_INGEST_SECRET`
leaves the route **open**.

### `POST /api/events`

Where the SRE agent posts what it found.

**Request** — `SreEventInput`:

| Field | Required | Notes |
|---|---|---|
| `source` | yes | which agent or system is speaking |
| `kind` | yes | `detection` \| `incident` \| `diagnosis` \| `remediation` \| `resolved` \| `report` |
| `severity` | yes | `critical` \| `high` \| `medium` \| `low` \| `info` |
| `headline` | yes | one line |
| `summary` | no | |
| `actionItems` | no | `string[]` |
| `evidence` | no | `[{ kind, ref, label? }]` — references, never payloads |
| `sessionId`, `incidentId` | no | |
| `confidence` | no | 0–1, never inferred |
| `externalId` | no | the producer's own id; used for dedupe |
| `at` | no | defaults to now |

`id`, `receivedAt` and the array defaults are stamped on arrival. The id is
**derived** — `evt-<source>-<externalId>` or
`evt-<source>-<headline>-<at to seconds>` — so an SRE agent that retries a
failed POST does not produce a second event, and does not have to send an id to
get that.

**Response**

```jsonc
{ "ok": true, "id": "evt-…",
  "salience": { "weight": 4, "matters": true, "because": "critical severity, has action items" },
  "unsecured": false }
```

| Code | When |
|---|---|
| `200` | accepted |
| `400` | body is not JSON, or `parseEvent` rejected it — the error names the field |
| `401` | `x-internal-secret` mismatch |

**`unsecured: true` means `SRE_INGEST_SECRET` is unset** and the route accepted
an unauthenticated write. It is reported in the response rather than only
logged, because open ingest is *right for a laptop and wrong everywhere else* —
saying so out loud beats failing quietly open. Treat it as an alarm in any
deployed environment.

A 400 names the missing or invalid field on purpose: the producer is another
agent, and a reason it can act on is worth more than an exception.

Anything clearing the salience bar calls `wakeEarly()`. A SEV-1 that waits
fifteen minutes for the next tick is a capability nobody can demonstrate and
nobody would trust; the runner debounces, so a burst is still one beat.

### `GET /api/events`

`{ "events": SreEvent[] }` — last 100, newest first. For the apps, and for
checking the pipe works. No auth: reading is not writing. Always `200`.

### `POST /api/heartbeat`

Beat now. The same handler the in-process interval calls, exposed so a real
scheduler can drive it in a deployment and so a demo can force one without
waiting.

**Response** — `BeatResult`:

```jsonc
{ "considered": 3, "mattered": 1, "spoke": true,
  "message": "…", "silentBecause": "…" }
```

| Code | When |
|---|---|
| `200` | the beat ran |
| `401` | `x-internal-secret` mismatch |

It shares the beat lock, so calling this mid-interval is safe rather than
racy — it queues behind whatever is running.

### `GET /api/heartbeat`

`{ "lastBeat": BeatResult | null }` — what the last beat decided, and why.
`null` before the first beat of the process, since the runner is in-process and
its memory dies with the dev server. Always `200`.

---

## Runs & artifacts

All four read `artifacts/runs/` through the completeness gate in
`lib/artifacts/read.ts`: a run exists once its `dashboard.json` parses and
carries a valid header, and not one moment earlier.

### `GET /api/runs`

`{ "runs": RunSummary[] }` — the immutable run index used by the Outputs file
browser, **filtered to `source === "sre-engineer"`**, newest first. Incomplete
runs are absent, not errored. `cache-control: no-store`. Always `200`.

### `GET /api/runs/latest`

The newest complete run, as JSON. Both the initial fetch and the polling
fallback, so it is the one path that must work when nothing else does — no
stream, no watcher, no event source. It reads the disk on every request by
design: the whole point of writing runs as files is that a new one appears
without a rebuild.

**Response** `{ runId, asOf, document }`.

| Code | When |
|---|---|
| `200` | a complete run exists |
| `404` | no runs at all — `{ "error": "no runs found. Run: npm run seed:artifacts" }` |
| `503` | listed a moment ago, unreadable now |

The **503 is the interesting one**. It means the run was listed and then failed
to read, which is a directory being rewritten underneath the request — a
transient state, not a missing resource. 503 says *retry*; 404 would say *give
up*. The client honours that by leaving the previous run on screen either way.

### `GET /api/runs/stream`

Server-sent events: "a new run landed."

**Frames**

```
retry: 3000

event: run
data: {"runId":"2026-08-09T12-21-46-000Z","asOf":"…"}

: ping
```

**The stream carries an identifier, never a document.** Pushing the whole run
down the wire would double the transport — the polling fallback still has to
fetch it — and would make the event size grow with the estate. The client hears
an id it has not seen and fetches `/api/runs/latest`.

Three things make it survive contact with a real producer:

| Mechanism | Value | Why |
|---|---|---|
| **Debounce** | 300ms | a producer writes a directory, then a document, then a meta file; `fs.watch` fires for each and on macOS often twice per file. Emitting per event would push three or four times per run. |
| **The parse gate** | — | `latestRun()` only returns a run whose document parses, so the window between "directory created" and "document closed" produces no event at all. Without it the client fetches a truncated file and the dashboard blanks. |
| **Heartbeat comment** | 25s | proxies drop an idle connection at 30–60s. A `: ping` line is traffic without being data — and it doubles as a cheap backstop: if the watcher failed or missed an event, a run is at worst one heartbeat late rather than invisible. |

Only the **newest** id is ever emitted, and never the same one twice. A
backfilled run with an older `asOf` is a correction to history, not news;
pushing it would walk the dashboard backwards in time while someone is reading
it.

The watch is **recursive**, because the document lands *inside* a new run
directory and a flat watch on the parent never sees that write — it would fire
once for the `mkdir`, 300ms before the file exists, and then be silent for the
write that actually completes the run. Filesystems that refuse recursive watches
fall through to the heartbeat tick and the client's poll. Always `200`;
`x-accel-buffering: no` for the same proxy reason as `/api/agent`.

### `GET /api/runs/{runId}`

One complete run for the Files/Outputs preview.

**Response** `{ runId, document }`, `cache-control: no-store`.

| Code | When |
|---|---|
| `200` | complete |
| `404` | `{ "error": "run not found or incomplete" }` |

Absent and incomplete are the same answer here on purpose — from a reader's
side there is no difference, and the id shape is validated before any path is
joined, so a traversal attempt is a 404 too.

---

## Builds & schedule

App ids are validated against `/^[a-z][a-z0-9_-]{0,63}$/` before becoming a
filename; a bad one is a `400`, not a traversal.

### `GET /api/builds/{appId}`

`{ app_id, builds, latest_build, current_build }`, builds newest first. Falls
back to the shipped defaults when nothing has been promoted, so a fresh checkout
still has a visible, inspectable pointer.

`current_build` differs from `latest_build` only after a rollback, and the
difference is shown rather than hidden — a silent pin to an old build is how
people end up stranded on a worse version.

| Code | When |
|---|---|
| `200` | always, for a valid app id |
| `400` | invalid app id |

### `POST /api/builds/{appId}/promote`

**Request** `{ conversation_id?, session_id?, metadata? }` — and a missing or
unparseable body is treated as `{}` rather than as an error.

**Response** `{ app_id, build }` where `build.number` is `max + 1` and
`promoted_at` defaults to now.

| Code | When |
|---|---|
| `200` | promoted; the document is durably written |
| `400` | invalid app id, or the write failed |

Builds belong to the workspace, so this changes what colleagues open — worth a
confirm at the call site.

### `POST /api/builds/{appId}/current`

Roll back to an existing build.

**Request** `{ "build": <integer> }`.

| Code | When |
|---|---|
| `200` | `BuildDocument` with the new `current_build` |
| `400` | `build` is not an integer, invalid app id, or `build not found` |

Kept distinct from promotion precisely so the `latest` / `current` gap stays
visible.

### `GET /api/schedule/{appId}`

`{ "schedule": ScheduledJob | null }`. `null` for no schedule, an unreadable
file, or a bad id. Always `200`.

### `PUT /api/schedule/{appId}`

Create or replace. **Request** — any of `enabled`, `interval_hours`,
`interval_seconds`, `last_run`, `run_count`, `max_runs`, `end_at`. Defaults:
`enabled: true`, `last_run: null`, `run_count: 0`, `max_runs: null`,
`end_at: null`.

| Code | When |
|---|---|
| `200` | `{ schedule }` — the normalized job as stored |
| `400` | `a positive interval_hours or interval_seconds is required`, or an invalid app id |

The interval is mandatory because `intervalMs` returns `null` without one, and
`due()` treats a null interval as never-due — a job accepted without an interval
would be stored, listed, enabled, and silently never run.

### `DELETE /api/schedule/{appId}`

Removes the file. `204`, no body. Idempotent — deleting a schedule that is not
there succeeds.

---

## Brain

### `GET /api/brain/memory`

The derived memory view: traces decayed to *now*, ranked and capped per tier,
plus protocol state and per-node activity computed against the current event
log.

**Response**

```jsonc
{ "memory": { "working": [], "episodes": [], "longTerm": [],
              "protocols": {}, "activityByNode": {} },
  "hasLiveData": false }
```

`hasLiveData` is `true` when any tier is non-empty — it is what lets the Brain
surface distinguish *nothing has happened yet* from *something is broken*,
which are the same empty screen otherwise.

Derived memory has its own route rather than riding on `/api/events` because raw
events and ranked memory have genuinely distinct consumers: the event list wants
what arrived, the Brain wants what is still salient. Always `200`.
