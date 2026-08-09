"use client";

import {
  notePlaybackEnded,
  notePlaybackStarted,
  registerPlaybackControl,
} from "./playback-control";
import { setSpokenLine, stoppedSpeaking } from "./agent-speech";
import { speakableFrom } from "./speakable";

/**
 * Saying the agent's answer out loud, through the browser's local engine.
 *
 * Three things about `speechSynthesis` shape this file, and all three were
 * live faults before:
 *
 * - **It is not a text renderer.** Handed a reply straight out of the model it
 *   reads "asterisk asterisk critical asterisk asterisk", spells URLs out
 *   character by character and recites code fences. `speakable.ts` reduces the
 *   answer to the words a person would actually say.
 * - **It stops on its own.** Chromium's engine pauses somewhere around fifteen
 *   seconds into a single utterance and never resumes, so any answer longer
 *   than a sentence or two was cut off mid-word. Short utterances queued back
 *   to back stay under that limit, and a watchdog resumes an engine that has
 *   gone quiet while it still believes it is speaking.
 * - **`cancel()` immediately before `speak()` races.** The old code did exactly
 *   that on every chunk, which in Chromium intermittently kills the incoming
 *   utterance along with the outgoing one — the failure where the agent
 *   answers and no sound comes out at all. Cancelling is now only ever a stop.
 *
 * The speech state this publishes is load-bearing beyond the audio: the voice
 * session leaves `speaking` when playback drains, so an utterance that starts
 * and never reports finishing hangs the whole machine. Every exit path here
 * ends at `finish()`, including the watchdog's.
 */

/** Utterances longer than this invite the engine's mid-sentence stall. */
const MAX_CHUNK_CHARS = 180;
/** How often to poke a synthesis engine that claims to be speaking. */
const RESUME_TICK_MS = 4_000;
/** No `start` and no `end` for this long means the engine dropped the chunk. */
const CHUNK_STALL_MS = 12_000;
/** Word boundaries arrive every ~250ms of speech; decay a little slower. */
const LEVEL_DECAY_MS = 320;

let queue: string[] = [];
let active: SpeechSynthesisUtterance | null = null;
let generation = 0;
let resumeTimer: ReturnType<typeof setInterval> | null = null;
let stallTimer: ReturnType<typeof setTimeout> | null = null;
let lastBoundaryAt = 0;
let boundaryLevel = 0;
let preferredVoice: SpeechSynthesisVoice | null = null;

function synth(): SpeechSynthesis | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  return window.speechSynthesis;
}

/**
 * A decaying envelope off word boundaries.
 *
 * The engine exposes no samples, so this is the only signal available about
 * whether sound is actually coming out. It is what the speaking dots animate
 * on and what barge-in compares the microphone against; returning a constant
 * zero (as this did) left the dots frozen while the agent talked and made
 * every microphone reading look like an interruption.
 */
function currentLevel(): number {
  if (!boundaryLevel) return 0;
  const elapsed = performance.now() - lastBoundaryAt;
  if (elapsed >= LEVEL_DECAY_MS) return 0;
  return boundaryLevel * (1 - elapsed / LEVEL_DECAY_MS);
}

const unregister =
  typeof window === "undefined"
    ? null
    : registerPlaybackControl({
        getLevel: currentLevel,
        pauseFast: () => synth()?.pause(),
        resumeFast: () => synth()?.resume(),
        barge: stopBrowserSpeech,
      });

/**
 * Split into utterances the engine will finish.
 *
 * Sentence boundaries first because they are where a speaker would breathe;
 * anything still over the limit is broken at a clause and then, failing that,
 * at a word, so a very long sentence degrades rather than being truncated.
 */
export function chunkForSpeech(text: string, limit = MAX_CHUNK_CHARS): string[] {
  const sentences = text.match(/[^.!?]+(?:[.!?]+|$)/g) ?? [text];
  const chunks: string[] = [];
  let buffer = "";

  const flush = () => {
    const line = buffer.trim();
    if (line) chunks.push(line);
    buffer = "";
  };

  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;

    if (sentence.length > limit) {
      flush();
      let rest = sentence;
      while (rest.length > limit) {
        const window = rest.slice(0, limit);
        const cut = Math.max(
          window.lastIndexOf(", "),
          window.lastIndexOf("; "),
          window.lastIndexOf(" — "),
        );
        const at = cut > limit * 0.4 ? cut + 1 : window.lastIndexOf(" ");
        const split = at > 0 ? at : limit;
        chunks.push(rest.slice(0, split).trim());
        rest = rest.slice(split).trim();
      }
      if (rest) chunks.push(rest);
      continue;
    }

    if (buffer && `${buffer} ${sentence}`.length > limit) flush();
    buffer = buffer ? `${buffer} ${sentence}` : sentence;
  }
  flush();
  return chunks;
}

