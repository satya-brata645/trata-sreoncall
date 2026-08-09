/**
 * The vocabulary the voice session speaks, without the session.
 *
 * Only the mode type survives into Trata's OS core: the desktop's chrome
 * derives narration, the dots and the aurora from it, and the mock agent drives
 * it through `thinking` → `speaking` → `idle`. The state machine that earns
 * these transitions from real audio is part of the voice pipeline, which this
 * build does not ship.
 *
 * `confirming` is kept even though nothing sets it yet: it is the mode a
 * pending approval puts the session in, and the surfaces that render it are
 * already exhaustive over this union — adding it later should be a type error
 * at those switch statements, not a silently blank bar.
 */
export type VoiceMode =
  | "idle"
  | "ambient"
  | "awake"
  | "thinking"
  | "speaking"
  | "confirming";

/** What opened the session. Decides whether a wake phrase is required. */
export type SessionOrigin = "hotkey" | "ambient";
