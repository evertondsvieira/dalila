import { getLazyComponent, observeLazyElement } from './lazy.js';
import { setElementInnerHTML } from './html-sinks.js';
export function bindLazyDirective(root, ctx, cleanups, refs, events, options, deps) {
    const elements = deps.qsaIncludingRoot(root, '[d-lazy]');
    for (const el of elements) {
        const lazyComponentName = deps.normalizeBinding(el.getAttribute('d-lazy'));
        if (!lazyComponentName)
            continue;
        const lazyResult = getLazyComponent(lazyComponentName);
        if (!lazyResult) {
            deps.warn(`d-lazy: component "${lazyComponentName}" not found. Use createLazyComponent() to create it.`);
            continue;
        }
        const { state } = lazyResult;
        const htmlEl = el;
        const loadingTemplate = el.getAttribute('d-lazy-loading') ?? state.loadingTemplate ?? '';
        const errorTemplate = el.getAttribute('d-lazy-error') ?? state.errorTemplate ?? '';
        el.removeAttribute('d-lazy');
        el.removeAttribute('d-lazy-loading');
        el.removeAttribute('d-lazy-error');
        let currentNode = htmlEl;
        let componentMounted = false;
        let componentDispose = null;
        let componentEl = null;
        let hasIntersected = false;
        const refName = deps.normalizeBinding(htmlEl.getAttribute('d-ref'));
        const syncRef = (node) => {
            if (!refName)
                return;
            if (node instanceof Element) {
                refs.set(refName, node);
            }
        };
        const replaceCurrentNode = (nextNode) => {
            const parent = currentNode.parentNode;
            if (!parent)
                return;
            parent.replaceChild(nextNode, currentNode);
            currentNode = nextNode;
            syncRef(nextNode);
        };
        const unmountComponent = () => {
            if (componentDispose) {
                componentDispose();
                componentDispose = null;
            }
            componentMounted = false;
            componentEl = null;
        };
        const renderComponent = () => {
            const comp = state.component();
            if (!comp)
                return;
            const compDef = comp.definition;
            const compEl = document.createElement(compDef.tag);
            for (const attr of Array.from(htmlEl.attributes)) {
                if (!attr.name.startsWith('d-')) {
                    compEl.setAttribute(attr.name, attr.value);
                }
            }
            if (componentMounted && componentEl === compEl)
                return;
            replaceCurrentNode(compEl);
            componentEl = compEl;
            const parentCtx = Object.create(ctx);
            const parent = compEl.parentNode;
            const nextSibling = compEl.nextSibling;
            componentDispose = deps.bind(compEl, parentCtx, {
                components: { [compDef.tag]: comp },
                events,
                _skipLifecycle: true,
                ...deps.inheritNestedBindOptions(options, {}),
            });
            if (!compEl.isConnected && parent) {
                const renderedNode = nextSibling ? nextSibling.previousSibling : parent.lastChild;
                if (renderedNode instanceof Node) {
                    currentNode = renderedNode;
                    syncRef(renderedNode);
                }
            }
            componentMounted = true;
        };
        const showLoading = () => {
            if (loadingTemplate) {
                if (componentMounted) {
                    unmountComponent();
                }
                const loadingEl = document.createElement('div');
                deps.warnRawHtmlSinkHeuristic('d-lazy-loading', lazyComponentName, loadingTemplate);
                setElementInnerHTML(loadingEl, loadingTemplate, deps.resolveSecurityOptions(options));
                replaceCurrentNode(loadingEl);
            }
        };
        const showError = (err) => {
            if (componentMounted) {
                unmountComponent();
            }
            if (errorTemplate) {
                const errorEl = document.createElement('div');
                deps.warnRawHtmlSinkHeuristic('d-lazy-error', lazyComponentName, errorTemplate);
                setElementInnerHTML(errorEl, errorTemplate, deps.resolveSecurityOptions(options));
                replaceCurrentNode(errorEl);
            }
            else {
                deps.warn(`d-lazy: failed to load "${lazyComponentName}": ${err.message}`);
            }
        };
        const syncFromState = () => {
            const loading = state.loading();
            const error = state.error();
            const comp = state.component();
            if (!hasIntersected)
                return;
            if (error) {
                showError(error);
                return;
            }
            if (loading && !comp) {
                showLoading();
                return;
            }
            if (comp && !componentMounted) {
                renderComponent();
            }
        };
        deps.bindEffect(htmlEl, () => {
            syncFromState();
        });
        const cleanupObserver = observeLazyElement(htmlEl, () => {
            hasIntersected = true;
            syncFromState();
            state.load();
        }, 0);
        cleanups.push(() => {
            cleanupObserver();
            unmountComponent();
        });
    }
}
