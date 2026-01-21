import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

import { signal } from "../dist/core/signal.js";
import { when } from "../dist/core/when.js";
import { match } from "../dist/core/match.js";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/**
 * Helper for async tests with JSDOM.
 * Sets up DOM globals, runs async test function, waits for microtasks to settle,
 * then cleans up globals to prevent leaks.
 */
async function withDomAsync(fn) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/",
  });

  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.NodeFilter = dom.window.NodeFilter;
  globalThis.DocumentFragment = dom.window.DocumentFragment;
  globalThis.Comment = dom.window.Comment;

  try {
    await fn();
  } finally {
    // Wait for any pending microtasks (from when/match scheduleMicrotask)
    // to complete before cleaning up globals
    await tick(20);

    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.Node;
    delete globalThis.NodeFilter;
    delete globalThis.DocumentFragment;
    delete globalThis.Comment;
  }
}

test("when() mounts initial branch immediately after append", async () => {
  await withDomAsync(async () => {
    document.body.innerHTML = "";

    const visible = signal(true);

    const frag = when(
      () => visible(),
      () => document.createTextNode("Visible"),
      () => document.createTextNode("Hidden")
    );

    document.body.appendChild(frag);

    assert.ok(
      document.body.textContent.includes("Visible"),
      `Expected "Visible", got "${document.body.textContent}"`
    );

    visible.set(false);
    await tick(10);

    assert.ok(
      document.body.textContent.includes("Hidden"),
      `Expected "Hidden", got "${document.body.textContent}"`
    );
  });
});

test("match() mounts initial case immediately after append", async () => {
  await withDomAsync(async () => {
    document.body.innerHTML = "";

    const s = signal("idle");

    const frag = match(() => s(), {
      idle: () => document.createTextNode("Idle"),
      loading: () => document.createTextNode("Loading"),
      _: () => document.createTextNode("Fallback"),
    });

    document.body.appendChild(frag);

    assert.ok(
      document.body.textContent.includes("Idle"),
      `Expected "Idle", got "${document.body.textContent}"`
    );

    s.set("loading");
    await tick(10);

    assert.ok(
      document.body.textContent.includes("Loading"),
      `Expected "Loading", got "${document.body.textContent}"`
    );
  });
});
