"use client";

import { useEffect, useRef } from "react";

import { speakBrowserText } from "./browser-playback";
import { speakableFrom } from "./speakable";
import type { VoiceMode } from "./session";

/**
 * The agent speaking first.
 *
 * Everything else in `lib/voice` answers: a turn arrives, a reply is spoken.
 * But the product's claim is a teammate that works while you are away and tells
 * you what it found, and the standing loop that does that work had no voice.
 * The heartbeat decides, server-side, that something is worth saying and writes
 * it into the home conversation — and it was then read only by whoever happened
 * to be looking at the Chat window.
 *
 * Two halves live here. The **gate** is a pure function, because speaking
 * unprompted is the easiest thing in this subsystem to get wrong and the rules
 * deserve to be arguable rather than buried in a component:
 *
 * - **Only into an open ear.** A desktop with no voice session is a desktop
 *   whose owner has not asked to be spoken to. Ambient listening being on is
 *   the standing invitation; nothing else is.
 * - **Only when nobody is mid-sentence.** Not while the agent is answering,
 *   working, or waiting on a decision — and not while the session is `awake`
 *   either, because that means the user has just summoned it and has the floor.
 * - **Only what is worth interrupting for**, and not often.
 * - **Never past a mute.** A muted microphone is someone asking for quiet, and
 *   talking through it would be a strange reading of that.
 *
 * The **watch** is what notices. It polls the home conversation, but only while
 * the gate could open at all — so a desktop with voice off makes no extra
 * requests, and the feature costs nothing when it cannot fire. It deliberately
 * arms silently: messages that landed while nobody was listening are history,
 * not news, and reading out a backlog on the moment the mic opens is exactly
 * the behaviour that would make someone turn this off.
 */

export type ProactiveSeverity = "critical" | "high" | "medium" | "low";

export interface ProactiveMessage {
  /** Stable id, so the same wake-up is never announced twice. */
  id: string;
  text: string;
  severity?: ProactiveSeverity;
}

export interface ProactiveSpeechContext {
  /** The voice session's mode. `idle` means no session is open at all. */
  mode: VoiceMode;
  /** Whether the shared microphone is muted. */
  muted: boolean;
  /** Milliseconds since the agent last spoke unprompted; null if never. */
  sinceLastMs: number | null;
}

/**
 * Worth breaking a silence for.
 *
 * Medium and low are real findings that belong in the activity list, not things
 * to say out loud to someone who did not ask a question.
 */
const SPEAKABLE_SEVERITIES = new Set<ProactiveSeverity>(["critical", "high"]);

/** The floor between two unprompted sentences. */
export const PROACTIVE_MIN_GAP_MS = 120_000;

/**
 * The only mode the agent may speak into.
 *
 * `ambient` is "listening, nobody talking" — the one state where an unprompted
 * sentence interrupts nothing.
 */
const SPEAKABLE_MODES = new Set<VoiceMode>(["ambient"]);

/** Could the agent speak at all right now, whatever it has to say? */
export function canSpeakProactively(mode: VoiceMode, muted: boolean): boolean {
  return !muted && SPEAKABLE_MODES.has(mode);
}

export function shouldSpeakProactively(
  message: ProactiveMessage,
  context: ProactiveSpeechContext,
): boolean {
  if (!canSpeakProactively(context.mode, context.muted)) return false;
  if (!SPEAKABLE_SEVERITIES.has(message.severity ?? "low")) return false;
  if (context.sinceLastMs !== null && context.sinceLastMs < PROACTIVE_MIN_GAP_MS) {
    return false;
  }
  // Nothing sayable survives the markdown reduction — speaking would be an
  // empty utterance that still burns the rate limit.
  return speakableFrom(message.text).length > 0;
}

/* -------------------------------------------------------------------------- */
/* The bus                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Published by whatever notices something, consumed by the desktop.
 *
 * An event rather than a callback for the same reason `agentTurn` is one: a
 * producer and the desktop surface share no ancestor. The watch below is the
 * only publisher today; the seam exists so anything already holding the
 * conversation can hand a message over instead of it being fetched twice.
 */
export const PROACTIVE_SPEECH_EVENT = "transilience:proactive-speech";

export function publishProactiveMessage(message: ProactiveMessage): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ProactiveMessage>(PROACTIVE_SPEECH_EVENT, { detail: message }),
  );
}

export function subscribeProactiveMessage(
  handler: (message: ProactiveMessage) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<ProactiveMessage>).detail;
    if (detail?.id && detail.text) handler(detail);
  };
  window.addEventListener(PROACTIVE_SPEECH_EVENT, listener);
  return () => window.removeEventListener(PROACTIVE_SPEECH_EVENT, listener);
}

