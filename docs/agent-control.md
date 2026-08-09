# Agent control

The contract between the model and the desktop. Everything the agent knows about
the screen arrives as text from `lib/os/agentProtocol.ts`, and everything it does
to the screen goes back through the same file as a small set of named verbs. The
protocol is pure — no React, no DOM, no window manager — so the whole of it is
testable in `node --test` the same way `lib/os/geometry.ts` is.

Two files carry the contract; the rest is wiring.

| File | Owns |
|---|---|
| `lib/os/agentProtocol.ts` | The snapshot, the verb table, handles, the epoch, serialization. What the model sees. |
| `lib/os/desktopActions.ts` | The planner. Pure `(snapshot, step, mode) → effect + outcome`. |
| `lib/os/DesktopControllerContext.tsx` | The executor. Performs effects, enforces the guards only visible at run time. |
| `lib/os/desktopState.ts` | Turns the live window list into a snapshot. Also pure. |
| `lib/os/stagingDoctrine.ts` | Judgment: what a good arrangement looks like. Data, not code. |
| `lib/agent/desktop-tool-client.ts` | Tool call in, string out. |
| `app/api/agent/route.ts` | Which tools are offered at all, and the mode ceiling. |

## Semantic verbs, not pixels

The agent does not take a screenshot and it does not click coordinates. It reads
a list of windows with integer addresses and asks for named state changes:
`snap [2] left-half`, `focus_panel [1] memory`. Three things follow from that,
and they are the reason for the design rather than side effects of it.

**A refusal can be specific.** `full_screen` does not silently fail; it returns
the sentence in `VERB_TABLE.full_screen.refusal` naming the alternative. A
coordinate click that lands on nothing returns nothing to learn from.

**A hallucination is caught rather than performed.** A handle the model invented
fails validation in `resolveHandle` and comes back with the list of handles that
do exist. An invented pixel coordinate is a real coordinate, and clicking it
moves something.

**A change is verifiable.** Every verb is written as an idempotent *setter* in
`planWindowStep`, so asking for a state a window is already in reports `noop`
and produces no effect at all. The underlying window manager methods are toggles
— `snapWindow` with the active preset un-snaps — so without that check, asking
twice would undo the first ask, which is the opposite of what "set it to X"
means.

The same reasoning bans harvesting the DOM. What a window can be asked to show
is **declared** in the registry (`panels`, `affordances`), never scraped. A
harvested element's class is unknowable; a declared affordance has a `kind`, an
option list and a current value, which is what makes `set_affordance` checkable
before it runs.

## The snapshot

`buildDesktopSnapshot` in `lib/os/desktopState.ts` turns the live window list
into a `DesktopSnapshot`: the epoch, the mode, the viewport, the windows with
their handles and diff marks, the dock in its three groups, and the app
catalogue. `serializeSnapshot` renders it as the compact text the model actually
receives:

```
DESKTOP  epoch=1kf9x2p  mode=collab  viewport=1512x789

WINDOWS (2)
  [1] Chat — left half, focused
      showing: Conversation  ·  panels: conversation | history
  [2] Pentest — right half  ~changed
      controls: severity="high" (low|medium|high)  ·  search

DOCK
  system: Chat (1), Apps, Files, Brain
  pinned: Pentest (1)
  running: —
```

**Text rather than JSON**, because this is read far more often than it is
parsed, and braces and quoting cost tokens that carry no meaning here. The tool
client returns strings for the same reason — wrapping the rendering in JSON
would spend tokens on punctuation to say the same thing.

**The internal window id is never serialized.** `WindowView.windowId` exists so
the executor can resolve a handle into something the window manager understands,
and it is deliberately absent from every line the model sees. The agent gets
exactly one way to name a window, so there is exactly one thing to validate. Two
names would mean two failure modes and a way to bypass handle checking entirely.

**The budget is real.** The snapshot comes back after every batch, so a desktop
of six windows must not cost a page. A window with neither panels nor controls
stays one line. Panels and controls indent under their window only when they
exist. The app catalogue is included on a deliberate `read_desktop` and omitted
from the state returned after a batch (`SerializeOptions.includeCatalog`) — the
library does not change while the agent works, and repeating it is what turns a
long session into an expensive one.

Controls report what they are **currently set to**, not merely that they exist.
Without the current value the agent cannot tell "I set that filter" from "I
meant to", and would re-set it every turn.

## Handles

