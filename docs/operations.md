# Operations

Running it, demoing it, deploying it, and what each failure actually looks like
from the outside. This document assumes [Architecture](architecture.md) for the
process model and [Configuration](configuration.md) for the full variable list.

## Running locally

```bash
npm install
npm run dev              # http://localhost:3000 → /desktop
npm run build
npm start                # serves the production build
npm run typecheck
npm test
npm run lint
```

`/` redirects into `/desktop`; that route is the whole product. There is no
other page worth opening.

### The minimum env to get a live agent

Copy `.env.example` to `.env.local` (gitignored — this remote is public) and set
**one** of:

```bash
ANTHROPIC_API_KEY=sk-ant-...
# or, for a Claude Code OAuth-backed local runtime:
CLAUDE_OAUTH_TOKEN=...
```

That is it. Everything else has a working default. With no key the app still
boots, the desktop still works and the fixtures still resolve — but chat replies
with a configuration error and the heartbeat stays silent **by design**, because
a proactive agent that invents a line when it cannot reach a model is worse than
one that says nothing.

Everything else is optional and additive:

| Variable | Effect when unset |
|---|---|
| `ELEVENLABS_API_KEY` | TTS falls back to the browser's `speechSynthesis`. Voice still works. |
| `SRE_INGEST_SECRET` | `POST /api/events` and `POST /api/heartbeat` are **open**, and the ingest response says `unsecured: true`. |
| `TRUNK_HEARTBEAT_LOCAL_SECONDS` | 900 (15 minutes), matching MCS's cron. |
| `TRUNK_HEARTBEAT_LOCAL` | The in-process loop runs. Set to `0` to turn it off. |
| `DOS_AGENT_MODE_CEILING` | `collab`. Clamped server-side on every request. |
| `DOS_AGENT_DEBUG` | `GET /api/agent/debug` 404s. |
| `NEXT_PUBLIC_API_BASE_URL` | App data (catalogue, files, builds, compliance) resolves from `lib/mock/`. |

Never prefix the model key with `NEXT_PUBLIC_`. It is server-only, and the whole
point of `/api/agent` and `/api/voice` existing is that it stays that way.

## The heartbeat's lifetime

`instrumentation.ts` is the only hook Next gives for "start something that
outlives a request", and `register()` runs **once per server process**:

```ts
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startHeartbeat } = await import("./lib/agent/heartbeat-runner");
  startHeartbeat();
}
```

Two things about that guard, both load-bearing:

- **The edge runtime has no timers that survive a response.** A `setInterval`
  registered there is dead the moment the request that created it completes, so
  the standing loop would silently never beat.
- **Importing the store on edge would fail on `node:fs`.** The event and
  conversation logs are NDJSON files under `.data/`; there is nothing to import
  in an edge sandbox.

So the loop is **in-process**: it lives and dies with the dev server. That is
the right lifetime for a laptop — no orphan cron writing to a `.data/` nobody is
looking at — and explicitly the wrong one for a deployment.

The runner has two triggers and one handler. The standing interval is the
guarantee; `wakeEarly()` (called by `POST /api/events` whenever an event clears
the salience bar) is what makes it demonstrable, debounced by 2.5s so a burst of
events during a failing deploy is one beat with the full picture rather than ten
briefings about one thing. It deliberately **sleeps first**: a beat at boot would
fire during a hot reload and race the conversation seed, and there is nothing it
could know that a beat one interval later could not.

## Deployment shape

```bash
TRUNK_HEARTBEAT_LOCAL=0          # the in-process loop never starts
SRE_INGEST_SECRET=<long random>  # both ingest routes now require it
# DOS_AGENT_DEBUG                  unset — the route should not exist in prod
```

Then point a real scheduler (cron, a platform scheduler, a workflow) at:

```
POST /api/heartbeat
x-internal-secret: $SRE_INGEST_SECRET
```

It is the **same handler** the interval calls, and it shares the beat lock — so
an external scheduler firing while a manual trigger is mid-beat queues rather
than races. Calling it during an interval beat is safe; there is no "two beats
at once" state to get into. `GET /api/heartbeat` needs no secret and reports the
last beat's verdict.

