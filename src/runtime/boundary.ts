/**
 * Dalila Error Boundary
 *
 * Provides error boundary component that captures errors in children
 * and displays a fallback template.
 *
 * @module dalila/runtime/boundary
 */

import { effect, signal, Signal } from '../core/index.js';
import { bind } from './bind.js';
import { defineComponent } from './component.js';
import type { Component } from './component.js';
import type { BindContext, DisposeFunction } from './bind.js';

// ============================================================================
// Types
// ============================================================================

export interface ErrorBoundaryOptions {
  /** Template to show when an error occurs */
  fallback: string;
  /** Callback when error is caught */
  onError?: (error: Error) => void;
  /** Callback when error is reset */
  onReset?: () => void;
}

export interface ErrorBoundaryState {
  /** The error that was caught */
  error: ReturnType<typeof signal<Error | null>>;
  /** Function to reset the error and retry */
  reset: () => void;
  /** Whether there's an error */
  hasError: () => boolean;
}

export type ErrorBoundaryResult = {
  /** The error boundary component */
  component: Component;
  /** Access to error boundary state */
  state: ErrorBoundaryState;
};

// ============================================================================
// Error Boundary Component
// ============================================================================

/**
 * Creates an error boundary component that catches errors in its children.
 *
 * @param options - Configuration for the error boundary
 * @returns Component with error boundary functionality
 *
 * @example
 * ```ts
 * const ErrorBoundary = createErrorBoundary({
 *   fallback: '<div class="error">Something went wrong</div>',
 *   onError: (err) => console.error(err),
 * });
 *
 * // Use as component
 * <error-boundary>
 *   <MyComponent />
 * </error-boundary>
 * ```
 */
