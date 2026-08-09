# Contributing

Conventions, recipes, and the design system. Read [Architecture](architecture.md)
first if you have not; this document assumes you know where things live and
tells you how to add to them without breaking the properties everything else
depends on.

## Conventions

### Header comments are documentation, and they are load-bearing

This repository is unusually heavily commented and that is deliberate. The
per-file header is the primary source; `docs/` only records what spans more than
one file. A header comment here is not a summary of what the code does — the
code says that. It says **why the code is the way it is**, and especially *what
it was before*:

> `interrupt-arbiter.ts` — "…alongside a local fallback that compared the
> transcript to the agent's line by substring. Recognition never returns a clean
> substring of synthesised speech, so that fallback almost never matched: every
> word the microphone caught off the speakers counted as a real interruption,
> and the agent dispatched its own sentence back to itself as the user's next
> instruction."

That paragraph is the only thing standing between the next person and
reintroducing the bug, because the substring version *looks* more obvious. When
something in this codebase was a bug first, say so in the header. When a
threshold is a guess, say it is a guess — "a threshold nobody can argue with is
a threshold nobody can fix" (`contracts.ts`).

Do not delete an intent comment because the code it describes moved. Move it.

### Pure modules get a test file

A module described as *pure* has no React, no DOM, no `fetch`, no filesystem and
no ambient clock — time-dependent ones take `now` as an argument. That property
is what makes the awkward parts testable in `node --test` with no browser, and
it is enforced socially rather than mechanically: **if you add a pure module,
add its test file, and add its glob to `npm test` if the directory is new.**
See [Testing](testing.md).

If a decision is hard to test, that is usually a signal it is in the wrong file.
The planner/executor split in `desktopActions.ts` / `DesktopControllerContext`
exists for exactly this reason: every decision is made in the pure half, and the
controller is a switch with no logic in it.

### One `fetch` for app data

Nothing outside `lib/api/client.ts` may call `fetch` for app data. That single
seam is what makes landing the backend a per-endpoint change rather than a
per-component one. (The app's *own* API routes — `/api/agent`, `/api/events`,
`/api/runs/*`, `/api/voice` — are not app data and are called directly; the rule
is about the catalogue, files, builds and compliance surfaces.)

### Before you push

```bash
npm run typecheck
npm test
npm run lint
```

In that order. `typecheck` catches what a pure-module suite structurally cannot
see; `lint` is flat-config v9 and downgrades two React Compiler rules to
warnings on purpose (see [Testing](testing.md) for why).

---

## Recipe: add a desktop app

**One entry in `lib/os/registry.tsx`, plus a component.** Neither the dock nor
the window manager branches on app id — `OsAppId` is a plain string precisely so
the registry stays the single source of truth.

1. **Write the component.** It receives `OsAppProps`: `windowId`,
   `onRequestClose`, `params`, `setParams`. Derive the current view from
   `params`, never from `useState` — *"an app that keeps its current view in
   `useState` is a room with no door number: the agent can open it but cannot
   say 'the memory panel'."* `setParams` merges rather than replaces, so one
   control need not know every key another part of the app set.

2. **Add the registry entry.** Order in `OS_APPS` is dock order, top to bottom.

   | Field | Notes |
   |---|---|
   | `id`, `title`, `component` | Required. |
   | `icon` | The stroke symbol, for dense or textual contexts. |
   | `artwork` | The drawn coloured tile, shown wherever the app is *launched*. Optional so a new app works the day its component exists. |
   | `showInDock: false` | For apps only opened from inside another app. |
   | `singleton: true` | Launching again focuses the existing window. |

3. **Declare `panels` and `affordances`.** This is what makes the app
   *addressable* by the agent. Declared here rather than registered at mount, so
   the snapshot builder stays pure — it can say what a window *can* show before
   the window has rendered. An app with no entry simply cannot be addressed
   inside, which is the honest default.

   Descriptions reach the model, so write them to answer *when would I bring
   this up*, not to label a tab. A description that restates the label costs
   tokens and buys nothing. Compare Chat's `activity` panel: *"What arrived
   while they were elsewhere, newest first, with the urgent ones coloured. Bring
   this up for 'what did I miss'."*

   An affordance's `kind` is `search`, `filter` or `select`. **There is no shape
   for "submit".** Every affordance narrows or moves what is on screen; none of
   them commit anything. That makes the `dont-submit` doctrine rule structural
   rather than merely asserted.

