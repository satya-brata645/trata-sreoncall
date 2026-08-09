"use client";

import { useEffect, useSyncExternalStore } from "react";
import { MicOff, Pause } from "lucide-react";

import { cn } from "@/lib/utils";
import { isMicMuted, setMicMuted, subscribeMicMuted } from "@/lib/voice/mic-session";
import { useAgentSpeech } from "@/lib/voice/agent-speech";
import { VoiceDots, type VoiceDotsState } from "./VoiceDots";

export function VoiceAgentBar({
  isListening,
  interim,
  onClose,
}: {
  isListening: boolean;
  interim: string;
  onClose: () => void;
}) {
  const speech = useAgentSpeech();
  const muted = useSyncExternalStore(subscribeMicMuted, isMicMuted, () => true);

  // Unmute for as long as the bar is up, then put the preference back exactly
  // as it was. Forcing it to muted on unmount closed the *shared* session, so
  // dismissing the chat composer silenced the desktop's wake-word listener
  // too — and left it muted with nothing on screen offering to unmute it.
  useEffect(() => {
    const wasMuted = isMicMuted();
    setMicMuted(false);
    return () => setMicMuted(wasMuted);
  }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const state: VoiceDotsState = speech.speaking
    ? "speaking"
    : isListening && !muted
      ? "listening"
      : "thinking";
  const caption = speech.speaking
    ? speech.line || "Speaking..."
    : muted
      ? "Microphone muted"
      : interim || (isListening ? "Listening..." : "Starting microphone...");

  return (
    <div role="region" aria-label="Voice conversation" className="relative flex h-[78px] items-center justify-center">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => setMicMuted(!muted)}
          aria-pressed={!muted}
          aria-label={muted ? "Unmute microphone" : "Mute microphone"}
          title={muted ? "Unmute microphone" : "Mute microphone"}
          className={cn(
            "inline-flex size-14 items-center justify-center rounded-full border transition-colors",
            muted
              ? "border-role-border-subtle bg-role-surface-container-subtle text-role-content-muted"
              : "border-role-border-focus bg-role-surface-container",
          )}
        >
          {muted ? <MicOff className="size-5" /> : <VoiceDots state={state} size="lg" />}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Pause voice conversation"
          title="Pause voice conversation"
          className="inline-flex size-10 items-center justify-center rounded-full text-role-content-muted hover:bg-role-surface-component-hover hover:text-role-content-body"
        >
          <Pause className="size-4" />
        </button>
      </div>
      <p aria-live="polite" className="pointer-events-none absolute inset-x-0 bottom-0 mx-auto max-w-[82%] truncate text-center text-body-xs text-role-content-muted">
        {caption}
      </p>
    </div>
  );
}