export function createErrorBoundary(options: ErrorBoundaryOptions): Component {
  const {
    fallback: fallbackTemplate = '<div>Error occurred</div>',
    onError,
    onReset,
  } = options;

  // Create signal for tracking error state
  const errorSignal = signal<Error | null>(null);

  const hasError = (): boolean => {
    return errorSignal() !== null;
  };

  const reset = (): void => {
    errorSignal.set(null);
    onReset?.();
  };

  const escapedFallback = escapeAttribute(fallbackTemplate);

  // Create the error boundary component
  const tag = `error-boundary-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const boundaryComponent = defineComponent({
    tag,
    template: `<div d-boundary="${escapedFallback}" d-boundary-error="$$boundaryError" d-boundary-reset="$$boundaryReset"><slot></slot></div>`,
    props: {},
    setup: () => {
      if (onError) {
        effect(() => {
          const error = errorSignal();
          if (error) onError(error);
        });
      }

      // Return error state and reset function
      return {
        $$boundaryError: errorSignal,
        $$boundaryReset: reset,
        $$boundaryHasError: hasError,
      };
    }
  });

  // Return component with state
  const result: ErrorBoundaryResult = {
    component: boundaryComponent,
    state: {
      error: errorSignal,
      reset,
      hasError,
    }
  };

  return boundaryComponent;
}

// ============================================================================
// d-boundary Directive (for use within existing bind context)
// ============================================================================

/**
 * Bind d-boundary directive - wraps children with error handling
 * This is typically used inside a component that provides error state
 */
export function bindBoundary(
  root: Element,
  ctx: BindContext,
  cleanups: DisposeFunction[]
): void {
  const elements = qsaIncludingRoot(root, '[d-boundary]');
  const boundary = root.closest('[data-dalila-internal-bound]');
  const consumedNested = new WeakSet<Element>();

  for (const el of elements) {
    if (consumedNested.has(el)) continue;

    // Skip stale nodes from the initial snapshot.
    if (!root.contains(el)) continue;
    if (el.closest('[data-dalila-internal-bound]') !== boundary) continue;

    for (const nested of Array.from(el.querySelectorAll('[d-boundary]'))) {
      consumedNested.add(nested);
    }

    const fallbackTemplate = el.getAttribute('d-boundary')?.trim() || '<div>Error occurred</div>';
    const errorBindingName = normalizeBinding(el.getAttribute('d-boundary-error'));
    const resetBindingName = normalizeBinding(el.getAttribute('d-boundary-reset'));

    // Get error and reset from context
    const errorSignal = errorBindingName ? ctx[errorBindingName] : null;
    const resetFn = resetBindingName ? ctx[resetBindingName] : null;

    // Remove d-boundary attributes to prevent reprocessing
    el.removeAttribute('d-boundary');
    el.removeAttribute('d-boundary-error');
    el.removeAttribute('d-boundary-reset');

    const templateChildren = Array.from(el.childNodes).map((child) => child.cloneNode(true));

    const host = el as HTMLElement;
    // Preserve host node and render boundary content inside it.
    while (host.firstChild) {
      host.removeChild(host.firstChild);
    }

    let mountedNode: HTMLElement | null = null;
    let mountedDispose: (() => void) | null = null;

    const unmountCurrent = () => {
      if (mountedDispose) {
        mountedDispose();
        mountedDispose = null;
      }
      if (mountedNode && mountedNode.parentNode) {
        mountedNode.parentNode.removeChild(mountedNode);
      }
      mountedNode = null;
    };

    const mountChildren = () => {
      unmountCurrent();

      const childCtx: BindContext = Object.create(ctx);
      if (errorSignal) childCtx.error = errorSignal;
      if (resetFn) childCtx.reset = resetFn;

      const container = document.createElement('div');
      container.setAttribute('data-boundary-children', '');
      container.setAttribute('data-dalila-internal-bound', '');
      for (const child of templateChildren) {
        container.appendChild(child.cloneNode(true));
      }

      host.appendChild(container);

      mountedDispose = bind(container, childCtx, {
        _skipLifecycle: true,
      });
      mountedNode = container;
    };

    const mountError = (error: Error) => {
      unmountCurrent();

      const errorCtx: BindContext = Object.create(ctx);
      if (errorSignal) errorCtx.error = errorSignal;
      if (resetFn) errorCtx.reset = resetFn;

      const errorDisplay = document.createElement('div');
      errorDisplay.setAttribute('data-boundary-error', '');
      errorDisplay.setAttribute('data-dalila-internal-bound', '');
      errorDisplay.innerHTML = fallbackTemplate;

      const errorMsg = errorDisplay.querySelector('[data-error-message]');
      if (errorMsg) {
        errorMsg.textContent = error.message;
      }

      host.appendChild(errorDisplay);

      mountedDispose = bind(errorDisplay, errorCtx, {
        _skipLifecycle: true,
      });
      mountedNode = errorDisplay;
    };

    if (errorSignal) {
      const getCurrentError = (): Error | null => (
        typeof errorSignal === 'function' ? (errorSignal as () => Error | null)() : null
      );

      let lastError = getCurrentError();
      if (lastError) {
        mountError(lastError);
      } else {
        mountChildren();
      }

      const disposeEffect = effect(() => {
        const error = getCurrentError();
        if (error === lastError) return;
        lastError = error;

        if (error) {
          mountError(error);
        } else {
          mountChildren();
        }
      });
      cleanups.push(disposeEffect);
    } else {
      mountChildren();
    }

    cleanups.push(() => {
      unmountCurrent();
    });
  }
}

// Helper to find elements including root
function qsaIncludingRoot(root: Element, selector: string): Element[] {
  const out: Element[] = [];
  if (root.matches(selector)) out.push(root);
  out.push(...Array.from(root.querySelectorAll(selector)));
  return out;
}

// Helper to normalize binding
function normalizeBinding(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed;
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ============================================================================
// withErrorBoundary Helper
// ============================================================================

/**
 * Wraps a function with error boundary logic
 *
 * @param fn - Function that might throw
 * @param errorSignal - Signal to store the error
 * @returns Result of the function or undefined if error
 *
 * @example
 * ```ts
 * const result = withErrorBoundary(
 *   () => riskyOperation(),
 *   errorSignal
 * );
 * ```
 */
export function withErrorBoundary<T>(
  fn: () => T,
  errorSignal: Signal<Error | null>
): T | undefined {
  try {
    return fn();
  } catch (error) {
    errorSignal.set(error instanceof Error ? error : new Error(String(error)));
    return undefined;
  }
}

// ============================================================================
// createErrorBoundaryState (for use in setup)
// ============================================================================

/**
 * Creates error boundary state for use in component setup
 *
 * @param options - Configuration options
 * @returns Error boundary state and methods
 *
 * @example
 * ```ts
 * const MyComponent = defineComponent({
 *   tag: 'my-component',
 *   setup(props, ctx) {
 *     const { error, reset, hasError } = createErrorBoundaryState({
 *       onError: (err) => logError(err),
 *     });
 *
 *     const handleClick = () => {
 *       withErrorBoundary(() => {
 *         // risky operation
 *       }, error);
 *     };
 *
 *     return { error, handleClick };
 *   }
 * });
 * ```
 */
export function createErrorBoundaryState(options?: {
  onError?: (error: Error) => void;
  onReset?: () => void;
}): ErrorBoundaryState {
  const errorSignal = signal<Error | null>(null);

  const hasError = (): boolean => {
    return errorSignal() !== null;
  };

  const reset = (): void => {
    errorSignal.set(null);
    options?.onReset?.();
  };

  // Set up error handler
  const handleError = options?.onError;
  if (handleError) {
    effect(() => {
      const error = errorSignal();
      if (error) {
        handleError(error);
      }
    });
  }


  return {
    error: errorSignal,
    reset,
    hasError,
  };
}