4. **Add its agent description** to `OS_APP_AGENT_DESCRIPTIONS` in
   `lib/os/desktopState.ts` — one line saying *why the agent would open it*.

Nothing else. If you find yourself adding an `if (appId === …)` anywhere in the
dock or the window layer, the design has been broken and the fix is a new
registry field, not the branch.

---

## Recipe: add a desktop verb

Eight edits, and the order below is the order that keeps the build green.

1. **`lib/os/agentProtocol.ts` — `DesktopVerb`.** Add the name.

2. **`VERB_TABLE`.** Pick a `verbClass` and **write down the reasoning**:

   - `set` — changes *which windows exist*. Every handle after it is suspect, so
     it ends the batch and the agent re-reads.
   - `state` — changes a window's state or geometry. Handles stay valid; these
     chain freely.
   - `forbidden` — declared so a refusal can *teach*, rather than reading to the
     model as an unknown verb it should retry differently. Give it a `refusal`
     naming the alternative, as `full_screen` does.

   Then pick a `Permission` per mode. The existing boundary is not arbitrary:
   **Collab does not ask to arrange your windows** (asking is a permission
   dialog with extra steps), and asks only where the agent reaches *inside* an
   app and changes what you are working on — `focus_panel` and `set_affordance`.
   `self` is `deny` for everything, which is why `verbsForMode("self")` is empty
   and the tools are omitted from the request entirely: a tool the model can see
   is a tool it will try.

3. **`DesktopStep`.** Add the variant. Windows are addressed by `handle: number`,
   apps by `appId: string`. Resist adding a params bag — `focus_panel` carries
   one opaque `value` string on purpose, because *"a panel that needs two values
   is a panel that has not been decomposed"*.

4. **`lib/os/desktopActions.ts` — a `planStep` case.** Return a `PlannedStep`:
   the `StepOutcome` (with a `detail` sentence, because that one string goes to
   the model, into the audit record *and* into the live region and they must
   never disagree), an optional `DesktopEffect`, and `endsBatch`. Get the
   idempotent case right: a step that changes nothing is `noop`, never `ok` — an
   agent told "ok" would credit itself with a change the user never saw.

5. **`DesktopEffect`.** Add a variant if the verb needs a window-manager call the
   existing ones cannot express. Effects are named for the window manager's own
   methods so the controller stays logic-free.

6. **`lib/os/DesktopControllerContext.tsx` — a `perform` case.** One line calling
   `windowManager.*`. If you are writing an `if` here, the decision belongs in
   step 4.

7. **`app/api/agent/route.ts` — the tool schema.** Add the verb's arguments to
   the `desktop_act` input schema.

8. **`lib/agent/desktop-plan-copy.ts` — the sentence.** The approval card is
   where a person decides whether to let an agent rearrange their screen, and
   they get about two seconds. *Nobody consents to JSON.* Add a
   `describePlanStep` case naming apps and places, never handles and presets.

9. **Tests.** `agentProtocol.test.ts` for the table (class, permissions, refusal
   parity with `stagingDoctrine`), `desktopActions.test.ts` for the planner
   (each mode, the idempotent case, an unknown handle).

---

## Recipe: land a backend endpoint

The app runs on one switch. `fetchBackend` in `lib/api/client.ts` routes to
`lib/mock/server.ts` whenever `NEXT_PUBLIC_API_BASE_URL` is unset.

1. Delete that resource's `if` from `lib/mock/server.ts`.
2. Set `NEXT_PUBLIC_API_BASE_URL`.

That is the whole change. The wire types in `lib/api/types.ts` already match the
fixture shapes, so no component changes and no resource module changes. Moving
resources across one at a time is supported and expected — an unmatched route
throws with the fix in the message:

> `No fixture for "/x". Add a case in lib/mock/server.ts or point NEXT_PUBLIC_API_BASE_URL at a backend.`

The 140ms fixture latency is deliberate, by the way: instant resolution hides
every loading state, and a skeleton nobody ever sees is a skeleton nobody
notices is broken. Don't remove it.

---

## Recipe: add a disco block kind

Five files, and the discipline is that the renderer never decides anything.

