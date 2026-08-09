"use client";

import { useEffect, useRef, useState } from "react";

import { useStreamingVoice } from "@/lib/hooks/useStreamingVoice";
import { getAgentSpeech, subscribeAgentSpeech } from "@/lib/voice/agent-speech";
import { BargeVad } from "@/lib/voice/barge-vad";
import { parseConsent } from "@/lib/voice/consent";
import { localEchoDecision } from "@/lib/voice/interrupt-arbiter";
import { getMicRms } from "@/lib/voice/mic-session";
import { getPlaybackControl, playbackHasSettled } from "@/lib/voice/playback-control";
import { getPendingApproval, subscribePendingApproval } from "@/lib/voice/pending-approval";
import { denyPendingApprovalByVoice } from "@/lib/voice/spoken-approval";
import { detectWakeWord } from "@/lib/voice/wakeWord";
import { VoiceSession, type VoiceMode } from "@/lib/voice/session";
import { useAmbientListening } from "./ambientListening";
import { dispatchAgentTurn } from "./agentTurn";
import { useAgentSummon } from "./AgentSummonContext";
import { useWindowManager } from "./WindowManagerContext";

export interface AmbientAgentState {
  isListening: boolean;
  isAwake: boolean;
  mode: VoiceMode;
  isSupported: boolean;
  heard: string;
  /**
   * Something the user has to be told, or null.
   *
   * Voice fails quietly by nature — there is no error state to look at, just a
   * microphone that stops mattering. Every path that used to end in a
   * `console.warn` or in the session silently reopening its ear now ends here,
   * because "I spoke and nothing happened" is indistinguishable from "it is
   * broken" unless something says which.
   */
  notice: string | null;
}

/** The turn was dispatched and no answer ever came back. */
const ANSWER_TIMEOUT_NOTICE = "I did not get an answer back. Say that again?";
/** A question was asked out loud and nothing answered it. */
const APPROVAL_TIMEOUT_NOTICE = "I did not hear an answer, so I left it alone.";
/** The browser refused the microphone, or there is no microphone to refuse. */
const MIC_REFUSED_NOTICE =
  "I cannot open the microphone. Check this site's microphone permission.";
/** No speech recognition in this browser at all. */
const UNSUPPORTED_NOTICE = "This browser cannot listen. Type instead.";

/**
 * Desktop and chat acquire the same microphone. A hotkey opens an awake
 * session; the persistent ambient preference opens a wake-word session.
 */
export function useAmbientAgent(): AmbientAgentState {
  const { enabled, setEnabled } = useAmbientListening();
  const summon = useAgentSummon();
  const { openApp } = useWindowManager();
  const [mode, setMode] = useState<VoiceMode>("idle");
  const [heard, setHeard] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  // Read through a ref so the session machine, built once, always dispatches
  // into the current desktop rather than the one that existed at first render.
  const openAppRef = useRef(openApp);
  const setAmbientEnabledRef = useRef(setEnabled);
  useEffect(() => {
    openAppRef.current = openApp;
    setAmbientEnabledRef.current = setEnabled;
  });

  const [{ session, vad }] = useState(() => {
    let machine: VoiceSession | null = null;
    const loop = new BargeVad({
      getMicRms,
      getPlayback: getPlaybackControl,
      hasSettled: playbackHasSettled,
      getAgentLine: () => getAgentSpeech().line,
      // The fixture has no server arbiter, so the decision is made locally on
      // word overlap. See `localEchoDecision` for why substring matching was
      // not good enough: it let the agent interrupt itself.
      arbitrate: async (text, agentLine) => localEchoDecision(text, agentLine),
      onInterrupt: (text) => machine?.onInterrupted(text),
    });
    machine = new VoiceSession({
      detectWake: detectWakeWord,
      parseConsent,
      events: {
        onMode: setMode,
        onHeard: setHeard,
        onWake: () => setNotice(null),
        onDispatch: (text) => {
          // A new turn supersedes whatever went wrong with the last one.
          setNotice(null);
          // Chat is the surface that owns the conversation and the only thing
          // subscribed to turns, so a spoken instruction has to open it — the
          // same move `AgentSurface` makes for a typed one. `deferrable` covers
          // the gap until its subscription mounts.
          openAppRef.current("chat");
          dispatchAgentTurn(text, { voice: true, deferrable: true });
        },
        onSpokenOver: (text) => loop.onTranscript(text),
        onConsent: (approved) => getPendingApproval()?.respond(approved),
        // Silence is not consent. The session has already stopped waiting; the
        // decision still has to be resolved rather than left half-open — and
        // the user has to be told it was resolved *against* the action.
        onApprovalTimeout: () => {
          denyPendingApprovalByVoice();
          setNotice(APPROVAL_TIMEOUT_NOTICE);
        },
        onAnswerTimeout: () => setNotice(ANSWER_TIMEOUT_NOTICE),
      },
    });
    return { session: machine, vad: loop };
  });

  const origin: "hotkey" | "ambient" | null =
    summon?.isPresent && summon.origin === "hotkey"
      ? "hotkey"
      : enabled
        ? "ambient"
        : null;

  const voice = useStreamingVoice(
    {
      onInterim: (text) => session.onInterim(text),
      onTurnEnd: (text) => session.onTurnEnd(text),
      onError: (_error, fatal) => {
        if (!fatal) return;
        session.onError();
        setNotice(MIC_REFUSED_NOTICE);
        // Turn the preference off with it. A refused microphone that leaves
        // "Mic on" burning amber in the menu bar is the indicator lying about
        // the one thing it exists to report.
        setAmbientEnabledRef.current(false);
      },
    },
    // While this session is open it is the one that decides what a finished
    // sentence means. Chat's composer shares the microphone and would
    // otherwise submit the same utterance a second time.
    { exclusiveTurns: true },
  );
  const { start, stop, isListening, isSupported } = voice;

  useEffect(() => {
    if (!origin) {
      session.close();
      setNotice(null);
      return;
    }
    if (!isSupported) {
      // Summoned in a browser that cannot listen. Saying so beats a bar with a
      // microphone icon that quietly does nothing.
      session.close();
      setNotice(UNSUPPORTED_NOTICE);
      return;
    }
    setNotice(null);
    session.open(origin);
    void start();
    return () => {
      session.close();
      stop();
    };
  }, [origin, isSupported, session, start, stop]);

  useEffect(() => {
    let wasSpeaking = getAgentSpeech().speaking;
    return subscribeAgentSpeech(() => {
      const speaking = getAgentSpeech().speaking;
      if (speaking === wasSpeaking) return;
      wasSpeaking = speaking;
      if (speaking) session.onAnswerStart();
      else session.onAnswerEnd();
    });
  }, [session]);

  useEffect(() => {
    if (mode === "speaking") vad.arm();
    else vad.disarm();
    return () => vad.disarm();
  }, [mode, vad]);

  useEffect(() => {
    const syncApproval = () => {
      if (getPendingApproval()) session.onApprovalPending();
      else session.onApprovalResolved();
    };
    syncApproval();
    return subscribePendingApproval(syncApproval);
  }, [session]);

  useEffect(() => {
    if (mode === "awake" && session.getOrigin() === "ambient") summon?.summon("voice");
  }, [mode, session, summon]);
  useEffect(() => () => session.close(), [session]);

  return {
    isListening: origin !== null && isListening,
    isAwake: mode === "awake",
    mode,
    isSupported,
    heard,
    notice,
  };
}