`allocateHandles` assigns `1..n` in **creation order** — the order the window
manager already keeps, since `openApp` appends and closing filters.

Stacking order was rejected. Z changes on every click, so handles derived from
it would renumber themselves whenever the user so much as focused a window, and
an agent holding `[2]` across two turns would find it meant something else.
Creation order also happens to read the way the user's session went, which makes
the list easier to follow.

Handles are re-issued on every read. They are stable exactly as long as the
window set is stable, which is precisely what the epoch measures. Apps, by
contrast, are addressed by **id** — an app id is already stable and meaningful,
and only windows need the indirection. `effectiveAppId` resolves a security app
window to its project id (`params.appId`) rather than the shared host registry
id, so the id on a window matches the id in the catalogue and "open what's in
[2] again" is answerable.

## The epoch

```ts
computeEpoch(windows) // fnv1a(windows.map(w => `${w.id}:${w.appId}`).join("|"))
```

FNV-1a, 32 bits, base-36. Not security — it only needs to be stable and cheap.

**A signature, not a counter, deliberately.** The epoch answers exactly one
question: *are the handles in this plan still pointing at the windows the agent
thought they were?* That is a property of the set, not of elapsed time. A
signature needs no mutable state to maintain, which is what lets the whole
protocol stay pure.

It also gets one edge case right that a counter gets wrong. If the user opens a
window and closes it again while the agent is thinking, a counter would have
advanced twice and would reject a plan that is in fact still perfectly valid —
every handle resolves to exactly the same window. The signature returns to its
previous value and the plan proceeds, correctly.

**Geometry is excluded on purpose.** A window that moved is still the same
window, and `snap [2] left-half` remains a coherent instruction whether or not
the user nudged it in the meantime. The cost of that choice is that a drag would
slip past the epoch, which is why the controller compares untouched windows
directly — see divergence, below.

## Diff marks

Every `WindowView` carries `diff: "new" | "changed" | "unchanged"`, computed by
`markDiff` against the previous snapshot of the same run and rendered as a
suffix (`*new`, `~changed`) so the handle stays in the first column and the list
reads as a column of addresses. `stateSignature` decides what counts as changed:
title, rounded rect, minimized, full screen, snap preset, focus, active panel.

This is what turns "the agent assumes its action worked" into "the agent can see
that it did" — the cheapest available defence against a model crediting itself
with an outcome it never checked.

**With no previous snapshot everything is `unchanged`, not `new`.** The first
read of a session is a description of the world, not a report of things that
just appeared. Marking a desktop the user opened themselves as `*new` would tell
the agent it had just done something.

The controller is careful about which snapshot becomes the baseline: `runBatch`
reads with `rememberAsPrevious: false` before planning, because the snapshot a
plan is validated against must not become the baseline the *result* is diffed
from — otherwise every change the batch made would read as `unchanged`.

## The verb table

`VERB_TABLE` in `lib/os/agentProtocol.ts` is data, not branching. The same table
drives the client's guard, the route tier's approval decision, and the tests —
one source of truth for "may the agent do this."

| Verb | Class | Self | Collab |
|---|---|---|---|
| `open_app` | set | deny | allow |
| `close_window` | set | deny | allow |
| `focus` | state | deny | allow |
| `minimize` | state | deny | allow |
| `restore` | state | deny | allow |
| `snap` | state | deny | allow |
| `set_geometry` | state | deny | allow |
| `pin_app` | state | deny | allow |
| `unpin_app` | state | deny | allow |
| `focus_panel` | state | deny | **ask** |
| `set_affordance` | state | deny | **ask** |
| `full_screen` | forbidden | deny | deny |

The class is not decoration; it decides batching. `set` changes *which windows
exist*, so every handle after it is suspect and it ends the batch. `state`
changes a window's state or geometry, leaving the set untouched, so handles stay
valid and these chain freely. `forbidden` is declared rather than omitted so a
refusal can *teach* — an unknown verb reads to the model as something to retry
differently, a declared refusal reads as a rule with an alternative attached.

**`full_screen` is refused in every mode.** Full screen hides the dock *and* the
menu bar, and the menu bar is where the mode control lives. An agent that
full-screens a window has hidden the user's off-switch. `snap` with the `fill`
preset gives the same one-big-window result with the controls still reachable.
The refusal is enforced three times over: `permissionFor` denies it, the
`full_screen` arm of `planWindowStep` returns the refusal explicitly "so the
refusal survives someone loosening the table without reading this file", and
`toStep` in `lib/agent/desktop-tool-client.ts` rejects it before a step object
is ever constructed.

