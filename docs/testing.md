# Testing

What the suite actually proves, and — just as important — what it deliberately
does not. Everything below is what `npm test` does today, not an aspiration.

## Running it

```bash
npm test        # the whole suite
npm run typecheck
npm run lint
```

`npm test` is one line in `package.json` and there is no test framework
underneath it:

```
node --import tsx --test \
  lib/os/__tests__/*.test.ts \
  lib/agent/__tests__/*.test.ts \
  lib/agent/memory/__tests__/*.test.ts \
  lib/voice/__tests__/*.test.ts \
  lib/store/__tests__/*.test.ts \
  lib/builds/__tests__/*.test.ts \
  lib/artifacts/__tests__/*.test.ts \
  lib/schedule/__tests__/*.test.ts \
  packages/disco-core/src/__tests__/*.test.ts
```

Node's own runner, `node:assert/strict`, and `tsx` to strip the types. **No
vitest, no jest, no browser, no network, and nothing mocks a model.** The
runner is an explicit list of globs rather than a discovery walk because
`references/` is a vendored third-party tree with eighty-five test files of its
own, and a discovery-based runner finds all of them.

Two consequences of the shape worth knowing:

- Node gives each *file* its own process, which is why module-scope state
  (`deferredTurn`'s buffer, `mic-session`'s holder set) can be tested at all —
  each file starts from a clean module graph.
- `lib/artifacts/__tests__/` does not exist. The glob matches nothing, node
  treats it as zero files, and the run still exits 0. It is a dead entry in the
  list, not a silently skipped suite.

## The numbers

From a clean run on this commit:

```
1..503
# tests 523
# suites 8
# pass 523
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 2304.036750
```

**523 assertions passing across 39 test files, in about two seconds, with
nothing stubbed at the network boundary.** The 503 in the TAP plan is the
top-level count; the remaining 20 sit inside the 8 `describe` suites, all of
which live in `fileSystemModel.test.ts`.

> The root `README.md` quotes an older figure (374), and
> `E2E-TEST-RESULTS.md` an older one still (186, at commit `9eea682`, when the
> glob was `lib/os/__tests__/*.test.ts` alone). The suite has grown since;
> **523** is the current number on `main`. Re-run it rather than trusting any
> figure written down, including this one — the count moves with every suite
> added.

## What each file proves

### The OS layer — `lib/os/__tests__/` (11 files)

| File | What it proves |
|---|---|
| `agentProtocol.test.ts` | `clampMode` never returns above the ceiling; the mode set is exactly `self`/`collab`; `verbsForMode("self")` is empty, so the tools can be omitted from the request rather than offered and refused. |
| `desktopActions.test.ts` | The planner: `self` refuses every verb; `collab` arranges windows without approval but refuses an inside-app write without one; unknown handles, idempotent pins, and `full_screen`'s refusal message. |
| `desktopState.test.ts` | Snapshot construction: handles are 1-based in creation order, stacking order does not renumber them, and a security app is named by its project rather than by the shared `security-app` registry id. |
| `geometry.test.ts` | Every snap preset clears the menu-bar strip and the dock column. The menu bar carries the agent's mode control, so a window on top of it has covered the user's off-switch. |
| `fileSystemModel.test.ts` | The §6 shape as data: two roots, the build sits *above* outputs, date is a level *inside* a build, a refresh belongs to the build current when it ran, and the tree is derived — an app with no refreshes has no folder. |
| `stagingDoctrine.test.ts` | Every doctrine rule is uniquely identified and carries its reason; harm-preventing rules sort before taste rules; the doctrine's `full_screen` ban matches `VERB_TABLE`. |
| `announcements.test.ts` | The live region actually speaks: a repeated action still bumps the sequence (identical text otherwise never re-announces), and blank outcomes are not announced. |
| `agentTurn.test.ts` | Turn dispatch and unsubscribe; an empty turn is not delivered; dispatching with no `window` is a no-op rather than a throw. |
| `deferredTurn.test.ts` | A spoken turn with no conversation open is held, keeps its voice intent, is drained (so a remount does not replay it), and only the most recent held turn survives. |
| `summonChord.test.ts` | ⌥Space is matched on `code`, not on the character macOS produces from it. |
| `icon-parity.test.ts` | The merged `fileGlyphs` table preserves every glyph the three legacy tables chose, so a `.docx` cannot look one way in Files and another in Spotlight. |

### The agent — `lib/agent/__tests__/` (4) and `lib/agent/memory/__tests__/` (1)

| File | What it proves |
|---|---|
| `salience.test.ts` | The bar: critical/high clear on severity alone, low/info never do, medium clears only with something to do, a `resolved` event always clears, and a high-severity claim with no evidence breaks the tie *downward*. The stated reason (`because`) is prose, because it gets shown. |
| `events.test.ts` | The ingest contract: a missing field is named rather than thrown, the same event posted twice derives the same id, and optional lists always come back as lists. |
| `brain-view.test.ts` | Brain's derivation: no incident id anywhere means no incident rather than an invented one; severity is the worst it ever was, not the calmest thing said last; a recovery stays on screen. |
| `history.test.ts` | Rebuilding model history from the transcript: trace rows are excluded, blank messages are dropped, and a thread that opens with the app speaking still starts on a user turn. |
| `memory/traces.test.ts` | Decay is exponential and order-preserving; reinforcement saturates below 1 without a clamp; Laplace confidence stays humble on a small sample. |

