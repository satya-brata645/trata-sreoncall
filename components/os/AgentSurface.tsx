"use client";

import { useCallback } from "react";

import { useAgentSummon } from "@/lib/os/AgentSummonContext";
import { useDesktopController } from "@/lib/os/DesktopControllerContext";
import { useWindowManager } from "@/lib/os/WindowManagerContext";
import { dispatchAgentTurn } from "@/lib/os/agentTurn";
import { useAmbientAgent } from "@/lib/os/useAmbientAgent";
import { useAgentSpeech } from "@/lib/voice/agent-speech";
import type { AmbientAgentState } from "@/lib/os/useAmbientAgent";
import { MenuBar } from "./MenuBar";
import { AuroraOverlay } from "./AuroraOverlay";
import { CommandBar } from "./CommandBar";
import type { VoiceDotsState } from "@/components/chat/VoiceDots";

/**
 * The session's mode, reduced to what the dots can show.
 *
 * `null` means no dots at all — the mic is not open and nothing is being said,
 * so an indicator would be claiming activity that is not happening.
 */
function dotsStateFor(mode: string): VoiceDotsState | null {
  switch (mode) {
    case "speaking":
      return "speaking";
    case "thinking":
      return "thinking";
    // Both are "the mic is open and it is your turn" — confirming is just an
    // awake state with a pending question attached.
    case "awake":
    case "confirming":
      return "listening";
    default:
      return null;
  }
}

/**
 * What appears when the agent is present: the aurora, and the bar.
 *
 * One component so the two can only ever be mounted together — they are two
 * views of a single state (`useAgentSummon`), and the failure this prevents is
 * a glow with nothing to type into, or a bar over a desktop nobody is driving.
 *
 * Both hide in full screen along with the dock and menu bar. A full-screen
 * window is the user asking for the whole display, and honouring that means
 * honouring it for the agent's chrome too.
 */
/**
 * What the command bar says, by mode.
 *
 * Exhaustive over the session's modes on purpose: adding a mode later should
 * be a type error here rather than a silently-blank bar.
 */
function narrationFor(
  ambient: AmbientAgentState,
  spokenLine: string,
  summonReason: string | null,
): string | null {
  switch (ambient.mode) {
    case "speaking":
      // The agent's own words — the narration this bar exists to show.
      return spokenLine || null;
    case "awake":
      // Nothing here: the transcript now goes into the field itself (as its
      // placeholder, where the words would have appeared had you typed them)
      // and the dots already say the mic is open. Returning `heard` as well
      // would print the same sentence twice, one line apart.
      return null;
    case "thinking":
      return "Working on it…";
    case "confirming":
      // A decision is outstanding. The bar keeps the question on screen
      // alongside the card, because someone who was listening rather than
      // looking needs to be able to glance up and see what they are agreeing
      // to — and because a mic that is open for an answer must visibly be
      // open for an answer, not look like ordinary listening.
      return ambient.heard || "Waiting on you — say yes or no.";
    case "ambient":
    case "idle":
      // Nothing of ours to say; the agent's reason for summoning itself, if
      // that is why the bar is up.
      return summonReason;
  }
}

export function AgentSurface() {
  const summon = useAgentSummon();
  const controller = useDesktopController();
  const { isAnyWindowFullScreen, openApp } = useWindowManager();

  // Mounted here rather than in the menu bar so there is exactly one listener
  // for the whole desktop. Two would mean two open microphones and two wakes
  // for every phrase.
  const ambient = useAmbientAgent();
  // What the agent is currently saying, published by the playback queue as it
  // schedules each chunk's audio.
  const speech = useAgentSpeech();

  const handleSubmit = useCallback(
    (text: string) => {
      // Surface Chat before handing the turn over.
      //
      // Not a compromise — doctrine rule 1 says Chat stays visible whenever the
      // agent is speaking, and a turn narrated into a window nobody can see is
      // the thing that rule exists to prevent. Chat is a singleton, so this
      // focuses the existing window when there is one.
      //
      // Dispatched after, so the trunk's subscription is mounted and listening
      // by the time the turn arrives.
      openApp("chat");
      // `voice: true` because this is the agent surface — you summoned it and
      // it answers out loud (`FR-36`). It travels with the turn rather than
      // switching the conversation into a voice mode, so the next thing typed
      // into the Chat window is silent again.
      requestAnimationFrame(() => dispatchAgentTurn(text, { voice: true }));
    },
    [openApp],
  );

  if (!summon) return null;

  const present = summon.isPresent && !isAnyWindowFullScreen;

  return (
    <>
      {/* The menu bar lives here so it can be told whether the mic is live —
          it owns the toggle, but only this tree knows the session's state. */}
      <MenuBar micLive={ambient.isListening} />
      <AuroraOverlay active={present} speaking={ambient.isAwake} />
      {present && (
        <CommandBar
          // Keyed per summons so each one starts with an empty field — a
          // remount rather than an effect reaching in to clear it.
          key={summon.origin ?? "none"}
          // Only steal the caret when the user asked for the bar. If the agent
          // raised it, they were mid-something and it is not ours to interrupt.
          autoFocus={summon.origin === "hotkey" || summon.origin === "voice"}
          voiceState={dotsStateFor(ambient.mode)}
          transcript={ambient.heard}
          // Derived from the session's **mode**, not from which strings happen
          // to be non-empty. The truthiness version of this line is what let a
          // finished answer sit on the bar forever: a stale non-empty string
          // wins a `||` chain, and nothing was resetting it. A mode always
          // knows what it is, and leaving a mode clears what belonged to it.
          narration={narrationFor(ambient, speech.line, summon.reason)}
          isDriving={controller?.isDriving ?? false}
          onSubmit={handleSubmit}
          onDismiss={summon.dismiss}
        />
      )}
    </>
  );
}