With `SRE_INGEST_SECRET` set, both `POST /api/events` and `POST /api/heartbeat`
check `x-internal-secret` and return 401 on mismatch. They authorize by shared
secret rather than by session because **the caller is a process, not a person**.

### SSE behind a proxy

Two routes stream: `/api/agent` (the model turn) and `/api/runs/stream` (a new
run landed). Both already send `x-accel-buffering: no`, and `/api/runs/stream`
emits a comment line every 25s so an idle connection is not dropped by a proxy's
30–60s timeout.

That is everything the app can do from its side. **The proxy still has to be
configured not to buffer.** nginx honours `x-accel-buffering`; most CDNs and
some ALB/ingress setups do not, and the symptom is not an error — it is the
whole answer arriving at once when the stream closes, which reads as "the agent
is slow" rather than "the proxy is buffering". If you have a choice, exempt
those two paths from response buffering explicitly.

## Demoing it

### `./scripts/demo-incident.sh`

One incident driven through the whole proactive path. It posts six things to
`POST /api/events` at explicit staggered timestamps (16, 11, 9, 7 and 2 minutes
ago — without them everything lands in the same second and working memory reads
`T+00m` five times over, which is accurate and useless):

| Step | What it posts | What it should cause |
|---|---|---|
| 1/6 | `detection`, critical, with a trace and a metric reference | An unprompted message |
| 2/6 | Two competing `diagnosis` events, confidence 0.88 and 0.31 | Brain ranks them; the connection-pool one leads |
| 3/6 | `report`, low, no action items, no evidence | **Silence** — noise must not produce a message |
| 4/6 | The *same* detection again, same `externalId` | Nothing — a retrying producer must not double-report |
| 5/6 | `resolved`, info severity | A message anyway — recovery is always worth saying |
| 6/6 | Polls `GET /api/heartbeat` until it is non-null, then `GET /api/events` | Prints what the beat decided and every event id on file |

It polls rather than sleeps for step 6 on purpose: the early wake debounces for
~2.5s and then takes as long as the model takes, and a fixed wait reported
`null` and read as a broken heartbeat when the beat was simply still thinking.

```bash
./scripts/demo-incident.sh
BASE=http://host:3000 ./scripts/demo-incident.sh
SRE_INGEST_SECRET=... ./scripts/demo-incident.sh   # sends x-internal-secret
INCIDENT=INC-1234 ./scripts/demo-incident.sh       # otherwise INC-$(date +%H%M%S)
```

The script's own closing checklist is the demo script: Chat's home thread should
show **one** unprompted message and not five; Brain should show the P1 header,
the connection-pool hypothesis leading, and working memory from `T+00m`; asking
*"why did you tell me that?"* should cite the event; and `GET /api/agent/runs`
should list every window it moved **by app name, not by handle**.

### Making the loop visible

```bash
TRUNK_HEARTBEAT_LOCAL_SECONDS=30   # ~30s so a standing beat happens on camera
```

Fifteen minutes is the honest production interval and a terrible demo. Drop it
to about 30 seconds and the standing loop becomes something you can watch rather
than something you have to be told about.

### Seeding data

```bash
npm run seed:artifacts        # writes one immutable run under artifacts/runs/
npm run import:sre-runs       # materializes runs from sre-engineer/outputs/
                              #   (not yet on `main` — see docs/README.md)
```

`seed:artifacts` takes `--window 30 --seed 123 --asOf ISO --out DIR` and always
writes the **widest** window: narrower views are a filter over the same document
at read time, and a run per window would put the same estate on disk four times
and let "last 7 days" and "last 30 days" disagree.

`import:sre-runs` is an adapter, not a generator — every displayed fact is read
from a captured incident or alert artifact in `sre-engineer/outputs/`. It exists
so the dashboard cannot quietly substitute a plausible synthetic estate for
INC-001.

## Reset

```bash
rm -rf .data/
```

**That is a complete reset**, and the reason it is complete is worth
understanding rather than trusting: `lib/store/conversations.ts` seeds the
fixture threads to disk on first touch, guarded by a `.seeded` marker file
written *last* — so a crash mid-seed leaves no marker, the next start seeds
again, and the append is idempotent by message id regardless. Delete `.data/`
and the next request rebuilds the fixture threads from scratch. Nothing else
remembers that it used to be seeded.

