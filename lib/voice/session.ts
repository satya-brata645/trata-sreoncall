export type VoiceMode =
  | "idle"
  | "ambient"
  | "awake"
  | "thinking"
  | "speaking"
  | "confirming";

/** What opened the session. Decides whether a wake phrase is required. */
export type SessionOrigin = "hotkey" | "ambient";

export interface VoiceSessionEvents {
  onMode?: (mode: VoiceMode, previous: VoiceMode) => void;
  onHeard?: (text: string) => void;
  onDispatch?: (text: string) => void;
  onWake?: () => void;
  onConsent?: (approved: boolean) => void;
  onSpokenOver?: (text: string) => void;
  /** The turn was dispatched and nothing ever spoke. See `THINKING_TIMEOUT_MS`. */
  onAnswerTimeout?: () => void;
  /**
   * A spoken question went unanswered. See `CONFIRMING_TIMEOUT_MS`.
   *
   * The handler is expected to **deny**. This fires because nobody said yes,
   * and silence is not consent.
   */
  onApprovalTimeout?: () => void;
}

export const AWAKE_TIMEOUT_MS = 8000;

/**
 * How long a dispatched turn may stay silent before the session takes its ear
 * back.
 *
 * `thinking` is left only by the answer starting, and the answer starting is
 * observed as speech beginning. Every path where speech never begins — the
 * request failing, a round that is all tool calls and no words, a browser with
 * no synthesis, or a Chat window that was closed before the turn arrived —
 * therefore parked the session in `thinking` permanently, where `onInterim`
 * and `onTurnEnd` both fall through and do nothing. The microphone stayed open
 * and the dots kept moving while nothing anyone said could ever be heard
 * again; the only way out was a reload.
 *
 * Generous on purpose: a real answer that takes eleven seconds to arrive
 * should not race this, and the cost of the timeout firing early is only that
 * the session starts listening again slightly before the agent speaks.
 */
export const THINKING_TIMEOUT_MS = 20000;

/**
 * How long a spoken question may go unanswered.
 *
 * `confirming` is the same shape of trap `thinking` was — it is left only when
 * the approval store empties, and an answer the parser cannot read leaves the
 * mode exactly where it was. Someone who wanders off mid-question, or answers
 * in a way `parseConsent` will not commit to, would otherwise leave the
 * microphone open on a decision nobody ever makes.
 *
 * Unlike the thinking watchdog this one is **not** a silent recovery: an
 * outstanding approval must be resolved, not forgotten, so the consumer is
 * expected to deny on `onApprovalTimeout`. Shorter than the thinking timeout
 * because a question is asked *of* someone — if they were going to answer, they
 * would have.
 *
 * Deliberately not re-armed by an unclear answer. The deadline runs from when
 * the question was asked, so "shall I?" cannot be kept alive indefinitely by
 * someone talking around it.
 */
export const CONFIRMING_TIMEOUT_MS = 15000;

