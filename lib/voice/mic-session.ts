"use client";

import type { VoiceProviderCallbacks } from "./types";

/**
 * A single browser speech-recognition session shared by chat and the desktop.
 *
 * The production MCS uses Deepgram Flux behind an authenticated relay. This
 * fixture has no backend relay or credentials, so it uses the browser's native
 * recognition implementation while retaining the same holder/subscriber
 * contract. Consumers still share one microphone and receive the same events.
 *
 * Two rules keep the shared session honest:
 *
 * - **A holder opens the mic; mute only closes one that is already open.**
 *   `muted` is a person's preference about a live session, not the gate that
 *   decides whether capture may begin — `wantsActive` is. Starting muted meant
 *   the desktop session (⌥Space, wake word) acquired the mic and then sat
 *   behind a mute nothing outside the chat composer ever cleared, so no audio
 *   was ever captured for it.
 * - **One subscriber owns turn ends.** Interim text and errors fan out to every
 *   subscriber because they are display; a completed utterance is an
 *   instruction, and delivering it twice sends it twice.
 */

interface RecognitionResultItem {
  transcript: string;
}

interface RecognitionResultEventLike extends Event {
  resultIndex: number;
  results: ArrayLike<{
    0: RecognitionResultItem;
    isFinal: boolean;
  }>;
}

interface RecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onresult: ((event: RecognitionResultEventLike) => void) | null;
}

type RecognitionConstructor = new () => RecognitionLike;
export type HolderToken = symbol;

/** Native recognition ends itself constantly; back off rather than hammer. */
const RESTART_MIN_MS = 120;
const RESTART_MAX_MS = 2_000;

let recognition: RecognitionLike | null = null;
let live = false;
let muted = false;
let wantsActive = false;
let starting = false;
let lastTranscript = "";
let restartDelayMs = RESTART_MIN_MS;
let restartTimer: unknown = null;

const holders = new Set<HolderToken>();
const subscribers = new Map<HolderToken, () => VoiceProviderCallbacks>();
const muteListeners = new Set<(next: boolean) => void>();
const stateListeners = new Set<() => void>();

/**
 * Which subscriber gets completed utterances, when one has claimed them.
 *
 * The desktop's `VoiceSession` claims this while it is open: it is the machine
 * that knows about wake words, consent and barge-in, so it is the one that
 * should decide what a finished sentence means. Nothing claims it when the
 * session is closed, and turn ends fan out normally again.
 */
let turnOwner: HolderToken | null = null;

/**
 * The one place this module talks to the browser.
 *
 * Everything here is module-global singleton state driving a Web Speech API
 * that does not exist off a browser, which is why the mute gating, the turn
 * ownership and the restart backoff — the three things most recently fixed in
 * this file — had no tests at all. The seam is narrow on purpose: a recogniser
 * factory and a pair of timers is the entire surface, so a test drives the real
 * state machine rather than a copy of it.
 */