### Voice — `lib/voice/__tests__/` (8)

| File | What it proves |
|---|---|
| `micSession.test.ts` | **A holder is what opens the microphone, not the mute flag.** Muting closes a live session and unmuting reopens it; the restart backoff is driven explicitly through a fake recogniser. |
| `bargeVad.test.ts` | Barge-in: a disarmed loop ignores everything, arming twice does not start two tickers, disarming resumes playback it paused, and sustained speech over the agent pauses it. Driven through the class's real `setTimer`/`setTicker` seams. |
| `browserPlayback.test.ts` | An answer is spoken as words not markdown; a long answer is chunked (Chromium stalls past ~15s); a short one stays one utterance; the queue drains and reports silence. |
| `session.test.ts` | The session state machine against a clock the test drives: a dispatched turn parks in `thinking`, an answer that never speaks does not leave the session deaf, the watchdog reports itself, and an ambient session falls back to ambient rather than awake. |
| `proactiveSpeech.test.ts` | Speaking first is gated: nothing is said with no session open, a muted mic is someone asking for quiet, and the agent does not talk over itself or over you. |
| `wakeAndConsent.test.ts` | The two places a mis-hearing becomes an action: the wake word (including the ways recognition mangles the name) and the spoken-consent parser. |
| `spokenApproval.test.ts` | Offering opens the store the session watches, answering clears it, answering twice answers once, and answering stops the agent mid-question. |
| `speakable.test.ts` | Markdown is not read aloud: emphasis markers, backticks and link targets go; an unpaired asterisk is left alone. |

### Storage, builds, schedule (3)

| File | What it proves |
|---|---|
| `store/dedupe.test.ts` | **First occurrence wins.** A replayed record is ignored, not applied — the bug it replaced let a retry overwrite an incident's start time and drop its action items. Asserted against the reduction, not the filesystem. |
| `builds/store.test.ts` | Promotion is monotonic from stored bytes and rollback moves a pointer only; corrupt documents fail closed; app ids cannot escape the builds directory; a wake-up maps to the newest build at or before its start. |
| `schedule/due.test.ts` | First run, interval boundaries and every stopping condition, with `now` passed in. |

### Disco — `packages/disco-core/src/__tests__/` (12)

| File | What it proves |
|---|---|
| `layout.test.ts` | The solver is deterministic, reads no clock and no randomness, never mutates its input, and no block exceeds the content width. Written against invariants so tuning a contract does not invalidate them. |
| `band.test.ts` | The KPI band always fills its row edge to edge, every tile is the same size, and rows hold the same count — "three tiles and an orphan" reads as a bug even to someone who cannot say why. |
| `contracts`/`rules.test.ts` | A rule's message, its prose fix and its executable repair come from the same measured facts. Each repair is *applied* and the violation checked gone; a repair that hides data says so. |
| `resolve.test.ts` | Late binding: a donut whose categories outgrow the palette becomes a bar and says so; the authored spec is never mutated, so the donut returns when the data shrinks; resolve reaches a fixpoint and never loops. |
| `patch.test.ts` | A patch is a transaction — it commits whole or leaves the original byte-identical — and a block invisible at this window size is rejected rather than silently added. |
| `agent-patch.test.ts` | Everything `/api/disco/patch` does minus the model call, against the real pinned spec and a real run: the digest names every bindable table and no rows; a bad table name comes back as prose, not a stack trace. |
| `bindings.test.ts` | A KPI declares **both** its value frame and its sparkline frame. Every case fails against the pre-fix code. |
| `algebra.test.ts` | The silent failures: `groupBy` aggregates per group, `aggregate` ignores nulls rather than zeroing them, `timeBucket` floors in UTC and emits gaps as `null`. |
| `tables.test.ts` | Tables are named from their JSON path, not their position — reordering the producer's JSON must not repoint every block at different data. |
| `artifacts.test.ts` | A seeded run profiles into the expected named tables, and the same seed + `asOf` produce byte-identical output. |
| `substrate.test.ts` | The public API from a caller's point of view: hand over data and a question, get a dashboard; reflow re-solves layout without touching the spec. |
| `golden-validate.test.ts` | Validator output is byte-identical across the rule-table refactor, down to `formatIssues`' trailing spaces and nine-space `fix:` indent — that whitespace is pasted back to the composer as a retry prompt. |

## The doctrine that makes this possible

A module described as **pure** in this repo has no React, no DOM, no `fetch`,
no filesystem and **no ambient clock** — a time-dependent one takes `now` as an
argument (`due(job, now)`, `decayTrace(trace, now)`, `reinforceTrace(trace,
salience, now)`).

That is not a style preference. It is the single property that makes the
awkward parts assertable in `node --test` with nothing running:

