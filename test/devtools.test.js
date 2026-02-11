import { test } from "node:test";
import assert from "node:assert/strict";

import {
  computed,
  createScope,
  effect,
  getDevtoolsSnapshot,
  initDevTools,
  onDevtoolsEvent,
  resetDevtools,
  setDevtoolsEnabled,
  signal,
  withScope,
} from "../dist/core/index.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function findNode(snapshot, type) {
  return snapshot.nodes.find((node) => node.type === type);
}

test("devtools snapshot tracks graph and scope lifecycle", async () => {
  await initDevTools({ exposeGlobalHook: false, dispatchEvents: false });
  resetDevtools();

  const scope = createScope();
  let count;

  withScope(scope, () => {
    count = signal(1);
    const doubled = computed(() => count() * 2);

    effect(() => {
      doubled();
    });
  });

  await tick();

  let snapshot = getDevtoolsSnapshot();
  assert.equal(snapshot.enabled, true);

  const scopeNode = findNode(snapshot, "scope");
  const signalNode = findNode(snapshot, "signal");
  const computedNode = findNode(snapshot, "computed");
  const effectNode = findNode(snapshot, "effect");

  assert.ok(scopeNode, "should register a scope node");
  assert.ok(signalNode, "should register a signal node");
  assert.ok(computedNode, "should register a computed node");
  assert.ok(effectNode, "should register an effect node");

  assert.ok(
    snapshot.edges.some((edge) => edge.kind === "dependency" && edge.from === signalNode.id && edge.to === computedNode.id),
    "should include signal -> computed dependency"
  );

  assert.ok(
    snapshot.edges.some((edge) => edge.kind === "dependency" && edge.from === computedNode.id && edge.to === effectNode.id),
    "should include computed -> effect dependency"
  );

  count.set(2);
  await tick();

  snapshot = getDevtoolsSnapshot();
  const updatedSignal = snapshot.nodes.find((node) => node.id === signalNode.id);
  assert.ok(updatedSignal, "signal node should still exist");
  assert.equal(updatedSignal.writes, 1);

  scope.dispose();

  snapshot = getDevtoolsSnapshot();
  const disposedScope = snapshot.nodes.find((node) => node.id === scopeNode.id);
  const disposedEffect = snapshot.nodes.find((node) => node.id === effectNode.id);

  assert.ok(disposedScope, "scope node should remain in snapshot");
  assert.ok(disposedEffect, "effect node should remain in snapshot");
  assert.equal(disposedScope.disposed, true);
  assert.equal(disposedEffect.disposed, true);
});

test("reset does not leave dangling dependency edges for pre-reset reactives", async () => {
  await initDevTools({ exposeGlobalHook: false, dispatchEvents: false });
  resetDevtools();

  const s = signal(0);
  effect(() => {
    s();
  });
  await tick();

  resetDevtools();

  // Trigger old reactive graph after reset.
  s.set(1);
  await tick();

  const snapshot = getDevtoolsSnapshot();
  const nodeIds = new Set(snapshot.nodes.map((node) => node.id));
  const hasDanglingEdge = snapshot.edges.some((edge) => !nodeIds.has(edge.from) || !nodeIds.has(edge.to));
  assert.equal(hasDanglingEdge, false, "snapshot must not contain edges pointing to missing nodes");
});

test("setDevtoolsEnabled(false) emits lifecycle event to subscribers", async () => {
  await initDevTools({ exposeGlobalHook: false, dispatchEvents: false });
  resetDevtools();

  const events = [];
  const off = onDevtoolsEvent((event) => {
    if (event.type === "devtools.enabled") {
      events.push(event.payload?.enabled);
    }
  });

  setDevtoolsEnabled(false);
  off();

  assert.ok(events.includes(false), "disable transition should be observable by subscribers");
});

test("late devtools enable does not create dangling ownership edges", async () => {
  setDevtoolsEnabled(false);
  resetDevtools();

  const parentScope = createScope();
  const childScope = withScope(parentScope, () => createScope());

  await initDevTools({ exposeGlobalHook: false, dispatchEvents: false });

  withScope(childScope, () => {
    const s = signal(0);
    effect(() => {
      s();
    });
    s.set(1);
  });
  await tick();

  const snapshot = getDevtoolsSnapshot();
  const nodeIds = new Set(snapshot.nodes.map((node) => node.id));
  const hasDanglingOwnership = snapshot.edges
    .filter((edge) => edge.kind === "ownership")
    .some((edge) => !nodeIds.has(edge.from) || !nodeIds.has(edge.to));

  assert.equal(hasDanglingOwnership, false, "ownership edges must point only to registered nodes");
});