export interface MicSessionSeam {
  createRecognition: () => RecognitionLike | null;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

let seam: MicSessionSeam | null = null;

function timerSet(fn: () => void, ms: number): unknown {
  return seam ? seam.setTimer(fn, ms) : setTimeout(fn, ms);
}

function timerClear(handle: unknown): void {
  if (seam) seam.clearTimer(handle);
  else clearTimeout(handle as ReturnType<typeof setTimeout>);
}

/**
 * Errors worth giving up on. A denied or missing microphone will not fix
 * itself, and restarting into it spins a failure loop that also floods every
 * subscriber's `onError`.
 */
const FATAL_ERRORS = new Set(["not-allowed", "service-not-allowed", "audio-capture"]);
/** Silence and deliberate stops are the normal shape of a live session. */
const QUIET_ERRORS = new Set(["aborted", "no-speech"]);

function emitState() {
  for (const listener of stateListeners) listener();
}

function setLive(next: boolean) {
  if (live === next) return;
  live = next;
  emitState();
}

function fanOut(pick: (callbacks: VoiceProviderCallbacks) => void) {
  for (const getCallbacks of subscribers.values()) {
    try {
      pick(getCallbacks());
    } catch (error) {
      console.error("[voice] subscriber callback failed", error);
    }
  }
}

/** A finished utterance goes to the claimant alone, or to everyone if unclaimed. */
function fanOutTurn(text: string) {
  if (turnOwner !== null) {
    const getCallbacks = subscribers.get(turnOwner);
    if (getCallbacks) {
      try {
        getCallbacks().onTurnEnd?.(text);
      } catch (error) {
        console.error("[voice] turn owner callback failed", error);
      }
      return;
    }
    // The claimant unmounted without releasing. Fall through rather than
    // dropping the sentence on the floor.
    turnOwner = null;
  }
  fanOut((callbacks) => callbacks.onTurnEnd?.(text));
}

function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const browser = window as Window & {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition ?? null;
}

function clearRestart() {
  if (restartTimer === null) return;
  timerClear(restartTimer);
  restartTimer = null;
}

/** Reopen after the browser ends a session on its own, with backoff. */
function scheduleRestart() {
  if (!wantsActive || muted || holders.size === 0) return;
  clearRestart();
  restartTimer = timerSet(() => {
    restartTimer = null;
    open();
  }, restartDelayMs);
  restartDelayMs = Math.min(restartDelayMs * 2, RESTART_MAX_MS);
}

function makeRecognition(): RecognitionLike | null {
  if (seam) {
    const injected = seam.createRecognition();
    if (!injected) return null;
    return wire(injected);
  }
  const Ctor = recognitionConstructor();
  if (!Ctor) return null;
  return wire(new Ctor());
}

function wire(next: RecognitionLike): RecognitionLike {
  next.continuous = true;
  next.interimResults = true;
  next.lang = typeof navigator === "undefined" ? "en-US" : navigator.language || "en-US";
  next.onstart = () => {
    starting = false;
    // A session that actually opened proves the backoff has done its job.
    restartDelayMs = RESTART_MIN_MS;
    setLive(true);
  };
  next.onend = () => {
    starting = false;
    setLive(false);
    // Native recognition stops after pauses. Keep the one held session alive
    // unless it was deliberately muted or released.
    scheduleRestart();
  };
  next.onerror = (event) => {
    starting = false;
    setLive(false);
    const code = event.error ?? "unknown error";
    if (QUIET_ERRORS.has(code)) return;

    if (FATAL_ERRORS.has(code)) {
      // Stop wanting the mic before announcing, so `onend` cannot restart into
      // the same refusal a moment later.
      wantsActive = false;
      clearRestart();
      fanOut((callbacks) =>
        callbacks.onError?.(new Error(`Speech recognition: ${code}`), true),
      );
      return;
    }

    // Transient (`network` is the common one). Report it, keep the session.
    fanOut((callbacks) =>
      callbacks.onError?.(new Error(`Speech recognition: ${code}`), false),
    );
  };
  next.onresult = (event) => {
    // Results can arrive from a session that was muted mid-flight; a muted mic
    // that still dispatched instructions would be a lie the UI cannot correct.
    if (muted) return;

    let interim = "";
    let final = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const text = result?.[0]?.transcript?.trim() ?? "";
      if (!text) continue;
      if (result.isFinal) final += `${text} `;
      else interim += `${text} `;
    }
    if (interim.trim()) {
      lastTranscript = interim.trim();
      fanOut((callbacks) => {
        callbacks.onSpeechStart?.();
        callbacks.onInterim?.(lastTranscript);
      });
    }
    if (final.trim()) {
      const completed = final.trim();
      lastTranscript = "";
      fanOutTurn(completed);
    }
  };
  return next;
}

function open() {
  if (!wantsActive || muted || starting || live) return;
  recognition ??= makeRecognition();
  if (!recognition) return;
  starting = true;
  try {
    recognition.start();
  } catch {
    starting = false;
  }
}

function close() {
  starting = false;
  clearRestart();
  setLive(false);
  try {
    recognition?.stop();
  } catch {
    // Browsers throw if an already-stopped recognizer is stopped again.
  }
}

export function setMicMuted(next: boolean): void {
  if (muted === next) return;
  muted = next;
  for (const listener of muteListeners) listener(muted);
  if (muted) close();
  else {
    restartDelayMs = RESTART_MIN_MS;
    open();
  }
}

export function isMicMuted(): boolean {
  return muted;
}

export function subscribeMicMuted(listener: (next: boolean) => void): () => void {
  muteListeners.add(listener);
  return () => muteListeners.delete(listener);
}

export function subscribeMicState(listener: () => void): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

export function getMicLive(): boolean {
  return live;
}

export function getMicLiveServer(): boolean {
  return false;
}

export function isMicSupported(): boolean {
  return seam !== null || recognitionConstructor() !== null;
}

export function registerMicSubscriber(
  token: HolderToken,
  getCallbacks: () => VoiceProviderCallbacks,
): () => void {
  subscribers.set(token, getCallbacks);
  return () => {
    subscribers.delete(token);
    releaseTurnOwnership(token);
    releaseMic(token);
  };
}

/**
 * Claim completed utterances for one subscriber. Returns the release.
 *
 * Last claim wins: the desktop session opening over a chat composer that was
 * already listening is the desktop session taking the floor, which is what the
 * user asked for by summoning it.
 */
