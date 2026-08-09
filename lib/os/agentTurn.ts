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
  /**
   * Hold the turn until a conversation exists to receive it.
   *
   * A turn from the command bar is typed into a surface that has already
   * opened Chat, so it always lands. A turn from the wake word has not: the
   * microphone is owned by the desktop, the only subscriber is the Chat
   * window, and if that window is closed the utterance is dispatched into an
   * empty room and silently lost — you say something, the dots move, and
   * nothing ever happens.
   *
   * Opt-in rather than the default because a turn that arrives late is only
   * right when it was spoken to no one in particular. Anything with a surface
   * behind it should fail loudly instead of arriving somewhere unexpected
   * later.
   */
  deferrable?: boolean;
}

export interface AgentTurnDetail {
  text: string;
  options: AgentTurnOptions;
}

/**
 * How long a deferred turn is still worth delivering.
 *
 * Long enough to cover a window opening and mounting, short enough that a
 * sentence spoken before lunch never arrives after it.
 */
export const DEFERRED_TURN_TTL_MS = 10_000;

let subscriberCount = 0;
let deferred: { detail: AgentTurnDetail; at: number } | null = null;

/** Hand a turn to whichever conversation surface is listening. */
export function dispatchAgentTurn(
  text: string,
  options: AgentTurnOptions = {},
): void {
  if (typeof window === "undefined") return;
  if (!text.trim()) return;

  if (options.deferrable && subscriberCount === 0) {
    // Only the most recent one: two utterances queued behind a closed window
    // would both arrive at once, in an order nobody chose.
    deferred = { detail: { text, options }, at: Date.now() };
    return;
  }

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
  subscriberCount += 1;

  // Drained, not replayed: cleared before delivery so a subscriber that
  // remounts (Chat re-subscribes whenever its thread changes) cannot receive
  // the same utterance twice.
  const pending = deferred;
  deferred = null;
  if (pending && Date.now() - pending.at <= DEFERRED_TURN_TTL_MS) {
    handler(pending.detail.text, pending.detail.options);
  }

  return () => {
    subscriberCount = Math.max(0, subscriberCount - 1);
    window.removeEventListener(AGENT_TURN_EVENT, listener);
  };
}
