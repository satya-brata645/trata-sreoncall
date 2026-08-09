"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import {
  acquireMic,
  claimTurnOwnership,
  getMicLive,
  getMicLiveServer,
  isMicSupported,
  registerMicSubscriber,
  releaseMic,
  releaseTurnOwnership,
  subscribeMicState,
} from "@/lib/voice/mic-session";
import type { VoiceProvider, VoiceProviderCallbacks } from "@/lib/voice/types";

export interface StreamingVoiceOptions {
  /**
   * Take sole delivery of completed utterances while this consumer is holding
   * the mic.
   *
   * Set by the desktop's `VoiceSession` and nothing else. Both it and the chat
   * composer subscribe to the same shared session, and both treat a finished
   * sentence as an instruction — so with two live consumers one utterance was
   * sent twice, once by the wake-word machine and once by the composer. Interim
   * text still reaches both, because that is display rather than instruction.
   */
  exclusiveTurns?: boolean;
}

/** React face of the one shared microphone session. */
export function useStreamingVoice(
  callbacks: VoiceProviderCallbacks,
  options: StreamingVoiceOptions = {},
): VoiceProvider {
  const { exclusiveTurns = false } = options;
  const token = useMemo(() => Symbol("mic-holder"), []);
  const [holding, setHolding] = useState(false);
  const [supported, setSupported] = useState(false);
  const micLive = useSyncExternalStore(subscribeMicState, getMicLive, getMicLiveServer);
  const callbacksRef = useRef(callbacks);
  // Assigned after the render rather than during it: the mic session reads this
  // when audio arrives, which is never mid-render.
  useEffect(() => {
    callbacksRef.current = callbacks;
  });

  useEffect(() => registerMicSubscriber(token, () => callbacksRef.current), [token]);
  useEffect(() => setSupported(isMicSupported()), []);
  useEffect(() => () => releaseMic(token), [token]);

  // Claimed alongside the hold rather than at mount: a consumer that is not
  // listening must not silence the one that is.
  useEffect(() => {
    if (!exclusiveTurns || !holding) return;
    return claimTurnOwnership(token);
  }, [exclusiveTurns, holding, token]);

  const start = useCallback(async () => {
    if (!supported) return;
    setHolding(true);
    await acquireMic(token);
  }, [supported, token]);
  const stop = useCallback(() => {
    setHolding(false);
    releaseTurnOwnership(token);
    releaseMic(token);
  }, [token]);
  const toggle = useCallback(async () => {
    if (holding) stop();
    else await start();
  }, [holding, start, stop]);

  return { isListening: holding && micLive, isSupported: supported, start, stop, toggle };
}
