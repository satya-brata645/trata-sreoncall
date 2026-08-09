import type { ArbiterDecision } from "./interrupt-arbiter";

export const VAD_TICK_MS = 30;
export const BARGE_VAD_DELTA = 0.05;
export const BARGE_VAD_SUSTAIN_MS = 180;
export const BARGE_IN_SETTLE_MS = 200;
export const VAD_PAUSE_FALLBACK_MS = 1500;

export interface BargeVadDeps {
  getMicRms: () => number;
  getPlayback: () => {
    getLevel: () => number;
    pauseFast: () => void;
    resumeFast: () => void;
    barge: () => void;
  } | null;
  hasSettled: (settleMs: number) => boolean;
  getAgentLine: () => string;
  arbitrate: (
    transcript: string,
    agentLastSaid: string,
  ) => Promise<ArbiterDecision>;
  onInterrupt: (transcript: string) => void;
  observe?: (sample: { mic: number; playback: number; delta: number }) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  setTicker?: (fn: () => void, ms: number) => unknown;
  clearTicker?: (handle: unknown) => void;
}

export interface BargeVadTuning {
  delta?: number;
  sustainMs?: number;
  settleMs?: number;
  fallbackMs?: number;
  tickMs?: number;
}

export class BargeVad {
  private armed = false;
  private paused = false;
  private sustainedMs = 0;
  private ticker: unknown = null;
  private fallback: unknown = null;
  private pending = 0;

  private readonly d: BargeVadDeps;
  private readonly delta: number;
  private readonly sustainMs: number;
  private readonly settleMs: number;
  private readonly fallbackMs: number;
  private readonly tickMs: number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly setTicker: (fn: () => void, ms: number) => unknown;
  private readonly clearTicker: (handle: unknown) => void;

  constructor(deps: BargeVadDeps, tuning: BargeVadTuning = {}) {
    this.d = deps;
    this.delta = tuning.delta ?? BARGE_VAD_DELTA;
    this.sustainMs = tuning.sustainMs ?? BARGE_VAD_SUSTAIN_MS;
    this.settleMs = tuning.settleMs ?? BARGE_IN_SETTLE_MS;
    this.fallbackMs = tuning.fallbackMs ?? VAD_PAUSE_FALLBACK_MS;
    this.tickMs = tuning.tickMs ?? VAD_TICK_MS;
    this.setTimer =
      deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms) as unknown);
    this.clearTimer =
      deps.clearTimer ??
      ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.setTicker =
      deps.setTicker ?? ((fn, ms) => setInterval(fn, ms) as unknown);
    this.clearTicker =
      deps.clearTicker ??
      ((h) => clearInterval(h as ReturnType<typeof setInterval>));
  }

  isArmed(): boolean {
    return this.armed;
  }

  isPaused(): boolean {
    return this.paused;
  }

  arm(): void {
    if (this.armed) return;
    this.armed = true;
    this.sustainedMs = 0;
    this.ticker = this.setTicker(() => this.tick(), this.tickMs);
  }

  disarm(): void {
    if (this.ticker !== null) {
      this.clearTicker(this.ticker);
      this.ticker = null;
    }
    this.clearFallback();
    if (this.paused) {
      this.d.getPlayback()?.resumeFast();
      this.paused = false;
    }
    this.pending++;
    this.armed = false;
    this.sustainedMs = 0;
  }

  onTranscript(text: string): void {
    if (!this.armed) return;
    const transcript = text.trim();
    if (!transcript) return;
    if (!this.paused) this.provisionalPause();
    void this.decide(transcript);
  }

  private tick(): void {
    if (!this.armed || this.paused) return;

    const playback = this.d.getPlayback();
    if (!playback) {
      this.sustainedMs = 0;
      return;
    }

    if (!this.d.hasSettled(this.settleMs)) {
      this.sustainedMs = 0;
      return;
    }

    const mic = this.d.getMicRms();
    const out = playback.getLevel();
    const delta = mic - out;
    this.d.observe?.({ mic, playback: out, delta });

    if (delta <= this.delta) {
      this.sustainedMs = 0;
      return;
    }

    this.sustainedMs += this.tickMs;
    if (this.sustainedMs >= this.sustainMs) this.provisionalPause();
  }

  private provisionalPause(): void {
    this.paused = true;
    this.sustainedMs = 0;
    this.d.getPlayback()?.pauseFast();
    this.armFallback();
  }

  private armFallback(): void {
    this.clearFallback();
    this.fallback = this.setTimer(() => {
      this.fallback = null;
      this.pending++;
      this.resumePlayback();
    }, this.fallbackMs);
  }

  private clearFallback(): void {
    if (this.fallback !== null) {
      this.clearTimer(this.fallback);
      this.fallback = null;
    }
  }

  private async decide(transcript: string): Promise<void> {
    const id = ++this.pending;
    let decision: ArbiterDecision;
    try {
      decision = await this.d.arbitrate(transcript, this.d.getAgentLine());
    } catch {
      decision = { verdict: "interrupt", reason: "arbiter_unreachable" };
    }

    if (id !== this.pending || !this.armed) return;

    this.clearFallback();
    if (decision.verdict === "ignore") {
      this.resumePlayback();
      return;
    }

    this.paused = false;
    this.d.getPlayback()?.barge();
    this.d.onInterrupt(transcript);
  }

  private resumePlayback(): void {
    if (!this.paused) return;
    this.paused = false;
    this.sustainedMs = 0;
    this.d.getPlayback()?.resumeFast();
  }
}
