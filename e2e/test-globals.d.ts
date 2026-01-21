/**
 * Type declarations for custom window properties used in e2e tests.
 */

declare global {
  interface Window {
    __clickCount: number;
    __effectRuns: number;
    __abortedCount: number;
    __completedCount: number;
    __mounts: number;
    __loopDone: boolean;
  }
}

export {};