**`close_window` is allowed but doctrine-constrained.** Closing tears down the
app inside the window and destroys work in flight, which is why the dock's own
click minimizes rather than closes. Collab does not put an approval in front of
it; the doctrine rule `dont-close` — *"do not close a window you did not open
during this run"* — is now the only thing standing between Collab and a closed
window. `restore_layout` is the mitigation, and it is an honest one: windows the
agent closed cannot come back, and `restoreLayout` simply does not claim them.

**`focus_panel` and `set_affordance` are the only two that ask.** That is the
consent boundary, and it is drawn deliberately: *asking to move a window is not
collaboration, it is a permission dialog with extra steps.* A staging request
that stops for a click is the opposite of someone arranging your screen while
you keep working. The line sits where the agent reaches *inside* an app and
changes what you are working on. Narrowing a list changes what you are working
*in*, not merely where the window sits — and what a screen shows is what a
person acts on.

Note what the protocol cannot express. `set_affordance` takes one string value
and there is no shape anywhere for "submit", "confirm" or "apply". That makes
the doctrine rule `dont-submit` structural rather than merely asserted: an agent
cannot reach for a verb the protocol has no room for. `focus_panel.value` is one
opaque string for the same reason — an open params bag would be the
harvested-DOM design arriving by the back door, where nothing static says what a
value means.

## Modes

Two modes, `self` and `collab`, defined in `agentProtocol.ts` rather than
alongside the client store because the snapshot carries the mode: it is part of
what the agent is told about its own situation, not merely a UI preference.

- **`self`** — the agent does nothing to the desktop. Every verb is `deny`, and
  `verbsForMode` returns empty, so the desktop tools are **omitted from the
  request entirely** rather than offered and refused. A tool the model can see is
  a tool it will try. `app/api/agent/route.ts` also appends a line to the system
  prompt telling the model not to claim it can arrange windows. Reading is not
  driving: the reasoning lane still gets `read_events` in `self`.
- **`collab`** — the agent arranges freely and asks before reaching inside an
  app. It is also `DEFAULT_AGENT_MODE`.

A third mode, `auto`, was removed **deliberately rather than merely left
unused**. The only verbs it changed are the two that alter what the user is
looking *at*, so `auto` was precisely the mode in which the agent could change
your work without you knowing. Collab already leaves window arrangement unasked,
which is where the friction would otherwise have been. Nothing was left behind
it to re-enable.

`clampMode(requested, ceiling)` returns the requested mode unless it outranks
the ceiling, in which case it returns the ceiling. It lives in the protocol so
the client and the route tier compute it identically — **but the route tier's
answer is the only one that counts.**

`lib/os/agentMode.ts` holds two values and the distinction is the whole point.
The *preference* is what this user picked, stored per `(user, org)` in
localStorage and mirrored to the server so it follows them to the next device.
The *ceiling* is what the organization permits and cannot be raised from the
client. Lowering the ceiling never overwrites the preference — the effective
mode is what gets clamped, so raising it again restores the user's choice rather
than making them re-pick it. `null` from the server means *never chosen* and is
not treated as a choice; writing the default on first read would freeze every
member at whatever the default was the day they first opened the desktop.

**The server re-reads the ceiling on every request.** `agentModeCeiling()` in
`app/api/agent/route.ts` reads `DOS_AGENT_MODE_CEILING` fresh per turn and fails
closed: an unset or misspelled value is `collab`, because the cost of guessing
low is one approval click and the cost of guessing high is an agent reaching
inside an app nobody said it could touch. A tampered client that writes `self`
into localStorage gets a clamped answer from the route tier and nothing else.
`app/api/agent/runs/route.ts` recomputes the ceiling from the environment again
when it writes the audit record, never trusting the value in the request body.

## Planner and executor

`planStep` and `planBatch` in `lib/os/desktopActions.ts` are pure functions from
`(snapshot, step, mode, context)` to a `DesktopEffect` plus the `StepOutcome` to
report. `DesktopControllerContext.tsx` performs the effects and is the only part
that touches React.

The effect kinds are named for the window manager's own methods — `snapWindow`,
`setGeometry`, `setParams` — so `perform` is a switch with no logic in it. Every
decision has already been made by the time an effect exists.

