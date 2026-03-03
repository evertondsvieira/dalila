import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FatalEffectError,
  clearSecurityRuntimeEvents,
  effect,
  getSecurityRuntimeEvents,
  signal,
} from '../dist/core/index.js';

const sleep = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function captureZeroDelayTimeouts<T>(
  fn: () => Promise<T> | T
): Promise<Array<() => void>> {
  const scheduled: Array<() => void> = [];
  const originalSetTimeout = globalThis.setTimeout;

  (globalThis as any).setTimeout = ((handler: TimerHandler, timeout?: number, ...args: any[]) => {
    if (timeout === 0 && typeof handler === 'function') {
      scheduled.push(() => handler(...args));
      return scheduled.length as unknown as ReturnType<typeof setTimeout>;
    }
    return originalSetTimeout(handler, timeout, ...args);
  }) as typeof setTimeout;

  try {
    await fn();
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }

  return scheduled;
}

test('core observability records and dispatches security runtime errors', async () => {
  clearSecurityRuntimeEvents();

  const originalConsoleError = console.error;
  const originalDispatchEvent = (globalThis as any).dispatchEvent;
  const originalCustomEvent = (globalThis as any).CustomEvent;
  const errors: string[] = [];
  const dispatched: Array<{ type: string; detail: unknown }> = [];

  console.error = (...args) => errors.push(args.map(String).join(' '));
  (globalThis as any).dispatchEvent = (event: { type: string; detail: unknown }) => {
    dispatched.push(event);
    return true;
  };
  (globalThis as any).CustomEvent = class MockCustomEvent<T> {
    type: string;
    detail: T;

    constructor(type: string, init?: CustomEventInit<T>) {
      this.type = type;
      this.detail = init?.detail as T;
    }
  };

  try {
    const value = signal(0);

    const scheduledFatalThrows = await captureZeroDelayTimeouts(async () => {
      effect(() => {
        value();
        throw new FatalEffectError('[Dalila] security blocked sink');
      });
      await sleep(10);
    });

    assert.equal(scheduledFatalThrows.length, 1);
    assert.ok(errors.some((entry) => entry.includes('[Dalila][security] Error in effect:')));

    const bufferedEvents = getSecurityRuntimeEvents();
    assert.equal(bufferedEvents.length, 1);
    assert.match(bufferedEvents[0].message, /security blocked sink/);
    assert.equal(bufferedEvents[0].fatal, true);

    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0].type, 'dalila:security-error');
  } finally {
    console.error = originalConsoleError;
    if (originalDispatchEvent === undefined) {
      delete (globalThis as any).dispatchEvent;
    } else {
      (globalThis as any).dispatchEvent = originalDispatchEvent;
    }

    if (originalCustomEvent === undefined) {
      delete (globalThis as any).CustomEvent;
    } else {
      (globalThis as any).CustomEvent = originalCustomEvent;
    }

    clearSecurityRuntimeEvents();
  }
});

test('core observability does not classify generic app errors as security events', async () => {
  clearSecurityRuntimeEvents();

  const originalConsoleError = console.error;
  const errors: string[] = [];
  console.error = (...args) => errors.push(args.map(String).join(' '));

  try {
    effect(() => {
      throw new Error('unsafe state transition in wizard');
    });

    await sleep(10);

    assert.equal(getSecurityRuntimeEvents().length, 0);
    assert.ok(errors.some((entry) => entry.includes('[Dalila] Error in effect:')));
    assert.ok(!errors.some((entry) => entry.includes('[Dalila][security]')));
  } finally {
    console.error = originalConsoleError;
    clearSecurityRuntimeEvents();
  }
});
