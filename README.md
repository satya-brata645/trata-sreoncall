# Trata — DOS

The Developer Operating System: a proactive agentic security engineer that works
your desktop rather than only reporting to it.

This is Trata's core app. The OS layer — window manager, agent protocol, desktop
verbs — is ported from `transilience/local/mcs` (branch `feat/sos2-proposal`)
and restyled to the DOS design system.

The agent is live. Real model turns over SSE, real voice in and out, a standing
proactive loop that speaks first, and an append-only event log and conversation
store on disk that the browser and the heartbeat both write to. What is still
fixture is **app data** — the catalogue, files, builds and the compliance
surfaces — and it sits behind a single seam, so the backend lands one endpoint
at a time rather than one component at a time. The table below is the whole
boundary; nothing else in this file is hedged.

```bash
npm install
npm run dev      # http://localhost:3000 → /desktop
npm run build
npm run typecheck
npm test         # 374 assertions, no network
npm run lint
```

Eight suites: the window manager and geometry, the agent protocol and turn
machine, the salience arithmetic, the brain derivation, the store's dedupe, and
every voice state machine. All pure, none of it mocking a model.

## What is live, and what is not

| | | |
|---|---|---|
| **Agent turns** | live | `/api/agent` streams from `claude-haiku-4-5` and `claude-sonnet-5`; the key stays server-side. |
| **Desktop control** | live | Semantic verbs, planned server-side and executed in the browser against the guarded controller. The mode ceiling is re-read and clamped on every request. |
| **Voice** | live | Recognition and synthesis are the browser's; the session ownership, barge-in, echo check, consent parser and wake word around them are ours, and tested. |
| **Proactive loop** | live | A standing heartbeat with three gates, an early wake on critical, and `GET /api/heartbeat` reporting what the last beat decided and why. |
| **Events + conversations** | live, on disk | Append-only NDJSON under `.data/` (`lib/store/`), deduped by derived id, safe for two concurrent writers. |
| **Brain** | live, derived | Incident header, hypotheses and working memory read from the event log; fixtures are only the empty state. |
| **Machine ingest** | real secret | `POST /api/events` and `POST /api/heartbeat` check `SRE_INGEST_SECRET`, and the response says `unsecured: true` when it is unset. |
| **Apps, Files, App Store, compliance** | fixture | One seam (`lib/api/client.ts`); set `NEXT_PUBLIC_API_BASE_URL` and the identical calls go to the service. |
| **Human identity** | fixed principal | No provider yet. `lib/auth/scope.ts` serves one user and org behind the real `orgId \|\| userId` key shape, and it is the only module a provider has to replace. |

## Why this is a different shape of product

Most agent products are a chat box bolted to a dashboard: you ask, it runs, you
wait, it reports. Four things here are deliberately not that.

**There are no runs.** Apps are durable surfaces — you open one and the answer
is already there, which is why every one carries an *as of* stamp instead of a
spinner. Work happens on a standing loop, not on your click.

**It speaks first, and it can be argued with.** The proactive path is three
gates, and the first one is arithmetic rather than a model call, so *"why did
you tell me this?"* has an answer you can inspect and disagree with. The
reasoning lane can read its own event log back mid-conversation, so a follow-up
is answered from the record rather than from memory.

**It works the desktop instead of describing it.** No screenshots, no mouse
coordinates. A structured snapshot, semantic verbs, integer handles re-issued
whenever the window set changes, and a containment layer that decides what each
verb may refuse. The failure mode of pixel agents — clicking a stale coordinate
— is not reachable from here.

**The voice is a first-class lane, not text-to-speech.** Push-to-talk and an
always-on wake word are separate promises with separate defaults; one
microphone has one owner; barge-in is decided locally in the couple of hundred
milliseconds it actually has; an unanswered spoken approval is **denied**, and
the agent cannot approve itself by echo.

## It has already worked a shift

The other half of the system — the SRE agent that watches LGTM and posts what it
found — has run for real, and its output is committed rather than described:

- `sre-engineer/outputs/<run>/` — four recorded runs: the alerts raised, the
  incidents opened, per-skill JSONL session logs, and postmortems.
- `sre-engineer/outputs/20260809_105306/shift-report.md` — one anomaly, tracked
  as two incidents. One fix proposed, blind-reviewed and **merged** (PR #11).
  The other root-caused to an environment flag with no code to change, and
  correctly left unfixed with a written hand-off.
- `sre-engineer/remediations/inc-001/` — the proposed change, the rationale, and
  `PR-PENDING.md`, which exists because a push was blocked by a safety guard and
  the agent stopped rather than route around it.
- `E2E-TEST-RESULTS.md` — the full run: typecheck, unit suite, production build,
  runtime smoke, lint, observability reachability, skill chain.

An agent that declines to disable a guard unattended, and writes down that it
declined, is the whole pitch in one file.

---

## The three constructs

Everything at root is one of three things, plus settings
(`docs/os-concept.md` in the MCS repo is the product doctrine):

| | | |
|---|---|---|
| **Brain** | `components/os/apps/BrainApp.tsx` | What it believes, where each belief came from, and what it is working on. Inspectable and correctable. |
| **Apps** | `LaunchpadApp.tsx`, `SecurityAppWindow.tsx` | The durable surfaces. **There are no runs** — you open an app and the answer is already there, which is why every one carries an *as of* stamp. |
| **Chat** | `ChatApp.tsx` | The agentic interface. It answers *and* drives the desktop; the trace rows under a reply are that work being shown rather than described. |

Plus **Files** (`FilesApp.tsx`) — the frozen half. In-app content is live; files
are snapshots, which is what makes them citable. The tree is derived, never
authored: no new folder, no move, no rename.

## Agent control

The agent does not use screenshots or mouse coordinates. It reads a structured
snapshot and acts through semantic verbs — `open_app`, `focus`, `snap`,
`focus_panel`, `set_affordance` — addressed by small integer handles that are
re-issued whenever the window set changes.

- `lib/os/agentProtocol.ts` — snapshot, handles, epoch, the verb union
- `lib/os/desktopActions.ts` — what each verb plans and refuses
- `lib/os/DesktopControllerContext.tsx` — batch execution, containment, narration
- `app/api/agent/route.ts` — the live DOS agent route. Typed desktop-only turns
  start on the light model and can defer to the reasoning model; voice starts
  directly on the reasoning model. Desktop tools return to the browser for
  execution against the guarded window controller.

Two chords, two acts: `⌘K` opens Spotlight (find, then open); `⌥Space` summons
the agent (say something). Spotlight finds; the command bar talks.

Two modes, not three: **Self** (the agent talks, and the verbs are not offered
at all) and **Collab** (it opens and arranges windows freely, and asks before
reaching *inside* an app). The ceiling is re-read server-side on every request
and the clamped mode is returned to the browser, because the browser is what
runs the verbs — a client that thought it was in a wider mode would skip the
card the server believes it is enforcing.

## Voice

The same agent, through the microphone and the speakers. `lib/voice/*` is the
whole pipeline and `lib/os/useAmbientAgent.ts` is where it is wired together.

**Getting its attention.** Two ways in, and they treat the microphone
differently on purpose. `⌥Space` raises the command bar **muted** — hold Space
to talk, or click the mic to latch it open — because a chord summons the agent,
it does not consent to an open microphone. The menu-bar toggle is the other:
turning on "hey SOS" opens the microphone and leaves it open, which is a real
promise, so it is off by default, per person, loud while it runs (amber, a word
and a pulse) and revocable in one click. The indicator reads the *effective*
state, so it says `Mic held` rather than `Mic on` while push-to-talk has the mic
shut.

**One session, one owner.** Chat and the desktop share a single
`SpeechRecognition` through `mic-session.ts`. Interim text fans out to every
subscriber because it is display; a *finished* sentence is an instruction, so
the desktop session claims exclusive delivery of it while it is open — two
consumers acting on one utterance is a turn sent twice.

**Speaking back.** `speakable.ts` reduces the answer to words a person would
say (no asterisks read aloud, no URLs spelled out, code blocks named rather than
recited) and `browser-playback.ts` queues it in sentence-sized utterances, which
is what keeps Chromium's mid-sentence stall from truncating a long answer.

**Interrupting it.** While the agent talks, `barge-vad.ts` watches microphone
level against playback level and pauses on sustained speech over the top;
`interrupt-arbiter.ts` then decides whether that was really you or the
microphone hearing the speakers, by word overlap against what is being said.
Stop phrases always win.

**Saying yes.** A desktop change that needs approval is asked out loud and can
be answered out loud. The question is checked against the consent vocabulary
first (`promptIsEchoSafe`), so the agent can never approve itself by echo, and
an unanswered question is **denied** rather than left open.

**Speaking first.** When "hey SOS" is on, the standing heartbeat's findings are
spoken as well as written — only critical and high, only when nothing else is
being said, and rate-limited. Nothing is ever spoken into a session that is not
open, or past a mute.

Every state machine here is pure and tested: session modes and watchdogs,
barge-in, the echo check, the consent parser, the wake word, the mute and
ownership rules, and what the agent is allowed to volunteer.

## The proactive loop

Trata's agent is the **manager**, not the engineer. It does not query Mimir,
Loki or Tempo — a separate SRE agent does that and posts what it found:

```bash
curl -X POST localhost:3000/api/events \
  -H 'content-type: application/json' -H "x-internal-secret: $SRE_INGEST_SECRET" \
  -d '{"source":"sre-engineer","kind":"detection","severity":"critical",
       "headline":"Checkout p99 crossed 4s","actionItems":["Roll back paymentservice"],
       "evidence":[{"kind":"trace","ref":"a1f39c02bb7e4d51"}],"externalId":"run-9931"}'
```

Three gates stand between that and a message, and all three have to open:

1. **Salience** (`lib/agent/salience.ts`) — arithmetic, not a model call, so
   *"why did you tell me this?"* has an answer that can be argued with. Severity
   weight, plus a step for having something to do, with a recovery always worth
   saying and an uncited claim breaking ties downward.
2. **The brain** (`/api/agent/proactive` ← `lib/agent/proactive.ts`) — one call,
   no tools, `{"speak": …, "message": …}`. It fails closed: anything unparseable
   is silence, and an unreachable model never invents a line.
3. **The cursor** — advances over everything briefed *including what the brain
   stayed quiet about*. Silence is a verdict, not a deferral; without this the
   same event returns every fifteen minutes forever.

A message that clears all three is appended to the home conversation with
`source: "heartbeat"`, and the chat's 15s poll is how it appears in a tab that
was sitting idle. Anything critical wakes the loop early (debounced, so a burst
of events is still one message). `GET /api/heartbeat` reports what the last beat
decided and why.

The reasoning lane can read that log back through a `read_events` tool
(`lib/agent/data-tool-client.ts`), which is what makes the claim survive a
follow-up: asked *why did you tell me that*, it answers from the event rather
than from memory, and can tell what it knew at the time from what arrived
afterwards. Read-only and offered in every mode, `self` included — looking
something up is not desktop control, and an agent that cannot check its own
claims while being questioned about them is useless at exactly the wrong moment.

Storage is append-only NDJSON under `.data/`. MCS needed a spool, monotonic
ULIDs and a compaction pass for this; all of that existed because S3 has no
compare-and-swap, and a local `O_APPEND` gives it for free. Ids are derived, so
a producer retrying a POST writes the same event twice and the reader collapses
it — **first occurrence wins**, because a retry is the same event arriving
again, not a correction of it.

`./scripts/demo-incident.sh` drives the whole path: a detection, two competing
diagnoses, a piece of noise that must stay silent, a replayed event that must
not double-report, and a recovery.

## Brain, on real events

`BrainApp`'s incident header, hypotheses and working memory read from the event
log (`lib/agent/brain-view.ts`, pure and tested), falling back to fixtures when
nothing has been reported. Three rules the derivation holds to, each of which
was a bug first:

- **Severity is the worst it ever was**, not the calmest thing said most
  recently. An incident that opened at P1 does not become a P3 because the last
  update happened to be routine.
- **Confidence tracks the leading diagnosis**, not the newest number. Taking the
  most recent made posting a weak alternative *lower* the incident's confidence.
- **A field the events did not carry renders as absent**, never as a plausible
  number. There is no inferred confidence anywhere.

## Live agent setup

Set `ANTHROPIC_API_KEY` (or `CLAUDE_OAUTH_TOKEN`) in `.env.local` — see
`.env.example` for the rest. The key stays server-side in `/api/agent`, which
answers with SSE: text streams as it is written, tool calls are assembled whole
and arrive once, and the browser executes desktop tools through the guarded
controller. A turn that fails after the stream opens says so in an `error`
frame, since it can no longer be a status code.

## Design system

Near-black base, a white-alpha ladder for every surface, stroke and text step,
and a single violet accent reserved for meaning.

- `app/tokens.css` — the whole contract. Token **names** are identical to the
  MCS/Transilience set so ported components compile unchanged; only the values
  are DOS. Components may only touch the `--color-role-*` layer.
- `app/globals.css` — glass recipes, the canvas grid, the motion vocabulary, and
  the `.os-*` classes the ported shell references by name.
- `components/ui/primitives.tsx` — `Icon`, `SectionLabel`, `Row`, `Kbd`, `AsOf`,
  `Chip`. `Icon` exists so `stroke-width: 1.5` cannot drift one component at a
  time.

Rules worth keeping: colour is meaning, never decoration; accents tint text,
dots and thin strokes, never large fills; positive emphasis is white, never
green; nothing loops except status pulses. Dark only — the light half of this
palette is a different product, not a mode.

The two sanctioned exceptions are documented where they live: file-kind badges
(`lib/os/fileGlyphs.ts`) and connected-source tiles (`SOURCES` in
`lib/mock/fixtures.ts`), both because recognition *is* the meaning there.

## The backend seam

`lib/api/client.ts` is the only place that calls `fetch` for **app** data — the
catalogue, files, builds and the compliance surfaces. With
`NEXT_PUBLIC_API_BASE_URL` unset it resolves from `lib/mock/server.ts`; set it
and the identical calls go to the real service. A resource moves across by
deleting its case from the fixture router, which is why this is the short list
in the table above rather than a rewrite.

Conversations and events are no longer behind that seam — they are real, in
`lib/store/`, because the heartbeat has to write where the browser reads. The
fixture threads are still the first paint and are seeded to disk on first
touch, so deleting `.data/` is a complete reset.

Fixtures live in `lib/mock/fixtures.ts` and are shaped as the real wire types
(`lib/api/types.ts`), with timestamps computed relative to load so freshness
stamps are never a day wrong.

## Not built

No LGTM tools on this agent — Mimir, Loki and Tempo belong to the SRE agent and
to the apps; this one is told, it does not look. No shell execution, `kubectl`,
container or VM. No screenshot or pointer computer use: the semantic verbs are
the design, not a stopgap. No speech backend: recognition and synthesis are the
browser's own, so quality and language coverage are whatever Chromium ships and
neither works offline. No barge-in arbiter behind a model — the echo check is
local arithmetic, because a round trip cannot answer inside the couple of
hundred milliseconds barge-in has. No identity provider for *people*:
`lib/auth/scope.ts` serves one fixed user and org — what is real is the contract
around it, the `orgId || userId` scope key every store is namespaced by, so
nothing a user pinned is orphaned when a provider lands and only that module has
to change. Machine callers are already authenticated by shared secret, because
they are processes rather than people. No inside-app pointing (`highlight`,
`scroll_to`), no per-app permissions, no light theme.