The split is what makes the awkward parts testable without a browser:
idempotency, mode refusals, unknown handles, batch truncation, and the mapping
from a security app id to `{ appId: SECURITY_APP_ID, params: { appId } }` are
all decided in `desktopActions.ts` and covered by
`lib/os/__tests__/desktopActions.test.ts`.

Order of checks inside `planStep` matters: **permission before resolution**, so
a verb the mode forbids is refused for that reason rather than for a handle that
happens to also be wrong. The agent should learn the real obstacle first.

`PlanContext.approved` is the second lock on the same door. The tool layer gates
`ask` verbs before they reach the planner; a batch that arrives here unapproved
gets its `ask` verbs refused rather than trusted.

Failures are structured and recoverable rather than thrown. A hallucinated
handle is an ordinary thing for a model to produce, so `resolveHandle` returns a
message naming the handles that exist; an unknown app names six real ids; an
unknown panel or control names the real ones. Each of those turns a dead end
into one corrected step. A value outside a declared option list is `failed`
rather than silently applied — a declared option list is the whole point of
declaring one, and a filter that matches nothing leaves the agent wondering
where the rows went.

## Batch guards

Six guards, split between the two layers by what each layer can see.

**Epoch rejection** (`planBatch`). A batch whose `epoch` does not match the
current snapshot is rejected whole — nothing runs, every step comes back
`skipped`, and the current state is returned so the next plan is built against
truth. A stale plan is not a failure: the agent did nothing wrong, the world
moved, so it does not count toward the failure budget.

**Truncation after a set-changing verb** (`planBatch`). The first step whose
`endsBatch` is true ends the batch; everything after it is `skipped` with the
reason. This happens at *planning* time rather than being discovered at run
time, because it is knowable up front and the agent is better served by being
told which of its steps will not be attempted. `endsBatch` is computed rather
than read off the verb class: `open_app` for something already open only focuses
it, the set is untouched, and there is no reason to spend a round-trip
re-reading.

**Divergence** (`DesktopControllerContext`). Between steps, the controller
compares an `externalSignature` — rect, minimized, full screen, snap — of every
window it did *not* target against what that window looked like before the step,
and separately re-checks the epoch. Anything that moved on its own was a human
hand, and the rest of the batch is abandoned. This exists precisely because the
epoch ignores geometry: a drag would otherwise slip straight past it.

**`MAX_STEPS_PER_BATCH = 8`.** Checked before anything runs, so an over-long
plan is refused with its reason rather than attempted and abandoned halfway. The
tool schema in `app/api/agent/route.ts` declares the same `maxItems: 8`.

**`MAX_CONSECUTIVE_FAILED_BATCHES = 3`.** A batch counts as a failure only when
something failed *and* nothing succeeded. Three in a row and further batches are
refused with "stop and tell the user what is wrong instead of trying again".
`restoreLayout` resets the counter.

**No-progress detection.** Each batch produces a signature of
`verb:status` pairs. The same signature twice in a row with no `ok` in it is a
loop, and the counter is slammed straight to the ceiling. The honest move is to
stop rather than let it spin.

**Abort on any gesture.** While `isDriving`, `pointerdown`, `keydown` and
`wheel` listeners on the window — capture phase, so a click on a window's own
chrome still counts — set the abort flag, checked before every step. The user
reaching for the desktop is the signal, not what they happened to hit.

Both ceilings are deliberately low. They bound how wrong a confused agent can
get before a human is back in charge, and a staged view that genuinely needs
more than eight moves is a staged view nobody asked for.

Between steps the controller awaits two animation frames — one for React's
commit, one for paint — so the read-back is real state rather than a stale
`useState` array, and so the agent's moves are legible one at a time instead of
arriving as a single jump.

Partial results are never discarded. Everything planned but not reached, plus
everything truncated at plan time, is merged and sorted by `index`, so the agent
can always say exactly how far it got.

## StepOutcome

```ts
interface StepOutcome { index: number; step: DesktopStep; status: StepStatus; detail: string }
type StepStatus = "ok" | "noop" | "refused" | "failed" | "skipped";
```

`index` is the position in the *submitted* batch, so partial results are
unambiguous.

`detail` is one human sentence with **three consumers, which must never disagree
about what happened**:

1. **The model**, via the rendered batch result in
   `lib/agent/desktop-tool-client.ts`.