/* -------------------------------------------------------------------------- */
/* Noticing                                                                    */
/* -------------------------------------------------------------------------- */

/** The conversation the app writes into unprompted. */
const HOME_CONVERSATION_ID = "home";
/** Only ever runs while the gate could open; the loop itself is 15 minutes. */
const WATCH_INTERVAL_MS = 30_000;

interface StoredMessageLike {
  id?: unknown;
  role?: unknown;
  text?: unknown;
  at?: unknown;
  source?: unknown;
  severity?: unknown;
}

function asSeverity(value: unknown): ProactiveSeverity | undefined {
  return value === "critical" || value === "high" || value === "medium" || value === "low"
    ? value
    : undefined;
}

/** The heartbeat's own messages, newest last, as the bus wants them. */
export function proactiveMessagesFrom(payload: unknown): Array<ProactiveMessage & { at: string }> {
  const messages = (payload as { messages?: unknown })?.messages;
  if (!Array.isArray(messages)) return [];

  return (messages as StoredMessageLike[])
    .filter(
      (message) =>
        message?.role === "agent" &&
        message.source === "heartbeat" &&
        typeof message.id === "string" &&
        typeof message.text === "string" &&
        typeof message.at === "string",
    )
    .map((message) => ({
      id: message.id as string,
      text: message.text as string,
      at: message.at as string,
      severity: asSeverity(message.severity),
    }))
    .sort((a, b) => a.at.localeCompare(b.at));
}

/* -------------------------------------------------------------------------- */
/* The desktop's ear                                                           */
/* -------------------------------------------------------------------------- */

export interface ProactiveSpeechOptions {
  mode: VoiceMode;
  muted: boolean;
  speak?: (line: string) => void;
  now?: () => number;
  /** Injectable for tests; defaults to the home conversation endpoint. */
  fetchMessages?: () => Promise<unknown>;
}

/**
 * Mount once, on the desktop. Says the wake-ups that pass the gate.
 *
 * No queue: a message that arrives while the agent is talking is dropped rather
 * than stacked. It is already in the activity list, and a queue would only
 * guarantee the backlog gets read out the moment the room goes quiet.
 */
export function useProactiveSpeech({
  mode,
  muted,
  speak = speakBrowserText,
  now = () => Date.now(),
  fetchMessages,
}: ProactiveSpeechOptions): void {
  // The latest inputs, read at the moment a message arrives rather than closed
  // over: the subscription is established once, because re-running it on every
  // mode change would risk dropping a message published in the gap.
  const stateRef = useRef({ mode, muted, speak, now });
  useEffect(() => {
    stateRef.current = { mode, muted, speak, now };
  });

  const spokenRef = useRef(new Set<string>());
  const lastSpokenAtRef = useRef<number | null>(null);

  useEffect(
    () =>
      subscribeProactiveMessage((message) => {
        const {
          mode: currentMode,
          muted: currentMuted,
          speak: say,
          now: clock,
        } = stateRef.current;
        if (spokenRef.current.has(message.id)) return;

        const at = clock();
        const sinceLastMs =
          lastSpokenAtRef.current === null ? null : at - lastSpokenAtRef.current;
        if (
          !shouldSpeakProactively(message, {
            mode: currentMode,
            muted: currentMuted,
            sinceLastMs,
          })
        ) {
          return;
        }

        // Marked before speaking, not after: the same wake-up must not be
        // announced twice if playback fails or is barged over.
        spokenRef.current.add(message.id);
        lastSpokenAtRef.current = at;
        say(message.text);
      }),
    [],
  );

  // Derived to a boolean so the watch starts and stops on the gate opening and
  // closing, not on every transcript that nudges the mode.
  const watching = canSpeakProactively(mode, muted);

  useEffect(() => {
    if (!watching) return;

    let cancelled = false;
    // Armed silently on the first read: what landed while nobody was listening
    // is history, not news.
    let seenThrough: string | null = null;

    const read =
      fetchMessages ??
      (() =>
        fetch(`/api/conversations/${HOME_CONVERSATION_ID}`).then((response) =>
          response.ok ? response.json() : { messages: [] },
        ));

    async function poll() {
      let payload: unknown;
      try {
        payload = await read();
      } catch {
        // Offline, or the server restarted mid-poll. The next tick retries.
        return;
      }
      if (cancelled) return;

      const messages = proactiveMessagesFrom(payload);
      const newest = messages.at(-1)?.at ?? "";
      if (seenThrough === null) {
        seenThrough = newest;
        return;
      }
      for (const message of messages) {
        if (message.at <= seenThrough) continue;
        publishProactiveMessage(message);
      }
      seenThrough = newest || seenThrough;
    }

    void poll();
    const timer = window.setInterval(() => void poll(), WATCH_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [watching, fetchMessages]);
}
