import { NextResponse } from "next/server";

import type {
  LiveAgentContent,
  LiveAgentFrame,
  LiveAgentMessage,
} from "@/lib/agent/live-protocol";
import { UNTRUSTED_CONTENT_INSTRUCTION } from "@/lib/agent/untrusted-content";
import { recordAgentCall } from "@/lib/agent/debug-log";
import { clampMode, DEFAULT_AGENT_MODE, OS_AGENT_MODES, type OsAgentMode } from "@/lib/os/agentProtocol";
import { renderStagingDoctrine } from "@/lib/os/stagingDoctrine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIGHT_MODEL = "claude-haiku-4-5-20251001";
const REASONING_MODEL = "claude-sonnet-5";
const DEFER_TOOL = "defer_to_reasoning";
const MAX_HISTORY_MESSAGES = 40;

const desktopTools = [
  {
    name: "read_desktop",
    description:
      "Read the desktop before planning. It returns windows with temporary handles, the app catalogue, panels and controls. Read again after opening or closing a window because handles are reissued.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "begin_takeover",
    description:
      "Raise the visible agent surface before you proactively drive the desktop. Do not call it when the user already summoned you.",
    input_schema: {
      type: "object",
      properties: { reason: { type: "string" } },
      required: ["reason"],
    },
  },
  {
    name: "restore_layout",
    description:
      "Restore the window layout from before the agent started arranging it. Use for undo or put it back.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "desktop_act",
    description:
      "Execute a bounded desktop plan. First call read_desktop and use its epoch. Open or close changes the window set and ends a batch; re-read before arranging new windows. Use only handles and app ids that the last desktop read supplied.",
    input_schema: {
      type: "object",
      properties: {
        epoch: { type: "string" },
        intent: { type: "string" },
        steps: {
          type: "array",
          minItems: 1,
          maxItems: 8,
          items: {
            type: "object",
            properties: {
              verb: {
                type: "string",
                enum: [
                  "open_app",
                  "close_window",
                  "focus",
                  "minimize",
                  "restore",
                  "snap",
                  "set_geometry",
                  "pin_app",
                  "unpin_app",
                  "focus_panel",
                  "set_affordance",
                ],
              },
              handle: { type: "number" },
              appId: { type: "string" },
              preset: { type: "string" },
              rect: {
                type: "object",
                properties: {
                  x: { type: "number" },
                  y: { type: "number" },
                  width: { type: "number" },
                  height: { type: "number" },
                },
              },
              panel: { type: "string" },
              affordance: { type: "string" },
              value: { type: "string" },
              title: { type: "string" },
            },
            required: ["verb"],
          },
        },
      },
      required: ["epoch", "steps"],
    },
  },
] as const;

/**
 * Reading the SRE agent's reports.
 *
 * Not a desktop verb and not mode-gated — it writes nothing, and an agent that
 * cannot check its own claims while being questioned about them is at its least
 * useful exactly when it matters most. Offered to the reasoning lane only: the
 * light lane's job is windows, and handing it the incident log would invite it
 * to answer questions it has no business answering.
 */
const dataTools = [
  {
    name: "read_events",
    description:
      "Read what the SRE agent has reported: detections, diagnoses, remediations and recoveries, newest first. Call this before answering any question about an incident, about something you said unprompted, or about why you raised something — your claims must come from here, not from memory. Pass `incidentId` to narrow to one incident.",
    input_schema: {
      type: "object",
      properties: { incidentId: { type: "string" } },
    },
  },
] as const;

const deferTool = {
  name: DEFER_TOOL,
  description:
    "Hand this turn to the reasoning model. Call it immediately for analysis, judgement, comparisons, advice, or anything beyond a direct desktop instruction. When unsure, defer.",
  input_schema: {
    type: "object",
    properties: { reason: { type: "string" } },
    required: ["reason"],
  },
} as const;

const HEAVY_SYSTEM = `You are DOS, the engineer who owns reliability for this estate. You answer thoughtfully and you drive the visible desktop to show your work.

Who does what:
- A separate SRE agent watches the systems — metrics, logs, traces. It reports what it finds to you. You do not query telemetry yourself and should not offer to.
- You are the one who decides what matters, says it in a human voice, and shows the evidence. When you speak first, unprompted, that is you having judged something worth interrupting for.
- Every claim traces to something the SRE agent sent. Cite the event, the trace id, the PR. If you cannot point at it, say you cannot rather than filling the gap.
- Asked why you raised something, answer from the actual event — what it said, how severe it was, what made it clear the bar. Never invent a reason after the fact.

Desktop discipline:
- Read before acting. Use only handles, panels, controls and app ids from the latest read.
- Open first, then re-read, then arrange. An open or close invalidates later handles.
- Never submit forms, send messages, make purchases, or use full screen.
- If a view answers the user, reveal it instead of operating inside it.
- Narrate concisely before a desktop action. The user can interrupt and restore the layout.
- Be factual about what you know and what tool results say; do not invent data or app state.

${renderStagingDoctrine()}

${UNTRUSTED_CONTENT_INSTRUCTION}`;

