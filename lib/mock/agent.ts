/**
 * The agent, scripted.
 *
 * There is no model behind this build, but the thing worth demonstrating is not
 * the model — it is that the agent *drives the desktop* rather than describing
 * it. So this dispatcher speaks the real protocol: it reads a snapshot, builds
 * a `DesktopBatch` against that snapshot's epoch, and hands it to the real
 * controller. Staging, handle re-issue, the step ceiling and the narration path
 * are all genuinely exercised; only the choice of plan is canned.
 *
 * That matters for what it can catch. A broken `open_app`, a stale epoch, a
 * refused `full_screen` — all still fail here exactly as they would with a
 * model attached.
 */

import type { DesktopControllerValue } from "@/lib/os/DesktopControllerContext";
import type { DesktopStep } from "@/lib/os/agentProtocol";
import { setSpokenLine, stoppedSpeaking } from "@/lib/voice/agent-speech";
import type { MockMessage } from "./fixtures";

type Emit = (message: MockMessage) => void;

/**
 * One move: open an app, then act on the window it produced.
 *
 * Modelled this way because `open_app` **terminates its batch** — it changes
 * the window set, so every handle in the plan behind it is stale and the
 * protocol refuses to guess. A move is therefore two batches with a fresh
 * snapshot between them, and `then` receives the handle the second read
 * actually issued rather than one assumed at authoring time.
 */
interface Move {
  /** Catalog id — a project id like `kodeshield`, or an OS app like `files`. */
  open: string;
  then?: (handle: number) => DesktopStep[];
}

interface Turn {
  /** Matched against the lowercased instruction. */
  match: RegExp;
  /** Trace rows, in order. `INTENT → ROUTE → EXEC → CORRELATE`. */
  trace: Array<[kind: string, text: string]>;
  /** What to do to the desktop. Replanned against a fresh snapshot each move. */
  plan?: Move[];
  reply: string;
}

const TURNS: Turn[] = [
  {
    match: /(what did you do|while i was away|what did i miss|catch me up)/,
    trace: [
      ["INTENT", "Summarise the task ledger since last seen."],
      ["ROUTE", "brain → cortex"],
      ["EXEC", "Opened Brain on the task ledger."],
    ],
    plan: [
      { open: "brain", then: (h) => [{ verb: "focus_panel", handle: h, panel: "cortex" }] },
    ],
    reply:
      "Three things. I opened a fix PR for a reachable critical in api-gateway and froze deploys on it. I re-mapped the eu-west data flows and found one undocumented cross-border transfer. And I wrote the checkout-latency postmortem — one action item is still open. The ledger is on screen.",
  },
  {
    match: /(exposed|internet[- ]facing|reachable|cve|vulnerab)/,
    trace: [
      ["INTENT", "Check exposure on internet-facing services."],
      ["ROUTE", "kodeshield → overview"],
      ["EXEC", "Staged KodeShield beside the file it produced."],
      ["CORRELATE", "Merging PR #482 also closes 3 pending SOC 2 controls."],
    ],
    plan: [
      { open: "kodeshield", then: (h) => [{ verb: "snap", handle: h, preset: "left-half" }] },
      { open: "files", then: (h) => [{ verb: "snap", handle: h, preset: "right-half" }] },
    ],
    reply:
      "One. CVE-2026-1187 in api-gateway is reachable without authentication — the other two criticals sit behind an admin guard. PR #482 is open and the service is frozen until it merges. I have put the reachability report next to it.",
  },
  {
    match: /(side by side|next to|stage|compare|show me .* and)/,
    trace: [
      ["INTENT", "Stage two surfaces for comparison."],
      ["EXEC", "Snapped both halves of the desktop."],
    ],
    plan: [
      { open: "kodeshield", then: (h) => [{ verb: "snap", handle: h, preset: "left-half" }] },
      { open: "files", then: (h) => [{ verb: "snap", handle: h, preset: "right-half" }] },
    ],
    reply: "Both are up — findings on the left, the files they produced on the right.",
  },
  {
    match: /(file|report|document|pdf|evidence)/,
    trace: [
      ["INTENT", "Locate an output file."],
      ["ROUTE", "files → /apps"],
      ["EXEC", "Opened Files at the apps root."],
    ],
    plan: [
      {
        open: "files",
        then: (h) => [
          { verb: "set_affordance", handle: h, affordance: "location", value: "/apps" },
        ],
      },
    ],
    reply:
      "Files is open at the apps root. Outputs sit under the build that produced them — that is what makes a report defensible, so the build is a level above the date rather than beside it.",
  },
  {
    match: /(believe|know|memory|brain|belief)/,
    trace: [
      ["INTENT", "Show what is believed about the environment."],
      ["ROUTE", "brain → memory"],
      ["EXEC", "Opened Brain on memory."],
    ],
    plan: [
      { open: "brain", then: (h) => [{ verb: "focus_panel", handle: h, panel: "memory" }] },
    ],
    reply:
      "Everything I hold, with where each belief came from and when. If one is wrong, correct it there and I will stop acting on it.",
  },
  {
    match: /(app|open|launch|install|store)/,
    trace: [
      ["INTENT", "Bring the app list into view."],
      ["EXEC", "Opened Apps."],
    ],
    plan: [{ open: "apps" }],
    reply: "Here is everything this workspace has. There is nothing to launch — open one and it is already current.",
  },
];

