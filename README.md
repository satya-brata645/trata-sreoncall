# Trata — DOS

The Developer Operating System: a proactive agentic security engineer that works
your desktop rather than only reporting to it.

This is Trata's core app. The OS layer — window manager, agent protocol, desktop
verbs — is ported from `transilience/local/mcs` (branch `feat/sos2-proposal`),
restyled to the DOS design system and served entirely from fixtures so the
backend can land one endpoint at a time.

```bash
npm install
npm run dev      # http://localhost:3000 → /desktop
npm run build
npm run typecheck
npm test         # the ported window-manager / agent-protocol suite
```

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
- `lib/mock/agent.ts` — a **scripted** driver. No model, but it speaks the real
  protocol, so staging, handle re-issue, the epoch check and the step ceiling
  are genuinely exercised. Only the choice of plan is canned.

Two chords, two acts: `⌘K` opens Spotlight (find, then open); `⌥Space` summons
the agent (say something). Spotlight finds; the command bar talks.

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

`lib/api/client.ts` is the only place that calls `fetch`. With
`NEXT_PUBLIC_API_BASE_URL` unset it resolves from `lib/mock/server.ts`; set it
and the identical calls go to the real service. A resource moves across by
deleting its case from the fixture router.

Fixtures live in `lib/mock/fixtures.ts` and are shaped as the real wire types
(`lib/api/types.ts`), with timestamps computed relative to load so freshness
stamps are never a day wrong.

## Not built

No voice pipeline — `lib/voice/*` keeps the mute preference and the narration
store the shell reads, but **nothing captures audio**, and `getMicRms()`
returns 0 rather than faking a waveform. No real auth: `lib/auth/mockUser.ts`
serves a fixed user and org, keeping the `orgId || userId` scope key so nothing
a user pinned is orphaned when a provider lands. No inside-app pointing
(`highlight`, `scroll_to`), no per-app permissions, no light theme.