const LIGHT_SYSTEM = `You move windows. That is your whole job.

Carry out only direct desktop instructions: open, close, focus, arrange, resize, snap, minimize, restore, pin, switch a panel, or set a visible control. For anything requiring judgement, analysis, advice, comparison, or knowledge beyond the current desktop, call defer_to_reasoning immediately. When unsure, defer.

You are one narrow lane inside a much larger teammate, and you do not know what the rest of it does. So **never describe yourself, your purpose, or what you can do** — a question like "who are you", "what do you do" or "what can you help with" is not a desktop instruction, and answering it from here tells the user this product moves windows. Defer those, always. Only act; never explain.`;

function apiHeaders(): HeadersInit | null {
  const key = process.env.CHAT_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (key) {
    return {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": key,
    };
  }
  const oauth = process.env.CLAUDE_OAUTH_TOKEN || process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (!oauth) return null;
  return {
    "content-type": "application/json",
    "anthropic-version": "2023-06-01",
    "anthropic-beta": "oauth-2025-04-20",
    authorization: `Bearer ${oauth}`,
  };
}

function toAnthropicMessages(messages: LiveAgentMessage[]) {
  const out: Array<{ role: "user" | "assistant"; content: unknown }> = [];
  for (const message of messages.slice(-MAX_HISTORY_MESSAGES)) {
    if (message.role === "user") {
      out.push({ role: "user", content: message.content });
      continue;
    }
    if (message.role === "assistant") {
      out.push({ role: "assistant", content: message.content });
      continue;
    }
    const last = out.at(-1);
    const block = { type: "tool_result", tool_use_id: message.toolUseId, content: message.content };
    if (last?.role === "user" && Array.isArray(last.content)) {
      (last.content as unknown[]).push(block);
    } else {
      out.push({ role: "user", content: [block] });
    }
  }
  return out;
}

/**
 * The mode the workspace permits, read fresh on every request.
 *
 * The client sends a preference; a preference is never an authorization. Fails
 * closed: an unset or misspelled ceiling is `collab`, not `auto`, because the
 * cost of guessing low is one approval click and the cost of guessing high is
 * an agent reaching inside an app nobody said it could touch.
 */
function agentModeCeiling(): OsAgentMode {
  const raw = process.env.DOS_AGENT_MODE_CEILING;
  return OS_AGENT_MODES.includes(raw as OsAgentMode) ? (raw as OsAgentMode) : DEFAULT_AGENT_MODE;
}

function parseMode(raw: unknown): OsAgentMode {
  return OS_AGENT_MODES.includes(raw as OsAgentMode) ? (raw as OsAgentMode) : DEFAULT_AGENT_MODE;
}

interface TurnContext {
  requestedMode: OsAgentMode;
  ceiling: OsAgentMode;
  mode: OsAgentMode;
}

/**
 * Read Anthropic's own SSE and hand back both halves of the answer.
 *
 * Text arrives through `emit` as it is generated, because a reply that appears
 * a word at a time is the difference between an agent thinking and an agent
 * hung. Tool calls do not: their arguments stream as fragments of JSON, and
 * half a plan is not something any consumer can act on, so they are assembled
 * here and returned whole.
 *
 * The returned array is the same `LiveAgentContent[]` the buffered version
 * produced, which is what lets the conversation history stay byte-identical to
 * what the model will be re-sent next turn.
 */
async function readAnthropicStream(
  body: ReadableStream<Uint8Array>,
  emit: (text: string) => void,
): Promise<LiveAgentContent[]> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const blocks = new Map<number, { type: string; text: string; id?: string; name?: string; json: string }>();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line. Anything after the last one is
    // a partial frame and has to wait for the next chunk.
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const dataLine = frame.split("\n").find((line) => line.startsWith("data:"));
      if (!dataLine) continue;

      let event: {
        type?: string;
        index?: number;
        content_block?: { type?: string; id?: string; name?: string };
        delta?: { type?: string; text?: string; partial_json?: string };
      };
      try {
        event = JSON.parse(dataLine.slice(5).trim());
      } catch {
        continue;
      }

      if (event.type === "content_block_start" && typeof event.index === "number") {
        blocks.set(event.index, {
          type: event.content_block?.type ?? "text",
          text: "",
          id: event.content_block?.id,
          name: event.content_block?.name,
          json: "",
        });
      } else if (event.type === "content_block_delta" && typeof event.index === "number") {
        const block = blocks.get(event.index);
        if (!block) continue;
        if (event.delta?.type === "text_delta" && typeof event.delta.text === "string") {
          block.text += event.delta.text;
          emit(event.delta.text);
        } else if (
          event.delta?.type === "input_json_delta" &&
          typeof event.delta.partial_json === "string"
        ) {
          block.json += event.delta.partial_json;
        }
      }
    }
  }

  return [...blocks.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([, block]): LiveAgentContent[] => {
      if (block.type === "text" && block.text) return [{ type: "text", text: block.text }];
      if (block.type === "tool_use" && block.id && block.name) {
        let input: Record<string, unknown> = {};
        try {
          // An empty-object tool takes no arguments, so it streams no JSON.
          const parsed: unknown = block.json.trim() ? JSON.parse(block.json) : {};
          if (parsed && typeof parsed === "object") input = parsed as Record<string, unknown>;
        } catch {
          // Truncated arguments. Handing the executor `{}` makes it refuse with
          // a message the model can correct, which beats a thrown parse error.
        }
        return [{ type: "tool_use", id: block.id, name: block.name, input }];
      }
      return [];
    });
}

