# The desktop

The OS layer: what a window is, who owns its geometry, how apps are registered,
and why the file tree cannot be edited. Ported from `transilience/local/mcs`
(branch `feat/sos2-proposal`) and restyled; the contracts below are unchanged
from that port so ported components compile without edits.

## The three constructs, plus one

Everything at root is one of three things (`docs/os-concept.md` in the MCS repo
is the product doctrine):

| Construct | Component | What it is |
|---|---|---|
| **Brain** | `components/os/apps/BrainApp.tsx` | What it believes, where each belief came from, what it is working on. Inspectable and correctable. |
| **Apps** | `LaunchpadApp.tsx`, `AppStoreApp.tsx`, `SecurityAppWindow.tsx` | Durable surfaces. **There are no runs** — you open an app and the answer is already there, which is why every one carries an *as of* stamp. |
| **Chat** | `ChatApp.tsx` | The agentic interface. It answers *and* drives the desktop; the trace rows under a reply are that work shown rather than described. |

Plus **Files** (`FilesApp.tsx`) — the frozen half. In-app content is live; files
are snapshots, which is what makes them citable.

## The registry is the only source of truth

`lib/os/registry.tsx` lists every app: id, title, icon, component, panels,
affordances. The dock renders from it, the window layer resolves titles and
components from it, and the agent's catalogue is built from it
(`buildAppCatalog` in `lib/os/desktopState.ts`).

Adding an app is **one entry plus one component**. Neither the dock nor the
window manager branches on app id. `lib/os/types.ts` keeps `OsAppId` a plain
string rather than a closed union for exactly this reason — a union would make
the registry one of two places to edit.

`SECURITY_APP_ID` is the exception worth knowing: many security apps share one
registry entry and are distinguished by window `params`, which is why
`sameApp()` in `WindowManagerContext.tsx` matches on app id *and* the serialized
params key.

## Windows

`lib/os/WindowManagerContext.tsx` owns the window array. Two properties matter
to everything downstream:

- **Creation order is the array order.** `openApp` appends; closing filters.
  Nothing reorders. This is what makes agent handles stable (see below).
- **Stacking order is separate from array order.** Z changes on every click;
  the array does not.

`lib/os/geometry.ts` is pure and owns rectangles: `openWindowRect` (cascade
placement), `resizeRect` (edge-constrained), `snapRect` (presets), `moveRect`.
`lib/os/constants.ts` holds every number the dock, canvas and window manager
must agree on — grid cell, menu-bar height, minimum window size (468×288, the
floor the dashboard layout solver is designed against), z bases.

`components/os/OsWindow.tsx` is the frame; `WindowResizeHandles.tsx` the edges;
`WindowLayer.tsx` mounts the registry component for each instance.

### The dock's three groups

`lib/os/pinnedApps.ts`, mirroring macOS:

1. **system** — the OS's own apps. Permanent, never reorderable.
2. **pinned** — what the user kept. The only user state here, persisted
   client-side because inventing a backend for a list of ids is a lot of
   machinery for a per-person preference that is cheap to lose.
3. **running** — open but not kept. Comes and goes with windows.

Clicking a dock item **minimizes** rather than closes, because closing destroys
in-flight work. This is also why the agent's `close_window` verb is constrained
by doctrine rather than by permission — see [Agent control](agent-control.md).

## Client-side stores

Four modules share one shape: an external store consumed through
`useSyncExternalStore`, so every surface reads one copy and cannot drift.

| Module | Holds | Why not React state |
|---|---|---|
| `pinnedApps.ts` | Dock pins | Dock and Launchpad are in different trees |
| `agentMode.ts` | Mode preference + org ceiling | Menu bar, controller and chat request must agree |
| `ambientListening.ts` | Is the wake-word mic open | Toggle, indicator and session hook must agree |
| `announcements.ts` | Last action, for screen readers | Batch runs in the controller; the live region renders in the menu bar |
| `lib/voice/agent-speech.ts` | What is being said, and whether it still is | Command bar and voice session are unrelated trees |

