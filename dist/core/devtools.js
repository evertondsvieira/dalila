const DEFAULT_MAX_EVENTS = 500;
const GLOBAL_HOOK_KEY = "__DALILA_DEVTOOLS__";
const GLOBAL_EVENT_NAME = "dalila:devtools:event";
let enabled = false;
let maxEvents = DEFAULT_MAX_EVENTS;
let exposeGlobalHook = false;
let dispatchEvents = false;
let nextId = 1;
let refToId = new WeakMap();
const nodes = new Map();
const dependencyEdges = new Map();
const ownershipEdges = new Map();
let subscriberSetToSignalId = new WeakMap();
let effectAliasToNodeId = new WeakMap();
const listeners = new Set();
let events = [];
const nodeDomTargets = new Map();
const highlightTimers = new WeakMap();
let currentDomTarget = null;
const HIGHLIGHT_ATTR = "data-dalila-devtools-highlight";
const HIGHLIGHT_LABEL_ATTR = "data-dalila-devtools-label";
const HIGHLIGHT_STYLE_ID = "dalila-devtools-highlight-style";
function canUseGlobalDispatch() {
    return typeof globalThis.dispatchEvent === "function";
}
function canUseDOM() {
    return typeof document !== "undefined" && typeof Element !== "undefined";
}
function clearHighlightOnElement(element) {
    const timer = highlightTimers.get(element);
    if (timer !== undefined && typeof globalThis.clearTimeout === "function") {
        globalThis.clearTimeout(timer);
        highlightTimers.delete(element);
    }
    element.removeAttribute(HIGHLIGHT_ATTR);
    element.removeAttribute(HIGHLIGHT_LABEL_ATTR);
}
function ensureHighlightStyle() {
    if (!canUseDOM())
        return;
    if (document.getElementById(HIGHLIGHT_STYLE_ID))
        return;
    const style = document.createElement("style");
    style.id = HIGHLIGHT_STYLE_ID;
    style.textContent = `
[${HIGHLIGHT_ATTR}="1"] {
  outline: 2px solid #0f6d67 !important;
  outline-offset: 2px !important;
  box-shadow: 0 0 0 3px rgba(15, 109, 103, 0.22) !important;
  transition: outline-color 120ms ease, box-shadow 120ms ease;
}`;
    (document.head || document.documentElement).append(style);
}
function resolveNodeDomTargets(nodeId) {
    const direct = nodeDomTargets.get(nodeId);
    if (direct && direct.size > 0)
        return Array.from(direct);
    const node = nodes.get(nodeId);
    if (!node)
        return [];
    if (node.type !== "scope" && node.scopeId !== null) {
        const scopeTargets = nodeDomTargets.get(node.scopeId);
        if (scopeTargets && scopeTargets.size > 0)
            return Array.from(scopeTargets);
    }
    return [];
}
function addDomTarget(nodeId, element) {
    let targets = nodeDomTargets.get(nodeId);
    if (!targets) {
        targets = new Set();
        nodeDomTargets.set(nodeId, targets);
    }
    targets.add(element);
}
function previewValue(value) {
    const type = typeof value;
    if (type === "string") {
        const quoted = JSON.stringify(value);
        return quoted.length > 120 ? `${quoted.slice(0, 117)}...` : quoted;
    }
    if (value === null ||
        type === "number" ||
        type === "boolean" ||
        type === "undefined" ||
        type === "bigint" ||
        type === "symbol") {
        return String(value);
    }
    if (type === "function") {
        const fn = value;
        return `[Function ${fn.name || "anonymous"}]`;
    }
    try {
        const json = JSON.stringify(value);
        if (json === undefined)
            return Object.prototype.toString.call(value);
        return json.length > 120 ? `${json.slice(0, 117)}...` : json;
    }
    catch {
        return Object.prototype.toString.call(value);
    }
}
function getNodeId(ref) {
    const alias = effectAliasToNodeId.get(ref);
    if (alias)
        return alias;
    const existing = refToId.get(ref);
    if (existing)
        return existing;
    const id = nextId++;
    refToId.set(ref, id);
    return id;
}
function edgeKey(from, to, kind) {
    return `${kind}:${from}->${to}`;
}
function emit(type, payload) {
    if (!enabled)
        return;
    const event = {
        type,
        at: Date.now(),
        payload,
    };
    events.push(event);
    if (events.length > maxEvents) {
        events = events.slice(events.length - maxEvents);
    }
    for (const listener of listeners) {
        try {
            listener(event);
        }
        catch (error) {
            console.error("[Dalila] Devtools listener threw:", error);
        }
    }
    if (dispatchEvents && canUseGlobalDispatch() && typeof CustomEvent !== "undefined") {
        try {
            globalThis.dispatchEvent(new CustomEvent(GLOBAL_EVENT_NAME, {
                detail: event,
            }));
        }
        catch {
            // Ignore environments without full event support.
        }
    }
}
function createNode(ref, type, label, options) {
    const id = getNodeId(ref);
    if (nodes.has(id))
        return id;
    const scopeId = options?.scopeRef ? getNodeId(options.scopeRef) : null;
    const parentScopeId = options?.parentScopeRef ? getNodeId(options.parentScopeRef) : null;
    const registeredScopeId = scopeId !== null && nodes.has(scopeId) ? scopeId : null;
    const registeredParentScopeId = parentScopeId !== null && nodes.has(parentScopeId) ? parentScopeId : null;
    nodes.set(id, {
        id,
        type,
        label,
        disposed: false,
        scopeId: registeredScopeId,
        parentScopeId: registeredParentScopeId,
        reads: 0,
        writes: 0,
        runs: 0,
        lastValue: options && "initialValue" in options ? previewValue(options.initialValue) : "",
        lastRunAt: 0,
        createdAt: Date.now(),
    });
    if (registeredScopeId !== null) {
        addOwnershipEdge(registeredScopeId, id);
    }
    if (type === "scope" && registeredParentScopeId !== null) {
        addOwnershipEdge(registeredParentScopeId, id);
    }
    emit("node.create", { id, type, label, scopeId: registeredScopeId, parentScopeId: registeredParentScopeId });
    return id;
}
function addOwnershipEdge(from, to) {
    if (!nodes.has(from) || !nodes.has(to))
        return;
    const key = edgeKey(from, to, "ownership");
    if (ownershipEdges.has(key))
        return;
    const edge = { from, to, kind: "ownership" };
    ownershipEdges.set(key, edge);
    emit("edge.add", { from: edge.from, to: edge.to, kind: edge.kind });
}
function upsertDependencyEdge(from, to) {
    const key = edgeKey(from, to, "dependency");
    if (dependencyEdges.has(key))
        return;
    const edge = { from, to, kind: "dependency" };
    dependencyEdges.set(key, edge);
    emit("edge.add", { from: edge.from, to: edge.to, kind: edge.kind });
}
function removeDependencyEdge(from, to) {
    const key = edgeKey(from, to, "dependency");
    const existing = dependencyEdges.get(key);
    if (!existing)
        return;
    dependencyEdges.delete(key);
    emit("edge.remove", { from: existing.from, to: existing.to, kind: existing.kind });
}
function markDisposed(ref) {
    if (!enabled)
        return;
    const node = nodes.get(getNodeId(ref));
    if (!node || node.disposed)
        return;
    node.disposed = true;
    emit("node.dispose", { id: node.id, type: node.type });
}
function markRead(ref) {
    if (!enabled)
        return;
    const node = nodes.get(getNodeId(ref));
    if (!node)
        return;
    node.reads += 1;
}
function markWrite(ref, nextValue) {
    if (!enabled)
        return;
    const node = nodes.get(getNodeId(ref));
    if (!node)
        return;
    node.writes += 1;
    node.lastValue = previewValue(nextValue);
    emit("signal.write", { id: node.id, type: node.type, nextValue: node.lastValue });
}
function markRun(ref) {
    if (!enabled)
        return;
    const node = nodes.get(getNodeId(ref));
    if (!node)
        return;
    node.runs += 1;
    node.lastRunAt = Date.now();
}
function installGlobalHook() {
    if (!exposeGlobalHook)
        return;
    const host = globalThis;
    if (host[GLOBAL_HOOK_KEY])
        return;
    host[GLOBAL_HOOK_KEY] = {
        version: 1,
        getSnapshot,
        subscribe,
        reset,
        setEnabled,
        configure,
        highlightNode,
        clearHighlights,
    };
}
export function configure(options = {}) {
    if (typeof options.maxEvents === "number" && Number.isFinite(options.maxEvents) && options.maxEvents > 0) {
        maxEvents = Math.floor(options.maxEvents);
        if (events.length > maxEvents) {
            events = events.slice(events.length - maxEvents);
        }
    }
    if (typeof options.exposeGlobalHook === "boolean") {
        exposeGlobalHook = options.exposeGlobalHook;
    }
    if (typeof options.dispatchEvents === "boolean") {
        dispatchEvents = options.dispatchEvents;
    }
    if (enabled)
        installGlobalHook();
}
export function setEnabled(next, options) {
    if (options)
        configure(options);
    if (next) {
        enabled = true;
        installGlobalHook();
        emit("devtools.enabled", { enabled: true });
    }
    else {
        if (enabled) {
            emit("devtools.enabled", { enabled: false });
        }
        enabled = false;
    }
}
export function isEnabled() {
    return enabled;
}
export function reset() {
    // Identity maps must be reset together with graph state. Otherwise existing
    // refs keep stale ids and can generate edges pointing to missing nodes.
    nextId = 1;
    refToId = new WeakMap();
    subscriberSetToSignalId = new WeakMap();
    effectAliasToNodeId = new WeakMap();
    dependencyEdges.clear();
    ownershipEdges.clear();
    nodes.clear();
    nodeDomTargets.clear();
    currentDomTarget = null;
    events = [];
    if (enabled) {
        emit("devtools.reset", {});
    }
}
export function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
export function getSnapshot() {
    return {
        enabled,
        nodes: Array.from(nodes.values()).map((node) => ({ ...node })),
        edges: [...Array.from(ownershipEdges.values()), ...Array.from(dependencyEdges.values())],
        events: events.map((event) => ({ ...event, payload: { ...event.payload } })),
    };
}
export function registerScope(scopeRef, parentScopeRef) {
    if (!enabled)
        return;
    createNode(scopeRef, "scope", "scope", {
        parentScopeRef,
    });
}
export function withDevtoolsDomTarget(element, fn) {
    if (!element || !canUseDOM())
        return fn();
    if (!(element instanceof Element))
        return fn();
    const prev = currentDomTarget;
    currentDomTarget = element;
    try {
        return fn();
    }
    finally {
        currentDomTarget = prev;
    }
}
export function linkScopeToDom(scopeRef, element, label) {
    if (!enabled || !canUseDOM())
        return;
    if (!(element instanceof Element))
        return;
    const scopeId = getNodeId(scopeRef);
    const node = nodes.get(scopeId);
    if (!node)
        return;
    addDomTarget(scopeId, element);
    if (label && node.label === "scope") {
        node.label = label;
    }
}
export function disposeScope(scopeRef) {
    markDisposed(scopeRef);
}
export function registerSignal(signalRef, type, options) {
    if (!enabled)
        return;
    createNode(signalRef, type, type, {
        scopeRef: options?.scopeRef ?? null,
        initialValue: options?.initialValue,
    });
}
export function registerEffect(effectRef, type, scopeRef) {
    if (!enabled)
        return;
    const id = createNode(effectRef, type, type, {
        scopeRef,
    });
    if (currentDomTarget) {
        addDomTarget(id, currentDomTarget);
    }
}
export function aliasEffectToNode(effectRef, targetRef) {
    if (!enabled)
        return;
    const targetId = getNodeId(targetRef);
    effectAliasToNodeId.set(effectRef, targetId);
}
export function linkSubscriberSetToSignal(subscriberSetRef, signalRef) {
    if (!enabled)
        return;
    subscriberSetToSignalId.set(subscriberSetRef, getNodeId(signalRef));
}
export function trackSignalRead(signalRef) {
    markRead(signalRef);
}
export function trackSignalWrite(signalRef, nextValue) {
    markWrite(signalRef, nextValue);
}
export function trackEffectRun(effectRef) {
    markRun(effectRef);
}
export function trackEffectDispose(effectRef) {
    markDisposed(effectRef);
}
export function trackDependency(signalRef, effectRef) {
    if (!enabled)
        return;
    const from = getNodeId(signalRef);
    const to = getNodeId(effectRef);
    if (!nodes.has(from) || !nodes.has(to))
        return;
    upsertDependencyEdge(from, to);
}
export function untrackDependencyBySet(subscriberSetRef, effectRef) {
    if (!enabled)
        return;
    const from = subscriberSetToSignalId.get(subscriberSetRef);
    if (!from)
        return;
    const to = getNodeId(effectRef);
    removeDependencyEdge(from, to);
}
export function clearHighlights() {
    if (!canUseDOM())
        return;
    for (const targets of nodeDomTargets.values()) {
        for (const element of targets) {
            clearHighlightOnElement(element);
        }
    }
}
export function highlightNode(nodeId, options = {}) {
    if (!enabled || !canUseDOM())
        return false;
    const targets = resolveNodeDomTargets(nodeId);
    if (targets.length === 0)
        return false;
    ensureHighlightStyle();
    const node = nodes.get(nodeId);
    const label = node ? `#${node.id} ${node.label || node.type}` : `#${nodeId}`;
    const durationMs = typeof options.durationMs === "number" && Number.isFinite(options.durationMs) && options.durationMs > 0
        ? Math.floor(options.durationMs)
        : 650;
    for (const element of targets) {
        clearHighlightOnElement(element);
        element.setAttribute(HIGHLIGHT_ATTR, "1");
        element.setAttribute(HIGHLIGHT_LABEL_ATTR, label);
        if (typeof globalThis.setTimeout === "function") {
            const timer = globalThis.setTimeout(() => {
                clearHighlightOnElement(element);
            }, durationMs);
            highlightTimers.set(element, timer);
        }
    }
    return true;
}