`artifacts/` is separate and is *not* reset by that: it holds immutable runs.
Delete a run directory to remove it, or re-run `npm run seed:artifacts`.

## Failure modes

| Symptom | Likely cause | Where to look |
|---|---|---|
| Chat replies with a configuration error | No model key. `/api/agent` throws `"Live agent is not configured. Set ANTHROPIC_API_KEY or CLAUDE_OAUTH_TOKEN."` | `.env.local`; `app/api/agent/route.ts` resolves `CHAT_ANTHROPIC_API_KEY \|\| ANTHROPIC_API_KEY`, then `CLAUDE_OAUTH_TOKEN \|\| CLAUDE_CODE_OAUTH_TOKEN` |
| The heartbeat never speaks | Three different silences, and they are distinguishable | **`GET /api/heartbeat`** — this is the whole diagnostic |
| ↳ `{"lastBeat":null}` forever | No beat has completed. Either no model key, or `TRUNK_HEARTBEAT_LOCAL=0` with nothing driving `POST /api/heartbeat`, or the interval has not elapsed yet (it sleeps first) | server log: `[heartbeat] standing loop every Ns` |
| ↳ `silentBecause: "nothing new"` | The cursor already advanced past those events — a previous beat consumed them | `.data/<scope>/` heartbeat state; the cursor moves over everything *considered*, whatever the brain then decides |
| ↳ `silentBecause: "nothing cleared the salience bar"` | Working as intended. Low/info with no action items and no evidence is noise | `lib/agent/salience.ts`; the `because` string on each event says why |
| ↳ `silentBecause: "the brain chose silence"` | Gate two. Salience said eligible; the model said not worth interrupting for | `GET /api/agent/debug` (dev only) for the call |
| Agent says it moved a window, nothing moved | Stale epoch. The window set changed between the snapshot the plan was built from and the plan arriving | The batch rejection message: *"The desktop changed since this plan was made, so none of it ran. Here is the current state — plan again from it."* Every step comes back `skipped` / *"Not attempted — the plan was stale."* See `planBatch` in `lib/os/desktopActions.ts` |
| Agent moved one window then stopped | Not a bug. A `set`-class verb (`open_app`, `close_window`) changes which windows exist, so every handle after it is suspect and the batch truncates: *"an earlier step changed which windows exist…"* | `VERB_TABLE`'s `verbClass` in `lib/os/agentProtocol.ts` |
| A verb is refused in Collab | `focus_panel` and `set_affordance` are the two verbs that still `ask`; `full_screen` is `deny` in every mode and returns its refusal text | `VERB_TABLE`; the refusal names the alternative (`snap` with the `fill` preset) |
| Dashboard blank | The parse gate should prevent this. `latestRun()` only returns a run whose document parses, so a producer mid-write produces *no* SSE event at all | `app/api/runs/stream/route.ts`. If it genuinely blanks, the bug is in the consumer: `useLatestRun` swaps state **only** for a run fetched and parsed in full — a failed fetch, a truncated document or a 503 must leave the previous run on screen and show an error line beside stale-but-real numbers |
| Dashboard shows a run and then jumps backwards | It should not — the stream only ever emits the *newest* id, and a backfilled run with an older `asOf` is a correction to history, not news | `publish()` / `lastEmitted` in the stream route |
| No audio at all | `ELEVENLABS_API_KEY` unset → the route returns `{ provider: "browser" }` and the client uses `speechSynthesis`. That is a fallback, not a failure | `app/api/voice/route.ts`; check the browser actually has voices (`getVoices()` is empty on first call in Chromium and fills in asynchronously) |
| Speech stops mid-sentence | Chromium's engine stalls somewhere around fifteen seconds. Chunking keeps utterances under that and a watchdog resumes a stalled engine | `lib/voice/browser-playback.ts` — `CHUNK_STALL_MS`, the stall timer |
| First word of each reply is clipped | `cancel()` immediately before `speak()` races in Chromium and intermittently kills the *incoming* utterance | same file; the cancel/speak sequencing is deliberate, do not "simplify" it |
| Mic never opens | **A holder opens the microphone, not the mute flag.** `wantsActive` is the gate that decides whether capture may begin; `muted` is a person's preference about an already-live session. `wantsActive && !muted && holders.size > 0` | `lib/voice/mic-session.ts`; `micSessionStateForTests()` reports all three |
| Mic opens and immediately closes, repeatedly | The recogniser ends itself constantly; that is what the restart backoff is for. A permission denial or a missing device ends it permanently | the `onend` path and backoff in `mic-session.ts` |
| The agent talks over itself, or dispatches its own words back as your next instruction | Echo. The barge-in arbiter compares what was heard against what is being said by **token overlap**, not substring — recognition never returns a clean substring of synthesised speech, which is exactly why the substring version almost never matched | `lib/voice/interrupt-arbiter.ts` — `echoSimilarity`, `ECHO_SIMILARITY`, `MIN_WORDS_FOR_ARBITER`. Verdict `local_echo` means it caught one |
| It will not stop talking when you interrupt | The VAD needs sustained speech (`BARGE_VAD_SUSTAIN_MS`) over a level delta, and the arbiter needs at least two words | `lib/voice/barge-vad.ts` |
| `POST /api/events` returns 401 | `x-internal-secret` does not match `SRE_INGEST_SECRET`, or the producer is not sending the header | Compare both sides. The header name is exact |
| Ingest accepts anything from anyone | `SRE_INGEST_SECRET` is unset. The route is **open** and says so: the response body carries `unsecured: true` | Set the variable. This is right for a laptop and wrong everywhere else, which is why it is announced rather than failing quietly open |
| `POST /api/events` returns 400 | The parser names the missing or invalid field in prose, because the caller is another agent and a 400 it can act on beats an exception | `parseEvent` in `lib/agent/events.ts`; `kind` and `severity` are closed sets |
| An event posted twice appears twice | It should not — the id is derived from `source` + `externalId` (or content, when there is no `externalId`), and both logs collapse on **first occurrence wins** | `lib/agent/events.ts`; `lib/store/dedupe` semantics, pinned by `lib/store/__tests__/dedupe.test.ts` |
| `GET /api/agent/debug` 404s | `DOS_AGENT_DEBUG` is unset. 404 rather than 403 is deliberate — the route does not advertise itself | Set `DOS_AGENT_DEBUG=1` in dev only |
| App data is empty or a route 404s in fixture mode | No fixture case for that path. The error names the fix | `lib/mock/server.ts`: *"No fixture for `<route>`. Add a case in lib/mock/server.ts or point NEXT_PUBLIC_API_BASE_URL at a backend."* |