2. **The audit record**, via `recordRun` into `POST /api/agent/runs`.
3. **The screen-reader live region**, via `announceAction` in
   `lib/os/announcements.ts`, called from the executor's loop so it fires once
   per *action* rather than once per render.

Noops and refusals are announced too. "It was already there" and "it was
refused" are exactly the outcomes a screen-reader user cannot see, and silence
would read as the agent ignoring them. The announcement carries a sequence
number alongside the message because two identical actions produce the same
string, and a live region whose text has not changed is not re-read.

**`noop` is deliberately distinct from `ok`.** Asking to snap a window that is
already snapped there succeeded, but nothing moved — and an agent told "ok"
would credit itself with a change the user never saw. Downstream, the
distinction is load-bearing: only `ok` counts as progress for the failure
counter and the no-progress signature, and `batchNeedsApproval` exists so a plan
whose every step is a noop or a refusal does not get an approval dialog in front
of it. Putting a dialog in front of a plan that changes nothing teaches the user
that approvals are noise.

## The staging doctrine

The verbs decide nothing. They move windows, verifiably and identically every
time. `lib/os/stagingDoctrine.ts` decides *what goes where* — what must stay
visible, and when to stop adding windows.

Kept apart on purpose: layout opinions change monthly, `snap` should not.
Everything there is **data** — eleven `DoctrineRule` records and four
`StagingRecipe` records — rendered into the chat system prompt by
`renderStagingDoctrine()` and interpolated into `HEAVY_SYSTEM` in
`app/api/agent/route.ts`. Two things follow. The rules can be argued with and
edited without touching a line of executor code, and they can be **tested as
data** rather than as a paragraph inside a string
(`lib/os/__tests__/stagingDoctrine.test.ts`).

Each rule carries its `because`, and the reason is kept in the prompt because a
rule with a reason is followed further. The rules are ordered so the ones that
prevent harm come first: an agent that runs out of attention should still not
bury Chat or close someone's work. `chat-visible`, `dont-close` and
`dont-steal-focus` lead; taste rules like `comparison-is-two` follow.

The last three govern acting *within* a window rather than moving windows, and
they were written before the verbs that need them. `reveal-dont-operate` is the
guardrail on what the product is: *show people their product; do not use it for
them. Working the filters does the task — putting the answer on screen teaches
it.*

Recipes are named shapes rather than free composition, because the same intent
should produce the same layout twice; an agent that stages "compare these"
differently each time is one the user cannot build a habit around.

## Approval

`lib/agent/desktop-plan-copy.ts` renders a plan as short sentences naming apps
and places — *"Open Pentest", "Move Pentest to the right half"* — never as its
arguments.

The approval card is where a person decides whether to let an agent rearrange
their screen, and they get about two seconds to read it. Showing them
`{"verb":"snap","handle":2,"preset":"right-half"}` is showing them nothing:
handles are meaningless outside the model's head, and **nobody consents to
JSON**. `spokenApprovalPrompt` joins the same sentences into one spoken line
ending "Shall I?", so the voice path and the card agree.

The copy lives in its own module, away from the rendering, so the phrasing can
be tested. The wording *is* the safety feature here.

## The audit record

`POST /api/agent/runs` appends one NDJSON line per run to
`.data/<scope>/agent-runs.ndjson`; `GET` returns the last hundred, newest first.

**Steps name the resolved app, never the handle.** `[2]` means nothing once the
window set has changed; `Files` means something forever. Each `RunStep` carries
`verb`, the resolved `app_id`, the `StepOutcome.detail` sentence and the status.
The record also carries the requested mode, the effective mode, the ceiling —
recomputed from the environment, never taken from the client, since a record
that repeated whatever the browser claimed would be worthless as evidence — plus
whether the batch was approved, how it ended, and whether the turn began typed
or by voice.

A failure to write is swallowed on purpose. The action has already happened, and
failing the turn over the bookkeeping would be worse.

It is a different thing from `/api/agent/debug`, and the distinction is the
point:

| | `/api/agent/runs` | `/api/agent/debug` |
|---|---|---|
| Whose side | The desktop's — what was done | The model's — what was asked and answered |
| Storage | NDJSON on disk, per scope | In-memory ring of 20, gone on reload |
| Contents | Verbs, resolved apps, outcome sentences, mode, ceiling | Lane, model id, tools offered, defer flag, duration, upstream error |
| Answers | "Why did my windows move last Tuesday" | "Why did it say that, just now" |

Conflating them would put model text in a record that has to survive.