1. **`packages/disco-core/src/spec.ts`** — add the kind to the closed
   vocabulary. Two rules are enforced here and they are what make the system
   trustworthy: **blocks bind, they never carry data** (every block points at a
   frame id; numbers come from the algebra, so the agent cannot invent one), and
   **the vocabulary is closed** (an unknown kind is a validation failure at
   generation time, not a blank card at runtime).

2. **`contracts.ts`** — one `SizeContract` per *variant*, not per kind. A
   degraded form is simply another contract, so stepping down a ladder is
   `CONTRACTS[c.ladder[0]]` with no special cases in the solver. Every `min`
   carries a written `legibility` justification, surfaced in the layout
   inspector. The budget to design against is the DOS window floor —
   468×288 minus chrome and Disco's header, ≈436×176 of content — so
   **degradation is the normal path, not an edge case**: give the kind a `next`
   rung unless hiding is genuinely the only honest answer (scatter is the one
   exception).

3. **`components/disco/rungs.tsx`** — the degraded form. The rule every rung
   follows: **drop a CHANNEL, never a FACT.** A sparkline loses its axes but
   keeps its shape and labels its endpoints; a share bar loses the angle
   encoding but keeps every share exact; a top-5 list loses the tail but says
   how much it dropped. Nothing may silently show less data than it appears to —
   that would make a small window a source of wrong conclusions rather than
   merely a smaller view. The dependency runs one way: `blocks.tsx` imports from
   `rungs.tsx` and nothing here imports back, so a severity cannot classify
   differently at full size than degraded.

4. **`bindings.ts`** — declare every frame the block reads in `frameBindings`,
   and every `(frame, field)` pair in `fieldBindings`. One place, and the
   validator, the materializer and the patch garbage collector all pick it up
   for free. This file exists because the same question was answered in three
   places and one was wrong: the materializer forgot a KPI *also* binds
   `spark.from`, so server-mode dashboards shipped without their sparkline
   frames — which silently killed the period-over-period delta too.

5. **`components/disco/blocks.tsx`** — the component. It renders **exactly what
   the solver told it**: the assigned variant, the `Affordances` (title,
   legend, axes, grid, value labels, tick caps, `maxItems`). No per-component
   size guesswork, no "if it looks cramped, hide the legend". If the component
   needs a decision the contract does not express, add it to `Affordances`.

Then add cases to `layout.test.ts` (the invariants), `bindings.test.ts` and
`rules.test.ts`.

---

## Recipe: add an SRE event kind

The `EventKind` union in `lib/agent/events.ts` is closed on purpose, and it is
the one contract in the proactive path that cannot be changed cheaply later —
once the SRE agent writes against this shape, the shape is load-bearing.

1. **`lib/agent/events.ts`** — add to `EventKind` and to the `KINDS` array (the
   parser reads the array; a kind in the type and not the array is silently
   rejected). Keep it narrow: an event says what happened, how bad it is, and
   what a person could point at to check — **evidence is references, never
   payloads**, because the value of "cites a real trace id" is that someone can
   go and look, and a copied-in log line is a claim rather than a citation.

2. **`lib/agent/salience.ts`** — decide its treatment. Is it worth saying on its
   own? `resolved` is, at any severity, because *"an agent that reports the
   break and not the fix leaves the user believing something is still on fire."*
   Whatever you choose, the `because` string must state it in words: it gets
   shown, and it is the entire answer to "why did you tell me this?".

3. **`lib/agent/brain-view.ts`** — the derivation. Decide whether the kind
   contributes to the incident header, the hypothesis ranking, or the running
   commentary. Anything the events do not say comes back `undefined` rather than
   invented; the renderer shows a gap as a gap.

4. Tests in `events.test.ts`, `salience.test.ts` and `brain-view.test.ts`.
   Optionally extend `scripts/demo-incident.sh` if the kind is worth
   demonstrating.

---

## The design system

Near-black base, a **white-alpha ladder** for every surface/stroke/text step, and
**one violet accent reserved for meaning**. Monochrome first, glass not chrome,
enterprise density.

### `app/tokens.css` is the whole contract

438 lines, three layers:

