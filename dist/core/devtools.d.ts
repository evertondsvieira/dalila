export type DevtoolsNodeType = "scope" | "signal" | "computed" | "effect" | "effectAsync";
export type DevtoolsEdgeKind = "dependency" | "ownership";
export interface DevtoolsNode {
    id: number;
    type: DevtoolsNodeType;
    label: string;
    disposed: boolean;
    scopeId: number | null;
    parentScopeId: number | null;
    reads: number;
    writes: number;
    runs: number;
    lastValue: string;
    lastRunAt: number;
    createdAt: number;
}
export interface DevtoolsEdge {
    from: number;
    to: number;
    kind: DevtoolsEdgeKind;
}
export interface DevtoolsEvent {
    type: string;
    at: number;
    payload: Record<string, unknown>;
}
export interface DevtoolsSnapshot {
    enabled: boolean;
    nodes: DevtoolsNode[];
    edges: DevtoolsEdge[];
    events: DevtoolsEvent[];
    profiler?: DevtoolsProfilerSnapshot;
}
export interface DevtoolsRuntimeOptions {
    maxEvents?: number;
    exposeGlobalHook?: boolean;
    dispatchEvents?: boolean;
}
export interface DevtoolsProfilerNodeSample {
    id: number;
    runs: number;
    avgMs: number;
    p95Ms: number;
    maxMs: number;
    lastMs: number;
    lastAt: number;
}
export interface DevtoolsProfilerSnapshot {
    enabled: boolean;
    windowMs: number;
    samplesPerNode: number;
    nodes: DevtoolsProfilerNodeSample[];
}
export interface DevtoolsHighlightOptions {
    durationMs?: number;
}
export declare function getProfilerSnapshot(): DevtoolsProfilerSnapshot;
export declare function configure(options?: DevtoolsRuntimeOptions): void;
export declare function setEnabled(next: boolean, options?: DevtoolsRuntimeOptions): void;
export declare function setProfilerEnabled(next: boolean, options?: {
    windowMs?: number;
    samplesPerNode?: number;
}): void;
export declare function isEnabled(): boolean;
export declare function reset(): void;
export declare function subscribe(listener: (event: DevtoolsEvent) => void): () => void;
export declare function getSnapshot(): DevtoolsSnapshot;
export declare function registerScope(scopeRef: object, parentScopeRef: object | null, name?: string): void;
export declare function withDevtoolsDomTarget<T>(element: Element | null, fn: () => T): T;
export declare function linkScopeToDom(scopeRef: object, element: Element, label?: string): void;
export declare function disposeScope(scopeRef: object): void;
export declare function registerSignal(signalRef: object, type: "signal" | "computed", options?: {
    scopeRef?: object | null;
    initialValue?: unknown;
}): void;
export declare function registerEffect(effectRef: object, type: "effect" | "effectAsync", scopeRef: object | null): void;
export declare function aliasEffectToNode(effectRef: object, targetRef: object): void;
export declare function linkSubscriberSetToSignal(subscriberSetRef: object, signalRef: object): void;
export declare function trackSignalRead(signalRef: object): void;
export declare function trackSignalWrite(signalRef: object, nextValue: unknown): void;
export declare function trackEffectRun(effectRef: object): void;
export declare function trackEffectRunStart(effectRef: object): void;
export declare function trackEffectRunEnd(effectRef: object): void;
export declare function trackComputedRunStart(computedRef: object): void;
export declare function trackComputedRunEnd(computedRef: object): void;
export declare function trackEffectDispose(effectRef: object): void;
export declare function trackDependency(signalRef: object, effectRef: object): void;
export declare function untrackDependencyBySet(subscriberSetRef: object, effectRef: object): void;
export declare function clearHighlights(): void;
export declare function highlightNode(nodeId: number, options?: DevtoolsHighlightOptions): boolean;