`agentMode.ts` deserves a specific warning: **it is never the authority.** It
exists so the UI can show the right thing immediately. The server re-reads the
ceiling on every request and clamps again. A tampered client gets a clamped
answer from the route tier and nothing else.

## The file system is derived, never authored

`lib/os/fileSystemModel.ts` (pure) decides the shape; `lib/os/useFileSystem.ts`
supplies the data. Two roots:

```
/apps/<app>/<build>/outputs/<date>/…
/chat/<conversation>/…
```

**The build sits above outputs.** The build *is* the analysis logic — scope,
scoring, what gets computed — which is what makes an output defensible: *this
report came from this logic, on this date*. Date is a level **inside** a
build's outputs, never above it. Getting this backwards would make a report
undefendable, which is the whole point of the tree.

There is **no create-folder, no move, no rename**. From §6 of the concept note:
"the file system is managed by the apps and the agent autonomously… I'm not
doing filing labor." Those operations would be filing labor.

**Levels resolve lazily.** React hooks cannot be called in a loop, so
`useBuilds(appId)` and `useSessionFiles(sessionId)` cannot be fanned out across
every app and refresh. That constraint matches how a file browser should behave
anyway: one org-wide session list up front, everything deeper fetched for the
path actually opened. Opening `apps/` costs nothing; opening one date folder
costs one request.

`lib/utils/output-file-visibility.ts` is the gate every file surface applies:
wake-ups write working files (traces, scratch JSON, the agent's own notes)
alongside outputs a person is meant to see, and those are hidden outside
development.

## Chrome

| Surface | File | Note |
|---|---|---|
| Menu bar | `components/os/MenuBar.tsx` | Mode selector, ambient-listening toggle, the polite live region |
| Dock | `Dock.tsx`, `DockItem.tsx` | Three groups; click minimizes |
| Spotlight (`⌘K`) | `Spotlight.tsx` | **Finds**, then opens. People, files, sources, apps |
| Command bar (`⌥Space`) | `CommandBar.tsx` | **Talks**. The mouth of a run, not a chat window |
| Agent surface | `AgentSurface.tsx`, `AuroraOverlay.tsx` | Aurora + dots; `pointer-events-none` so being on top costs the dock nothing |
| Boot | `BootSplash.tsx`, `EmptyDesktop.tsx` | |

**Two chords, two acts.** Spotlight finds; the command bar talks. The command
bar is mounted only while present and keyed per summons, so the input starts
empty every time without an effect reaching in to clear it.

Its focus behaviour is deliberate and easy to regress: the bar takes focus when
*you* summoned it, because you are about to type. It does **not** when the agent
raised it — you were doing something else, and yanking the caret out of whatever
you were mid-sentence on would be the rudest thing the feature could do.

`lib/os/AgentSummonContext.tsx` owns both the aurora and the bar as one machine,
because the worst failure for this surface is the two disagreeing. It records
`origin` (chord vs self-summon) for the audit record and deliberately does
**not** expose it to anything that renders: being summoned and summoning itself
must look identical.

## Notes and per-app state

`lib/os/appNotes.ts` — many notes per app, not one blob, because a note has an
identity: you open one, edit it, and save or discard *that* edit. A single
shared textarea has no discard, since every keystroke is already committed.

These notes are honest about their limits: they persist per person and **do not
reach the agent yet**. Promoting them to a backend store is what would make the
§6 promise ("noting 'this host is a known scanner, ignore it' stops it being
flagged") true.

## Layers on the desktop page

`app/(os)/desktop/page.tsx`, bottom to top: canvas → windows → dock → menu bar
and command bar → Spotlight. Provider nesting is load-bearing:

- `DesktopControllerProvider` sits **inside** the window manager and **outside**
  everything else — anything below it can reach the controller, and anything
  mounted outside a desktop gets `null` and degrades to talking rather than
  crashing.
- `AgentSummonProvider` sits inside the controller because it follows it: the
  surface stays up for as long as a run lasts, and dismissing it stops the run.