1. **Base** — the only literal colours in the system: `--dos-ink` (#0a0a0a),
   `--dos-elevated`, `--dos-white`, `--dos-violet` (#7a5af8), `--dos-red`,
   `--dos-amber`.
2. **The white-alpha ladder** — `--w-03` … `--w-92`. Hierarchy comes from here,
   not from borders plus fills.
3. **The role layer** — `--color-role-*`. **The only layer components are
   allowed to touch** (or its `role-*` Tailwind utility). Never hardcode a
   colour in a component.

Token **names** are deliberately identical to the Transilience/MCS contract so
components ported from `mcs/frontend` compile unchanged — only the **values** are
DOS. That is the same move `globals.css` makes with the `.os-*` classes:
revaluing rather than rewriting keeps the port diffable against its origin and
keeps the design in one place.

### `app/globals.css`

The glass recipes (`dos-glass-window`, `dos-glass-rail`, `dos-glass-bar`,
`dos-glass-popover` — popovers are opaque because they must stay readable over
anything), the type utilities (`dos-label`, `dos-kbd`), the canvas grid (a 36px
lattice plus a faint radial wash, and nothing else — it is wallpaper, not a
construct), the motion vocabulary (`dos-fadeup`, `dos-fade`, `dos-pulse`,
`dos-ring`, `dos-eq`, `dos-blink`, all disabled under
`prefers-reduced-motion`), and the `.os-*` surfaces the ported shell components
already reference.

### `components/ui/primitives.tsx`

`Icon`, `SectionLabel`, `Row`, `Tile`, `StatusDot`, `EmptyState`, `AsOf`, `Chip`.
They exist so density and the ladder are decided once — *"an app body that
reaches for raw padding and a raw `rgba(255,255,255,…)` will drift within a
release; one that reaches for `Row` and `SectionLabel` cannot."*

**Every icon goes through `Icon`.** `strokeWidth: 1.5` is the weight the whole
system is drawn at and it is the easiest thing to lose — a Lucide icon dropped
in directly renders at 2 and reads noticeably heavier beside its neighbours.
Centralising it means the drift cannot happen one component at a time.

`AsOf` is a component rather than a convention because no-runs promises
always-live: the moment that promise breaks silently, someone is making a
security decision on stale data.

### The rules

- **Colour is meaning, never decoration.**
- **Accents tint text, dots and thin strokes — never large fills.**
- **Positive emphasis is white, never green.** The primary action is white.
- **Selection is a stronger surface, not a colour** (`Row`'s `selected` uses
  `--w-20`). Colour is reserved, so "this is the one you are on" is carried by
  the ladder.
- **Nothing loops except status pulses.** Violet pulses because it means *live*;
  everything else is still, because a pulsing red reads as an alarm going off
  rather than a severity.
- **Dark only.** `color-scheme: dark`, one palette, no toggle.

### The two sanctioned filled-colour exceptions

Both earn it because **recognition is the meaning**, not decoration:

1. **File-kind badges** — `lib/os/fileGlyphs.ts`. A column of identical grey
   document icons is genuinely harder to scan than a column of coloured badges,
   and "which kind of file" is meaning. The tints are deliberately muted against
   the near-black ground so a list of files does not out-shout a finding.
2. **Connected-source tiles** — `SOURCES` in `lib/mock/fixtures.ts`. AWS orange,
   Slack aubergine, Datadog violet: you recognise a source by its colour before
   you read its name.

Anything else that wants a filled colour needs an argument at least this good,
written down next to it.

---

## Copy

Frontend surfaces derive user-visible names from slugs, and a naive
capitalize-each-word pass produces `Aws Monitor Guardduty`. **Route every
slug-derived name through `lib/utils/copy-glossary.ts`:**

```ts
formatProjectName("aws-monitor-guardduty")     // "AWS Monitor GuardDuty"
formatProjectName("pci-dss-evidence-analyzer") // "PCI DSS Evidence Analyzer"
normalizeCopyTerms("Review iam findings")      // "Review IAM findings"
```

`COPY_GLOSSARY` keys **must** be fully lowercase; values render verbatim.
`normalizeCopyTerms` is safe to run on arbitrary UI copy — unknown tokens are
left untouched.

When adding a term, add the lowercase key and extend the test. The module header
points at `lib/utils/__tests__/copy-glossary.test.ts`; **that file does not
exist yet**, and `lib/utils/__tests__/` is not in the `npm test` glob list. The
first person to add a term should create both and add the glob — the header is
describing the intended contract, not a file you can currently edit.