export interface VoiceSessionOptions {
  events?: VoiceSessionEvents;
  detectWake: (text: string) => { rest: string } | null;
  parseConsent?: (text: string) => "yes" | "no" | "unclear";
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export class VoiceSession {
  private mode: VoiceMode = "idle";
  private origin: SessionOrigin | null = null;
  private lastInterim = "";
  private awakeTimer: unknown = null;
  private thinkingTimer: unknown = null;
  private confirmingTimer: unknown = null;

  private readonly events: VoiceSessionEvents;
  private readonly detectWake: VoiceSessionOptions["detectWake"];
  private readonly parseConsent: NonNullable<VoiceSessionOptions["parseConsent"]>;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(options: VoiceSessionOptions) {
    this.events = options.events ?? {};
    this.detectWake = options.detectWake;
    this.parseConsent = options.parseConsent ?? (() => "unclear");
    this.setTimer =
      options.setTimer ?? ((fn, ms) => setTimeout(fn, ms) as unknown);
    this.clearTimer =
      options.clearTimer ??
      ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  getMode(): VoiceMode {
    return this.mode;
  }

  getOrigin(): SessionOrigin | null {
    return this.origin;
  }

  getHeard(): string {
    return this.mode === "awake" ? this.lastInterim : "";
  }

  isOpen(): boolean {
    return this.mode !== "idle";
  }

  open(origin: SessionOrigin): void {
    this.origin = origin;
    if (origin === "hotkey") this.setMode("awake");
    else this.setMode("ambient");
  }

  close(): void {
    this.origin = null;
    this.setMode("idle");
  }

  onInterim(text: string): void {
    if (this.mode === "idle") return;

    if (this.mode === "awake") {
      this.lastInterim = text;
      this.events.onHeard?.(text);
      if (this.origin === "ambient") this.armAwakeTimeout();
      return;
    }

    if (this.mode === "ambient") {
      if (this.detectWake(text)) this.wake();
    }
  }

  onTurnEnd(text: string): void {
    if (this.mode === "idle") return;
    const trimmed = text.trim();

    if (this.mode === "confirming") {
      const verdict = this.parseConsent(trimmed);
      if (verdict === "unclear") {
        this.events.onHeard?.(trimmed);
        return;
      }
      this.events.onConsent?.(verdict === "yes");
      return;
    }

    if (this.mode === "speaking") {
      if (trimmed) this.events.onSpokenOver?.(trimmed);
      return;
    }

    if (this.mode === "awake") {
      const match = this.detectWake(trimmed);
      const instruction = (match ? match.rest : trimmed).trim();
      if (!instruction) {
        if (this.origin === "ambient") this.armAwakeTimeout();
        return;
      }
      this.dispatch(instruction);
      return;
    }

    if (this.mode === "ambient") {
      const match = this.detectWake(trimmed);
      if (!match) return;
      this.events.onWake?.();
      if (match.rest.trim()) this.dispatch(match.rest.trim());
      else this.wake();
    }
  }

  onAnswerStart(): void {
    if (this.mode === "idle") return;
    this.setMode("speaking");
  }

  onAnswerEnd(): void {
    if (this.mode === "idle") return;
    if (this.origin === "hotkey") this.setMode("awake");
    else this.setMode("ambient");
  }

  onInterrupted(text: string): void {
    if (this.mode !== "speaking") return;
    const instruction = text.trim();
    if (!instruction) return;
    this.dispatch(instruction);
  }

  onApprovalPending(): void {
    if (this.mode === "idle") return;
    this.setMode("confirming");
    this.armConfirmingTimeout();
  }

  onApprovalResolved(): void {
    if (this.mode !== "confirming") return;
    if (this.origin === "hotkey") this.setMode("awake");
    else this.setMode("ambient");
  }

  onError(): void {
    this.close();
  }

  private dispatch(instruction: string): void {
    this.setMode("thinking");
    this.armThinkingTimeout();
    this.events.onDispatch?.(instruction);
  }

  /**
   * Give up on a question nobody answered.
   *
   * Two things have to happen and they are separate: the decision has to be
   * resolved (the handler's job, by denying), and the session has to stop being
   * deaf (this one's). Doing only the first would leave the mode stuck if
   * nothing is listening for the event; doing only the second would strand an
   * approval half-open.
   */
  private armConfirmingTimeout(): void {
    this.clearConfirmingTimeout();
    this.confirmingTimer = this.setTimer(() => {
      this.confirmingTimer = null;
      if (this.mode !== "confirming") return;
      this.events.onApprovalTimeout?.();
      if (this.mode === "confirming") {
        this.setMode(this.origin === "hotkey" ? "awake" : "ambient");
      }
    }, CONFIRMING_TIMEOUT_MS);
  }

  private clearConfirmingTimeout(): void {
    if (this.confirmingTimer !== null) {
      this.clearTimer(this.confirmingTimer);
      this.confirmingTimer = null;
    }
  }

  /** Fall back to listening if the answer never starts. */
  private armThinkingTimeout(): void {
    this.clearThinkingTimeout();
    this.thinkingTimer = this.setTimer(() => {
      this.thinkingTimer = null;
      if (this.mode !== "thinking") return;
      this.events.onAnswerTimeout?.();
      this.setMode(this.origin === "hotkey" ? "awake" : "ambient");
    }, THINKING_TIMEOUT_MS);
  }

  private clearThinkingTimeout(): void {
    if (this.thinkingTimer !== null) {
      this.clearTimer(this.thinkingTimer);
      this.thinkingTimer = null;
    }
  }

  private wake(): void {
    this.events.onWake?.();
    this.setMode("awake");
    this.armAwakeTimeout();
  }

  private armAwakeTimeout(): void {
    this.clearAwakeTimeout();
    this.awakeTimer = this.setTimer(() => {
      this.awakeTimer = null;
      if (this.mode === "awake" && this.origin === "ambient") {
        this.setMode("ambient");
      }
    }, AWAKE_TIMEOUT_MS);
  }

  private clearAwakeTimeout(): void {
    if (this.awakeTimer !== null) {
      this.clearTimer(this.awakeTimer);
      this.awakeTimer = null;
    }
  }

  private setMode(next: VoiceMode): void {
    if (this.mode === next) return;
    const previous = this.mode;
    this.mode = next;
    this.lastInterim = "";
    if (next !== "awake") this.clearAwakeTimeout();
    if (next !== "thinking") this.clearThinkingTimeout();
    if (next !== "confirming") this.clearConfirmingTimeout();

    this.events.onMode?.(next, previous);
    if (previous === "awake") this.events.onHeard?.("");
  }
}