## Observing the agent itself

Four read-only endpoints, and each answers a different question. Nothing here
needs a secret except where noted.

| Endpoint | Question it answers | Notes |
|---|---|---|
| `GET /api/heartbeat` | **What did the last beat decide, and why?** `{ lastBeat: { considered, mattered, spoke, message?, silentBecause? } }` | In-memory, per process. `null` means no beat has completed since boot. This is the first thing to check when the loop seems dead |
| `GET /api/agent/runs` | **What did the agent do to my desktop?** Every batch, on disk, with mode, requested mode, ceiling, origin (`typed` \| `voice`), whether it was approved, how it ended, and each step's verb, resolved app and status | `.data/<scope>/agent-runs.ndjson`. Steps name the **resolved app, never the handle** — `[2]` means nothing once the window set changed, `Files` means something forever. This is the thing that answers "why did my windows move" a week later |
| `GET /api/agent/debug` | **What did the model actually see?** The last 20 calls: lane, model, tools offered, requested-vs-clamped mode, errors | Dev only — 404s unless `DOS_AGENT_DEBUG=1`. Prompt-adjacent metadata, never the conversation. In-memory, gone on reload |
| `GET /api/events` | **What has been reported?** The last 100 events, newest first | Also the quickest way to confirm the ingest pipe works at all |

The distinction between `/api/agent/debug` and `/api/agent/runs` is the one to
internalise: **debug is the model's side of a turn, in memory, gone on reload.
Runs is the desktop's side, on disk, permanent.** When something moved and
should not have, you want runs.
