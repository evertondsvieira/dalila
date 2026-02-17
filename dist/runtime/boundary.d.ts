/**
 * Dalila Error Boundary
 *
 * Provides error boundary component that captures errors in children
 * and displays a fallback template.
 *
 * @module dalila/runtime/boundary
 */
import { signal, Signal } from '../core/index.js';
import type { Component } from './component.js';
import type { BindContext, DisposeFunction } from './bind.js';
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
export declare function createErrorBoundary(options: ErrorBoundaryOptions): Component;
/**
 * Bind d-boundary directive - wraps children with error handling
 * This is typically used inside a component that provides error state
 */
export declare function bindBoundary(root: Element, ctx: BindContext, cleanups: DisposeFunction[]): void;
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
export declare function withErrorBoundary<T>(fn: () => T, errorSignal: Signal<Error | null>): T | undefined;
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
export declare function createErrorBoundaryState(options?: {
    onError?: (error: Error) => void;
    onReset?: () => void;
}): ErrorBoundaryState;
