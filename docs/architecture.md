# Architecture

## The one-sentence version

Two agents that do not share a process, a language runtime, or a model
provider: an **SRE engineer** that watches telemetry and produces evidence,
and a **desktop manager** that decides what is worth a person's attention and
shows it on a screen it can drive itself. They meet at exactly one interface —
`POST /api/events` — and that narrowness is the design.

## Why two agents

The temptation is one agent with observability tools. It was rejected, and the
reasoning is written into the manager's system prompt (`app/api/agent/route.ts`):

> A separate SRE agent watches the systems — metrics, logs, traces. It reports
> what it finds to you. You do not query telemetry yourself and should not
> offer to.

Three consequences follow, and all three are load-bearing:

1. **Every claim the desktop agent makes is traceable to an event another
   process wrote.** It cannot answer "why did you tell me that" from memory,
   because it has no telemetry access to have remembered anything from. It has
   to read the log back (`read_events`), and the log is on disk.
2. **The expensive, slow, dangerous work is isolated.** The SRE side runs
   unattended, holds the credentials to the observability stack, and can open
   pull requests. The desktop side holds a microphone and a window manager. A
   compromise of either does not reach the other's capabilities.
3. **They can be tested separately, and they are.** The manager's whole
   proactive path is tested against synthetic events with no network at all.

## The three planes

```
┌── PRODUCER PLANE ─────────────────────────────────────────────────────┐
│  sre-engineer/   Claude-native shift engineer (six owned capabilities) │
│  agent/          Node + OpenAI detect-and-triage loop                  │
│  lib/sre/        synthetic estate generator (fixtures for artifacts)   │
│         │                                                             │
│         └── writes ──► outputs/<run>/…   artifacts/runs/<runId>/…      │
│         └── posts  ──► POST /api/events                                │
└───────────────────────┬───────────────────────────────────────────────┘
                        │  (shared secret; never a session)
┌── SERVER PLANE ───────▼───────────────────────────────────────────────┐
│  app/api/events        ingest, validate, derive id, append            │
│  lib/store/*           append-only NDJSON under .data/<scope>/        │
│  lib/agent/heartbeat*  the standing loop: salience → brain → cursor   │
│  lib/agent/memory/*    STM / MTM / LTM traces, decay and reinforcement│
│  app/api/agent         the live model turn (two lanes, SSE)           │
│  app/api/voice         spoken summary + ElevenLabs TTS  (not on main)  │
│  lib/artifacts/read    immutable run reader (parse-gated)             │
└───────────────────────┬───────────────────────────────────────────────┘
                        │  SSE + polling; verbs return to the browser
┌── BROWSER PLANE ──────▼───────────────────────────────────────────────┐
│  lib/os/*              window manager, agent protocol, executor       │
│  lib/voice/*           mic ownership, VAD, barge-in, consent, playback│
│  components/os/*       desktop, dock, menu bar, Spotlight, apps       │
│  packages/disco-core   dashboard spec, solver, algebra (isomorphic)   │
└───────────────────────────────────────────────────────────────────────┘
```

The unusual seam is the bottom one. **Desktop tool calls are planned on the
server and executed in the browser.** The model's tool call returns to the
client, which runs it against the live window manager through a guarded
controller and sends back a text result. The server never holds a window.

This is not an accident of Next.js. The window manager is React state; the only
place that can honestly report what a window is doing is the process that owns
it. A server-side model that believed it had moved a window would be exactly
the failure the whole protocol exists to prevent.

## How a signal becomes a spoken sentence

The full path, end to end, with the file that owns each hop:

| # | Step | Owner |
|---|---|---|
| 1 | Telemetry swept, judged, evidenced | `sre-engineer/` or `agent/src/agents/triage.js` |
| 2 | Finding posted as an event | `POST /api/events` → `app/api/events/route.ts` |
| 3 | Validated, id **derived** from content, appended | `lib/agent/events.ts` → `lib/store/events.ts` |
| 4 | Clears the salience bar? wake the loop early (debounced 2.5s) | `app/api/events/route.ts` → `lib/agent/heartbeat-runner.ts` |
| 5 | **Gate 1 — salience**: arithmetic weight vs cut-off | `lib/agent/salience.ts` |
| 6 | Memory consulted: is this familiar, contradicted, recurring? | `lib/agent/memory/index.ts` |
| 7 | **Gate 2 — the brain**: one model call, no tools, fails closed | `lib/agent/heartbeat-brain.ts` |
| 8 | **Gate 3 — the cursor**: advances over everything briefed | `lib/store/events.ts` |
| 9 | Message appended to the home conversation, `source: "heartbeat"` | `lib/store/conversations.ts` |
| 10 | Chat's 15s poll picks it up in an idle tab | `components/os/apps/ChatApp.tsx` |
| 11 | If ambient listening is on and nobody is mid-sentence, it is spoken | `lib/voice/proactive-speech.ts` |
| 12 | Asked "why did you tell me that", the reasoning lane reads the log back | `lib/agent/data-tool-client.ts` |

Step 8 is the one people get wrong. The cursor advances over events the brain
chose **not** to speak about. Silence is a verdict, not a deferral — without
that, the same event returns every fifteen minutes forever.

## Process model

| Process | Lifetime | Started by |
|---|---|---|
| Next.js server | The deployment | `npm run dev` / `npm start` |
| In-process heartbeat | The server process | `instrumentation.ts` → `register()`, Node runtime only |
| Browser desktop | A tab | Navigating to `/desktop` |
| SRE shift | One shift, then exits | `sre-engineer/run.sh`, one `claude -p` per capability |
| Signal agent | Runs forever, self-paced | `agent/run.js` (`npm start`) |

The heartbeat's in-process interval is explicitly a laptop affordance. A
deployment sets `TRUNK_HEARTBEAT_LOCAL=0` and points a real scheduler at
`POST /api/heartbeat`, which shares the same beat lock, so an external
scheduler and a manual trigger cannot overlap.

## The two hard boundaries

**The consent boundary.** Not "the agent may act" vs "may not" — the agent
arranges windows freely in Collab mode. The line sits where it reaches *inside*
an app and changes what you are working on: `focus_panel` and `set_affordance`
ask; everything else does not. Rationale in [Agent control](agent-control.md).

**The evidence boundary.** The desktop agent renders nothing it was not told.
`lib/agent/brain-view.ts` derives Brain's incident header, hypotheses and
working memory from the event log, and a field the events did not carry renders
as **absent**, never as a plausible number. There is no inferred confidence
anywhere in the product.

## What is deliberately not here

- **No LGTM tools on the desktop agent.** Mimir, Loki and Tempo belong to the
  producer plane.
- **No shell, `kubectl`, container or VM execution** anywhere in the app.
- **No screenshot or pointer computer-use.** Semantic verbs are the design.
- **No identity provider for people.** See [Security](security.md).