const FALLBACK: Turn = {
  match: /.*/,
  trace: [["INTENT", "No matching plan — answering without touching the desktop."]],
  reply:
    "This build runs on fixtures, so I only have canned plans. Try asking what you missed, whether anything is exposed, or to put two things side by side.",
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Perform one move: open, re-read, then act on what the read reports.
 *
 * The second read is not defensive padding — it is the only way to learn the
 * handle. Handles are re-issued whenever the window set changes, so the number
 * that addressed a window before the open is not the number that addresses it
 * after.
 *
 * Both reads carry the catalogue because the first one is what the open is
 * planned against: `open_app` names an app by id, and an id the snapshot's
 * library does not list is refused as unknown rather than guessed at.
 */
async function runMove(controller: DesktopControllerValue, move: Move): Promise<void> {
  const before = controller.readDesktop({ includeCatalog: true });
  await controller.runBatch({
    epoch: before.epoch,
    steps: [{ verb: "open_app", appId: move.open }],
  });
  if (!move.then) return;

  const after = controller.readDesktop({ includeCatalog: true });
  const window = after.windows.find((w) => w.appId === move.open);
  // The open was refused — snapping a window that does not exist would be a
  // second failure reported as a first one, so stop here and let the trace row
  // above stand as the record.
  if (!window) return;
  await controller.runBatch({ epoch: after.epoch, steps: move.then(window.handle) });
}

/**
 * Run one turn.
 *
 * Every move goes through the real controller, so staging, handle re-issue, the
 * epoch check and the step ceiling are all genuinely exercised — only the
 * choice of plan is canned.
 */
export async function runMockAgent(
  instruction: string,
  {
    controller,
    onMessage,
  }: {
    controller: DesktopControllerValue | null;
    onMessage: Emit;
  },
): Promise<void> {
  const turn = TURNS.find((t) => t.match.test(instruction.toLowerCase())) ?? FALLBACK;
  const now = () => new Date().toISOString();

  for (const [kind, text] of turn.trace) {
    await sleep(360);
    onMessage({ id: `t-${Date.now()}-${kind}`, role: "trace", kind, text, at: now() });

    if (kind === "EXEC" && turn.plan && controller) {
      for (const move of turn.plan) await runMove(controller, move);
    }
  }

  await sleep(320);
  setSpokenLine(turn.reply);
  onMessage({ id: `a-${Date.now()}`, role: "agent", text: turn.reply, at: now(), read: true });
  // Narration ends when the line has been delivered. Left set, the aurora and
  // the dots would claim the agent is still talking.
  await sleep(600);
  stoppedSpeaking();
}