/**
 * Prefer a local English voice once the list has loaded.
 *
 * `getVoices()` is empty on first call in Chromium and fills in asynchronously,
 * so this is best-effort by design: an unset voice speaks in the system default
 * rather than not speaking at all.
 */
function pickVoice(): SpeechSynthesisVoice | null {
  const engine = synth();
  if (!engine) return null;
  if (preferredVoice) return preferredVoice;

  const voices = engine.getVoices();
  if (!voices.length) return null;
  const english = voices.filter((voice) => voice.lang?.toLowerCase().startsWith("en"));
  preferredVoice =
    english.find((voice) => voice.localService && voice.default) ??
    english.find((voice) => voice.localService) ??
    english[0] ??
    null;
  return preferredVoice;
}

function clearTimers() {
  if (resumeTimer !== null) {
    clearInterval(resumeTimer);
    resumeTimer = null;
  }
  clearStall();
}

function clearStall() {
  if (stallTimer !== null) {
    clearTimeout(stallTimer);
    stallTimer = null;
  }
}

/**
 * Keep an engine that believes it is speaking actually speaking.
 *
 * Chromium's synthesis stalls into a state where `speaking` stays true and no
 * audio is produced; `resume()` is the documented poke that revives it. Cheap
 * and harmless when nothing is wrong.
 */
function startResumeWatchdog() {
  if (resumeTimer !== null) return;
  resumeTimer = setInterval(() => {
    const engine = synth();
    if (!engine) return;
    if (!active && queue.length === 0) return;
    if (engine.speaking && !engine.paused) engine.resume();
  }, RESUME_TICK_MS);
}

/** Everything is said, or nothing is going to be. */
function finish() {
  queue = [];
  active = null;
  boundaryLevel = 0;
  clearTimers();
  notePlaybackEnded();
  stoppedSpeaking();
}

export function stopBrowserSpeech(): void {
  generation += 1;
  queue = [];
  active = null;
  boundaryLevel = 0;
  clearTimers();
  synth()?.cancel();
  notePlaybackEnded();
  stoppedSpeaking();
}

function speakNext(era: number): void {
  if (era !== generation) return;
  const engine = synth();
  if (!engine) return finish();

  const line = queue.shift();
  if (line === undefined) return finish();

  const utterance = new SpeechSynthesisUtterance(line);
  const voice = pickVoice();
  if (voice) utterance.voice = voice;
  utterance.rate = 1.02;
  active = utterance;

  // Published per chunk so the command bar's narration follows the voice.
  // `speaking` never drops between chunks, so the session does not see the
  // answer end and restart once per sentence.
  setSpokenLine(line);

  const advance = () => {
    if (era !== generation || active !== utterance) return;
    clearStall();
    active = null;
    speakNext(era);
  };

  // The engine can accept an utterance and then never report on it. Without
  // this the answer stops here and the session waits on speech that is not
  // coming.
  clearStall();
  stallTimer = setTimeout(advance, CHUNK_STALL_MS);

  utterance.onstart = () => {
    if (era !== generation) return;
    notePlaybackStarted();
    // The chunk is alive; give it room for its own length.
    clearStall();
    stallTimer = setTimeout(advance, CHUNK_STALL_MS);
  };
  utterance.onboundary = () => {
    if (era !== generation) return;
    lastBoundaryAt = performance.now();
    boundaryLevel = 0.45 + Math.random() * 0.3;
  };
  utterance.onend = advance;
  utterance.onerror = advance;

  startResumeWatchdog();
  engine.speak(utterance);
}

/** Speak an agent reply. Replaces anything already being said. */
export function speakBrowserText(text: string): void {
  const line = speakableFrom(text);
  if (!line) return;

  const engine = synth();
  if (!engine) {
    // No engine: still publish the line so the command bar and the session's
    // speaking/idle transitions behave the same as they would with audio.
    setSpokenLine(line);
    generation += 1;
    const era = generation;
    setTimeout(() => {
      if (era === generation) finish();
    }, 600);
    return;
  }

  // A new answer replaces the old one. Cancel is a stop here and never the
  // prelude to an immediate `speak()` — `speakNext` runs on the next tick, off
  // the cancel's own callbacks.
  generation += 1;
  queue = [];
  active = null;
  engine.cancel();

  queue = chunkForSpeech(line);
  const era = generation;
  setTimeout(() => speakNext(era), 0);
}

// Kept referenced so module-level registration is not considered dead code.
void unregister;