async function callModel(
  messages: LiveAgentMessage[],
  lane: "light" | "heavy",
  context: TurnContext,
  emit: (text: string) => void = () => {},
): Promise<LiveAgentContent[]> {
  const toolsDisabled = context.mode === "self";
  const model = lane === "light" ? LIGHT_MODEL : REASONING_MODEL;
  // The reasoning lane always gets the event log, even in `self` — reading is
  // not driving. Only the desktop verbs answer to the mode.
  const tools = lane === "light"
    ? toolsDisabled
      ? [deferTool]
      : [...desktopTools, deferTool]
    : toolsDisabled
      ? [...dataTools]
      : [...desktopTools, ...dataTools];
  const startedAt = Date.now();

  const base = {
    at: new Date().toISOString(),
    model,
    lane,
    requestedMode: context.requestedMode,
    ceiling: context.ceiling,
    mode: context.mode,
    toolsOffered: tools.map((tool) => tool.name),
    messageCount: messages.length,
  };

  try {
    const headers = apiHeaders();
    if (!headers) throw new Error("Live agent is not configured. Set ANTHROPIC_API_KEY or CLAUDE_OAUTH_TOKEN.");

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        max_tokens: lane === "light" ? 900 : 1800,
        stream: true,
        system: `${lane === "light" ? LIGHT_SYSTEM : HEAVY_SYSTEM}${
          toolsDisabled
            ? "\n\nDesktop control is disabled for this turn. Do not claim you can open, move, or arrange windows."
            : ""
        }`,
        tools,
        messages: toAnthropicMessages(messages),
      }),
    });
    if (!response.ok) throw new Error(`Anthropic ${response.status}: ${(await response.text()).slice(0, 500)}`);
    if (!response.body) throw new Error("Anthropic returned no body to stream.");

    const content = await readAnthropicStream(response.body, emit);

    const toolCalls = content.flatMap((block) => (block.type === "tool_use" ? [block.name] : []));
    recordAgentCall({
      ...base,
      outcome: {
        textBlocks: content.filter((block) => block.type === "text").length,
        toolCalls,
        deferred: toolCalls.includes(DEFER_TOOL),
      },
      durationMs: Date.now() - startedAt,
    });
    return content;
  } catch (error) {
    recordAgentCall({
      ...base,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      messages?: unknown;
      voice?: unknown;
      forceHeavy?: unknown;
      agentMode?: unknown;
    };
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return NextResponse.json({ error: "messages must be a non-empty array" }, { status: 400 });
    }
    const messages = body.messages as LiveAgentMessage[];
    const requestedMode = parseMode(body.agentMode);
    const ceiling = agentModeCeiling();
    const context: TurnContext = {
      requestedMode,
      ceiling,
      mode: clampMode(requestedMode, ceiling),
    };

    const startLane: "light" | "heavy" =
      body.voice === true || body.forceHeavy === true ? "heavy" : "light";

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (frame: LiveAgentFrame) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
        };

        try {
          let lane = startLane;
          let content = await callModel(messages, lane, context, (text) =>
            send({ type: "text_delta", text }),
          );

          // Same MCS decision rule: typed turns get one cheap desktop-only
          // pass; an explicit handoff reruns from the original context on the
          // reasoning model. Anything the light lane already said on its way to
          // giving up is withdrawn — it was written by a model that had just
          // decided it was the wrong one to answer.
          if (lane === "light" && content.some((b) => b.type === "tool_use" && b.name === DEFER_TOOL)) {
            lane = "heavy";
            send({ type: "discard" });
            content = await callModel(messages, lane, context, (text) =>
              send({ type: "text_delta", text }),
            );
          }

          send({
            type: "done",
            response: { content, lane, mode: context.mode, ceiling: context.ceiling },
          });
        } catch (error) {
          // The turn already has a 200 and headers on the wire, so a failure
          // cannot become a status code. It has to be said in the stream.
          send({
            type: "error",
            error: error instanceof Error ? error.message : "Live agent request failed",
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        // Nginx and friends buffer SSE by default, which turns a stream back
        // into the blocking request this replaced.
        "x-accel-buffering": "no",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Live agent request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
