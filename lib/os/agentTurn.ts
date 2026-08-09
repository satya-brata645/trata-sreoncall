"use client";

/**
 * Getting a turn from the command bar into the conversation.
 *
 * **Why an event and not a hoisted session.** The plan's original shape was to
 * lift `useChat` out of `ChatInterface` into a desktop-level provider so the
 * bar and the Chat window would be two views of one hook. That is a ~500-line
 * refactor of the file that also owns voice, resume and barge-in — and the
 * failure it courts is precisely the one it was meant to prevent: two `useChat`
 * instances on one conversation id double-post and corrupt `active_stream_id`.
 *
 * This keeps **one writer, by construction**. The trunk session stays exactly
 * where it is; the bar hands it a turn and the existing guarded send path takes
 * it from there. Nothing about the conversation's ownership changes, so nothing
 * about resume or streaming can break.
 *
 * It is also what the doctrine already asks for. Rule 1 says Chat stays visible
 * whenever the agent is speaking — so a turn from the bar *should* surface the
 * Chat window rather than narrating into a void. The bar is the quick way in,
 * not a second place conversations live.
 *
 * The pattern is the one `FOCUS_CHAT_INPUT_EVENT` already established here: a
 * window event for coordination across trees that share no ancestor.
 */

export const AGENT_TURN_EVENT = "transilience:agent-turn";

export interface AgentTurnOptions {
  /**
   * Answer out loud.
   *
   * The agent surface is the *spoken* surface — you summon it, it works, it
   * talks back (`FR-36`). But speech is not a property of the conversation, it
   * is a property of **this turn**: the same trunk conversation is also read
   * silently in the Chat window, and a turn typed there must stay silent.
   *
   * So the intent travels with the turn rather than being a mode the
   * conversation is left in. A turn from the bar or the wake word asks to be
   * spoken; the next turn typed into Chat does not, and neither has to undo
   * the other.
   */
  voice?: boolean;
}

export interface AgentTurnDetail {
  text: string;
  options: AgentTurnOptions;
}

/** Hand a turn to whichever conversation surface is listening. */
export function dispatchAgentTurn(
  text: string,
  options: AgentTurnOptions = {},
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<AgentTurnDetail>(AGENT_TURN_EVENT, {
      detail: { text, options },
    }),
  );
}

/**
 * Listen for turns. Returns an unsubscribe.
 *
 * Only the **trunk** conversation should subscribe. A thread subscribing too
 * would mean one bar submission arriving in two conversations, which is worse
 * than it not arriving at all.
 */
export function subscribeAgentTurn(
  handler: (text: string, options: AgentTurnOptions) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<AgentTurnDetail>).detail;
    // `options` defaults rather than being required: an older dispatch (or a
    // hand-fired event) means "no special intent", which is silence.
    if (detail?.text) handler(detail.text, detail.options ?? {});
  };
  window.addEventListener(AGENT_TURN_EVENT, listener);
  return () => window.removeEventListener(AGENT_TURN_EVENT, listener);
}