| The awkward thing | The pure module that decides it | Its test |
|---|---|---|
| Idempotency, mode refusals, unknown handles, batch truncation | `lib/os/desktopActions.ts` | `desktopActions.test.ts` |
| Handles, epoch, verb classification, mode clamping | `lib/os/agentProtocol.ts` | `agentProtocol.test.ts` |
| The snapshot the model reads | `lib/os/desktopState.ts` | `desktopState.test.ts` |
| Snap presets clearing the menu bar | `lib/os/geometry.ts` | `geometry.test.ts` |
| The file-system shape | `lib/os/fileSystemModel.ts` | `fileSystemModel.test.ts` |
| Layout doctrine as data | `lib/os/stagingDoctrine.ts` | `stagingDoctrine.test.ts` |
| The file-kind table | `lib/os/fileGlyphs.ts` | `icon-parity.test.ts` |
| The salience bar | `lib/agent/salience.ts` | `salience.test.ts` |
| The ingest contract | `lib/agent/events.ts` | `events.test.ts` |
| Brain's derivation | `lib/agent/brain-view.ts` | `brain-view.test.ts` |
| Model history from a transcript | `lib/agent/history.ts` | `history.test.ts` |
| Decay and reinforcement | `lib/agent/memory/traces.ts` | `memory/traces.test.ts` |
| Schedule due-ness | `lib/schedule/due.ts` | `due.test.ts` |
| Markdown → speech | `lib/voice/speakable.ts` | `speakable.test.ts` |
| Echo vs. real interruption | `lib/voice/interrupt-arbiter.ts` | `bargeVad.test.ts` |
| Approval copy | `lib/agent/desktop-plan-copy.ts` | (via `desktopActions.test.ts` fixtures) |
| The whole solver, algebra, patch protocol and validator | `packages/disco-core/src/*` | 12 files |

The impure edges get **seams** rather than mocks: `mic-session` exposes
`installMicSessionSeamForTests` / `resetMicSessionForTests`, `barge-vad` takes
`setTimer`/`clearTimer`/`setTicker`/`clearTicker` on its deps, `browser-playback`
reads `window.speechSynthesis` at call time so a fake on `globalThis` drives the
real queue and watchdogs, and `VoiceSession` takes a clock the test advances.
The code under test is always the real code.

## What this suite deliberately does not prove

- **No test calls a real model.** The one part of `/api/agent`, `/api/voice` and
  the heartbeat brain that cannot be asserted here is the model call itself.
  `agent-patch.test.ts` is explicit about this: it tests everything the route
  does *minus* the model.
- **No test opens a microphone or a speaker.** Recognition and synthesis are the
  browser's; what is tested is the ownership, backoff, barge-in, echo check,
  wake word and consent parser wrapped around them.
- **There is no browser or E2E test in this suite.** No Playwright, no
  Testing Library, no jsdom. Rendering is not asserted anywhere.
- **Nothing here touches the LGTM stack.** Mimir, Loki and Tempo are the SRE
  agent's business; this repo's contract with it is `POST /api/events`, and what
  is tested is the parser on this side of that boundary.

For the end-to-end run — typecheck, build, live HTTP smoke of the routes,
observability reachability and the SRE skill chain — see
[`E2E-TEST-RESULTS.md`](../E2E-TEST-RESULTS.md) in the repo root. Note that its
`npm test` figure of **186** is from an older commit (`9eea682`, when the glob
list was `lib/os/__tests__/*.test.ts` alone); the current figure is **523**.
Everything else in that document still stands.

## `npm run typecheck`

```
tsc --noEmit
```

Clean, and it is the only thing that checks the parts of the app the unit suite
cannot reach — every component, every route handler, every hook. `strict` is on.
Run it before pushing; it is fast and it catches the class of breakage that a
pure-module suite structurally cannot see.

## `npm run lint`

```
eslint
```

`eslint.config.mjs` is flat-config v9 and is worth reading before you argue with
it. Until it existed, `npm run lint` found no config at all and had therefore
**never run** — which means the `react-hooks` rules that `useAmbientAgent` and
`ChatApp` disable by name in their comments were being enforced by nothing.

It ignores `references/**` (vendored third-party source), allows `_`-prefixed
unused arguments (this codebase's existing way of writing "required by the
signature, deliberately unused"), and downgrades two React Compiler rules to
warnings: `react-hooks/refs`, because `ref.current = latest` during render is
the pattern the desktop controller, chat composer and mic session all use to see
current props without resubscribing; and `react-hooks/set-state-in-effect`,
because the mount-time capability probes (`setSupported(isMicSupported())`)
cannot be computed during render — they touch `window`. Both are warnings so
they stay countable and so a real error is not buried under them.

## Do not run `npx vitest`

There is no vitest in `devDependencies` and no vitest config. `npx vitest` will
fetch it and then discover `references/` — the vendored `sreoncall` tree, which
carries **85** `*.test.*` / `*.spec.*` files, its own vitest configs, and
Playwright specs, written against dependencies this repo does not install. It
will fail, and the failure says nothing about this project. `references/` is a
reading copy, not a workspace; `eslint.config.mjs` ignores it for the same
reason and `npm test`'s explicit glob list exists precisely so the runner never
walks into it.

**The runner is `node --test`. There is no second one.**
