import { promises as fs } from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import { scopeKey } from "@/lib/auth/scope";
import { DEFAULT_AGENT_MODE, OS_AGENT_MODES, type OsAgentMode } from "@/lib/os/agentProtocol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What the agent actually did to the desktop.
 *
 * Distinct from `/api/agent/debug`, and the distinction matters: debug is the
 * model's side of a turn, in memory, gone on reload. This is the desktop's
 * side, on disk, and it is the thing that answers "why did my windows move"
 * a week later.
 *
 * Steps name the **resolved app**, never the handle. `[2]` means nothing once
 * the window set has changed; `Files` means something forever.
 */
interface RunStep {
  verb: string;
  app_id?: string;
  detail?: string;
  status: string;
}

interface RunRecord {
  id: string;
  recorded_at: string;
  mode: OsAgentMode;
  requested_mode: OsAgentMode;
  ceiling: OsAgentMode;
  /** How the turn began. The navigate-vs-talk instrumentation. */
  origin: "typed" | "voice";
  conversation_id?: string;
  tool_call_id?: string;
  approved: boolean;
  ended: "completed" | "stopped";
  steps: RunStep[];
}

function runsPath(): string {
  return path.join(process.cwd(), ".data", scopeKey(), "agent-runs.ndjson");
}

function mode(raw: unknown): OsAgentMode {
  return OS_AGENT_MODES.includes(raw as OsAgentMode) ? (raw as OsAgentMode) : DEFAULT_AGENT_MODE;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<RunRecord> & { steps?: unknown };
    const record: RunRecord = {
      id: `run-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random()
        .toString(16)
        .slice(2, 10)}`,
      recorded_at: new Date().toISOString(),
      // Recomputed from the environment, never taken from the client. A record
      // that repeated whatever the browser claimed would be worthless as
      // evidence of anything.
      ceiling: mode(process.env.DOS_AGENT_MODE_CEILING),
      requested_mode: mode(body.requested_mode),
      mode: mode(body.mode),
      origin: body.origin === "voice" ? "voice" : "typed",
      conversation_id: typeof body.conversation_id === "string" ? body.conversation_id : undefined,
      tool_call_id: typeof body.tool_call_id === "string" ? body.tool_call_id : undefined,
      approved: body.approved === true,
      ended: body.ended === "stopped" ? "stopped" : "completed",
      steps: Array.isArray(body.steps) ? (body.steps as RunStep[]) : [],
    };

    await fs.mkdir(path.dirname(runsPath()), { recursive: true });
    await fs.appendFile(runsPath(), `${JSON.stringify(record)}\n`, "utf8");
    return NextResponse.json({ ok: true, id: record.id });
  } catch (error) {
    // A failure to record is swallowed on purpose: the action has already
    // happened, and failing the turn over the bookkeeping would be worse.
    console.warn("[agent-runs] record failed", error);
    return NextResponse.json({ ok: false });
  }
}

/** The desktop's history, newest first. */
export async function GET() {
  try {
    const raw = await fs.readFile(runsPath(), "utf8");
    const runs = raw
      .split("\n")
      .filter((line) => line.trim())
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as RunRecord];
        } catch {
          return [];
        }
      });
    return NextResponse.json({ runs: runs.slice(-100).reverse() });
  } catch {
    return NextResponse.json({ runs: [] });
  }
}
