import type { OsAgentMode } from "@/lib/os/agentProtocol";

/** The compact, serializable conversation format used by the live DOS agent. */
export type LiveAgentContent =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

export type LiveAgentMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: LiveAgentContent[] }
  | { role: "tool"; toolUseId: string; content: string };

export interface LiveAgentResponse {
  content: LiveAgentContent[];
  lane: "light" | "heavy";
  /**
   * The mode the turn actually ran under, after the server clamped the client's
   * preference to the workspace ceiling. The browser executes the desktop verbs,
   * so it has to be told what it is allowed to do rather than deciding for
   * itself — a client that thinks it is in `auto` would skip the approval card
   * the server believes it is enforcing.
   */
  mode: OsAgentMode;
  ceiling: OsAgentMode;
}

/**
 * What comes down the wire during a turn.
 *
 * Text streams; tool calls do not. A tool call's arguments arrive as fragments
 * of JSON and half a plan is not actionable, so the server assembles them and
 * they appear once, in `done`, alongside the content array the client pushes
 * into history. That array is the same shape the buffered route returned, which
 * is what keeps the next request's history byte-identical.
 *
 * `discard` is the light lane withdrawing what it said on its way to handing
 * the turn over — text written by a model that had just concluded it was the
 * wrong one to answer.
 */
export type LiveAgentFrame =
  | { type: "text_delta"; text: string }
  | { type: "discard" }
  | { type: "done"; response: LiveAgentResponse }
  | { type: "error"; error: string };
