import { test } from "node:test";
import assert from "node:assert/strict";

import { dispatchAgentTurn, subscribeAgentTurn } from "../agentTurn";

/**
 * The module guards on `typeof window`, so a minimal stub is enough to exercise
 * the contract without a DOM.
 */
function withWindow(run: () => void): void {
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
  const priorWindow = globals.window;
  const priorCustomEvent = globals.CustomEvent;
  globals.window = stub;
  globals.CustomEvent = stub.CustomEvent;
  try {
    run();
  } finally {
    globals.window = priorWindow;
    globals.CustomEvent = priorCustomEvent;
  }
}

test("a dispatched turn reaches a subscriber", () => {
  withWindow(() => {
    const seen: string[] = [];
    const unsubscribe = subscribeAgentTurn((text) => seen.push(text));
    dispatchAgentTurn("show my exposure");
    unsubscribe();
    assert.deepEqual(seen, ["show my exposure"]);
  });
});

test("unsubscribing stops delivery", () => {
  // A thread that unmounted must not keep receiving the bar's turns.
  withWindow(() => {
    const seen: string[] = [];
    subscribeAgentTurn((text) => seen.push(text))();
    dispatchAgentTurn("ignored");
    assert.deepEqual(seen, []);
  });
});

test("an empty turn is not delivered", () => {
  // The bar already trims and guards, but a blank turn reaching the conversation
  // would post an empty message — worth refusing at both ends.
  withWindow(() => {
    const seen: string[] = [];
    const unsubscribe = subscribeAgentTurn((text) => seen.push(text));
    dispatchAgentTurn("");
    unsubscribe();
    assert.deepEqual(seen, []);
  });
});

test("dispatching with no window is a no-op rather than a throw", () => {
  // Imported by a client module that Next may evaluate on the server.
  assert.doesNotThrow(() => dispatchAgentTurn("anything"));
  assert.doesNotThrow(() => subscribeAgentTurn(() => {})());
});

test("a turn carries its voice intent to the subscriber", () => {
  withWindow(() => {
    const seen: Array<{ text: string; voice: boolean | undefined }> = [];
    const unsubscribe = subscribeAgentTurn((text, options) =>
      seen.push({ text, voice: options.voice }),
    );
    dispatchAgentTurn("show my exposure", { voice: true });
    unsubscribe();
    assert.deepEqual(seen, [{ text: "show my exposure", voice: true }]);
  });
});

test("a turn with no options asks for nothing — silence is the default", () => {
  // The Chat window's own composer must not start speaking because the command
  // bar spoke once. Absent intent means absent, not inherited.
  withWindow(() => {
    const seen: Array<boolean | undefined> = [];
    const unsubscribe = subscribeAgentTurn((_t, options) =>
      seen.push(options.voice),
    );
    dispatchAgentTurn("quiet please");
    unsubscribe();
    assert.deepEqual(seen, [undefined]);
  });
});

test("voice intent does not leak from one turn to the next", () => {
  withWindow(() => {
    const seen: Array<boolean | undefined> = [];
    const unsubscribe = subscribeAgentTurn((_t, options) =>
      seen.push(options.voice),
    );
    dispatchAgentTurn("spoken", { voice: true });
    dispatchAgentTurn("typed");
    unsubscribe();
    assert.deepEqual(seen, [true, undefined]);
  });
});

test("a handler always receives an options object, never undefined", () => {
  // Subscribers destructure `options.voice`; a hand-fired event with no detail
  // shape must not turn that into a TypeError.
  withWindow(() => {
    let received: unknown = "never called";
    const unsubscribe = subscribeAgentTurn((_t, options) => {
      received = options;
    });
    (globalThis as unknown as { window: { dispatchEvent: (e: unknown) => void } })
      .window.dispatchEvent({
        type: "transilience:agent-turn",
        detail: { text: "no options key" },
      });
    unsubscribe();
    assert.deepEqual(received, {});
  });
});