export function claimTurnOwnership(token: HolderToken): () => void {
  turnOwner = token;
  return () => releaseTurnOwnership(token);
}

export function releaseTurnOwnership(token: HolderToken): void {
  if (turnOwner === token) turnOwner = null;
}

export async function acquireMic(token: HolderToken): Promise<void> {
  if (!isMicSupported()) {
    fanOut((callbacks) => callbacks.onError?.(new Error("Speech recognition is not supported"), true));
    return;
  }
  holders.add(token);
  wantsActive = true;
  restartDelayMs = RESTART_MIN_MS;
  void startMicMeter();
  open();
}

export function releaseMic(token: HolderToken): void {
  if (!holders.delete(token) || holders.size > 0) return;
  wantsActive = false;
  lastTranscript = "";
  stopMicMeter();
  close();
}

/* -------------------------------------------------------------------------- */
/* Input level                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Native recognition does not expose input samples, so the level comes from a
 * second capture of the same device through an analyser node.
 *
 * Worth the extra stream: this number is what the dots animate on and what
 * barge-in compares against playback, and a constant zero made both dead —
 * the "listening" dots never moved and `BargeVad`'s level path could never
 * fire, leaving barge-in dependent entirely on transcripts arriving.
 *
 * Every failure path leaves the meter at zero rather than throwing. The mic
 * permission has already been granted to recognition by the time this runs, so
 * in practice it does not prompt again; if it is refused anyway, voice keeps
 * working and only the meter is honest about knowing nothing.
 */

let meterContext: AudioContext | null = null;
let meterStream: MediaStream | null = null;
let meterAnalyser: AnalyserNode | null = null;
let meterBuffer: Float32Array<ArrayBuffer> | null = null;
let meterStarting = false;

async function startMicMeter(): Promise<void> {
  if (typeof window === "undefined") return;
  if (meterAnalyser || meterStarting) return;
  const media = navigator.mediaDevices;
  if (!media?.getUserMedia) return;

  meterStarting = true;
  try {
    const stream = await media.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    // The holder may have let go while permission was pending.
    if (!wantsActive) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    const AudioCtor =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    const context = new AudioCtor();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.4;
    context.createMediaStreamSource(stream).connect(analyser);

    meterStream = stream;
    meterContext = context;
    meterAnalyser = analyser;
    meterBuffer = new Float32Array(analyser.fftSize);
  } catch {
    // No meter. `getMicRms` keeps returning 0, which is what it did before.
  } finally {
    meterStarting = false;
  }
}

function stopMicMeter(): void {
  meterAnalyser = null;
  meterBuffer = null;
  if (meterStream) {
    for (const track of meterStream.getTracks()) track.stop();
    meterStream = null;
  }
  if (meterContext) {
    void meterContext.close().catch(() => {});
    meterContext = null;
  }
}

/** Root-mean-square of the last analyser frame, 0 when there is no meter. */
export function getMicRms(): number {
  const analyser = meterAnalyser;
  const buffer = meterBuffer;
  if (!analyser || !buffer) return 0;
  // A muted mic must read as silence even though the meter stream is still
  // open, or the dots would keep dancing to speech the session is ignoring.
  if (muted) return 0;

  analyser.getFloatTimeDomainData(buffer);
  let sum = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    sum += buffer[index] * buffer[index];
  }
  return Math.sqrt(sum / buffer.length);
}

/* -------------------------------------------------------------------------- */
/* Test seam                                                                   */
/* -------------------------------------------------------------------------- */

/** Drive the real state machine without a browser. Pass null to uninstall. */
export function installMicSessionSeamForTests(next: MicSessionSeam | null): void {
  seam = next;
  resetMicSessionForTests();
}

/** Wipe every piece of module-global state back to a fresh load. */
export function resetMicSessionForTests(): void {
  if (restartTimer !== null) {
    timerClear(restartTimer);
    restartTimer = null;
  }
  recognition = null;
  live = false;
  muted = false;
  wantsActive = false;
  starting = false;
  lastTranscript = "";
  restartDelayMs = RESTART_MIN_MS;
  turnOwner = null;
  holders.clear();
  subscribers.clear();
  muteListeners.clear();
  stateListeners.clear();
}

/** What the module believes, for assertions that have no observable surface. */
export function micSessionStateForTests(): {
  live: boolean;
  muted: boolean;
  wantsActive: boolean;
  holders: number;
  hasRecognition: boolean;
  restartScheduled: boolean;
  restartDelayMs: number;
} {
  return {
    live,
    muted,
    wantsActive,
    holders: holders.size,
    hasRecognition: recognition !== null,
    restartScheduled: restartTimer !== null,
    restartDelayMs,
  };
}
