import { test } from "node:test";
import assert from "node:assert/strict";

import { dispatchAgentTurn, subscribeAgentTurn } from "../agentTurn";

/**
 * The module guards on `typeof window`, so a minimal stub is enough. Kept in
 * its own file because the deferral buffer is module state, and node's runner
 * gives each file its own process.
 */
function installWindow(): void {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const stub = {
    addEventListener(type: string, listener: (event: unknown) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener(type: string, listener: (event: unknown) => void) {
      listeners.get(type)?.delete(listener);
    },
    dispatchEvent(event: { type: string }) {
      for (const listener of listeners.get(event.type) ?? []) listener(event);
      return true;
    },
    CustomEvent: class {
      type: string;
      detail: unknown;
      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type;
        this.detail = init?.detail;
      }
    },
  };
  const globals = globalThis as Record<string, unknown>;
  globals.window = stub;
  globals.CustomEvent = stub.CustomEvent;
}

installWindow();

test("a spoken turn with no conversation open is held, then delivered", () => {
  // The wake word is owned by the desktop and Chat is the only subscriber, so
  // before this the utterance was dispatched into an empty room: the dots
  // moved, the mic heard you, and nothing ever happened.
  const seen: string[] = [];
  dispatchAgentTurn("what is exposed right now", { voice: true, deferrable: true });
  assert.equal(seen.length, 0, "held, not dropped and not delivered early");

  const unsubscribe = subscribeAgentTurn((text) => seen.push(text));
  assert.deepEqual(seen, ["what is exposed right now"]);
  unsubscribe();
});

test("a held turn keeps its voice intent", () => {
  const seen: Array<boolean | undefined> = [];
  dispatchAgentTurn("say that out loud", { voice: true, deferrable: true });
  const unsubscribe = subscribeAgentTurn((_text, options) => seen.push(options.voice));
  assert.deepEqual(seen, [true]);
  unsubscribe();
});

test("a held turn is drained, so a remount does not replay it", () => {
  // Chat re-subscribes whenever its thread changes; replaying would post the
  // same instruction again on every switch.
  const first: string[] = [];
  const second: string[] = [];
  dispatchAgentTurn("only once", { voice: true, deferrable: true });

  subscribeAgentTurn((text) => first.push(text))();
  subscribeAgentTurn((text) => second.push(text))();

  assert.deepEqual(first, ["only once"]);
  assert.deepEqual(second, []);
});

test("only the most recent held turn survives", () => {
  const seen: string[] = [];
  dispatchAgentTurn("stale question", { voice: true, deferrable: true });
  dispatchAgentTurn("the one I meant", { voice: true, deferrable: true });
  subscribeAgentTurn((text) => seen.push(text))();
  assert.deepEqual(seen, ["the one I meant"]);
});

test("a turn is not held when a conversation is already listening", () => {
  const live: string[] = [];
  const unsubscribe = subscribeAgentTurn((text) => live.push(text));
  dispatchAgentTurn("straight through", { voice: true, deferrable: true });
  assert.deepEqual(live, ["straight through"]);
  unsubscribe();

  // Nothing left over to arrive later.
  const later: string[] = [];
  subscribeAgentTurn((text) => later.push(text))();
  assert.deepEqual(later, []);
});

test("a turn without the flag is never held", () => {
  // The command bar opens Chat itself; a turn that missed should fail rather
  // than turn up somewhere unexpected later.
  const seen: string[] = [];
  dispatchAgentTurn("typed into the bar", { voice: true });
  subscribeAgentTurn((text) => seen.push(text))();
  assert.deepEqual(seen, []);
});

test("a blank spoken turn is never held", () => {
  const seen: string[] = [];
  dispatchAgentTurn("   ", { voice: true, deferrable: true });
  subscribeAgentTurn((text) => seen.push(text))();
  assert.deepEqual(seen, []);
});
