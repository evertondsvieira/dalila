const portalSyncByElement = new WeakMap();
export function syncPortalElement(el) {
    const sync = portalSyncByElement.get(el);
    sync?.();
}
export function bindPortalDirective(root, ctx, cleanups, deps) {
    const elements = deps.qsaIncludingRoot(root, '[d-portal]');
    for (const el of elements) {
        const rawExpression = el.getAttribute('d-portal')?.trim();
        if (!rawExpression)
            continue;
        let expressionAst = null;
        let fallbackSelector = null;
        try {
            expressionAst = deps.parseExpression(rawExpression);
        }
        catch {
            // Allow selector shorthand: d-portal="#modal-root"
            fallbackSelector = rawExpression;
        }
        const htmlEl = el;
        const anchor = document.createComment('d-portal');
        htmlEl.parentNode?.insertBefore(anchor, htmlEl);
        const coerceTarget = (value) => {
            const resolved = deps.resolve(value);
            if (resolved == null || resolved === false)
                return null;
            if (typeof resolved === 'string') {
                const selector = resolved.trim();
                if (!selector)
                    return null;
                if (typeof document === 'undefined')
                    return null;
                const target = document.querySelector(selector);
                if (!target) {
                    deps.warn(`d-portal: target "${selector}" not found`);
                    return null;
                }
                return target;
            }
            if (typeof Element !== 'undefined' && resolved instanceof Element) {
                return resolved;
            }
            deps.warn('d-portal: expression must resolve to selector string, Element, or null');
            return null;
        };
        const restoreToAnchor = () => {
            const hostParent = anchor.parentNode;
            if (!hostParent)
                return;
            if (htmlEl.parentNode === hostParent)
                return;
            const next = anchor.nextSibling;
            if (next)
                hostParent.insertBefore(htmlEl, next);
            else
                hostParent.appendChild(htmlEl);
        };
        const syncPortal = () => {
            let target = null;
            if (expressionAst) {
                const result = deps.evalExpressionAst(expressionAst, ctx);
                if (!result.ok) {
                    if (result.reason === 'missing_identifier') {
                        deps.warn(`d-portal: ${result.message}`);
                    }
                    else {
                        deps.warn(`d-portal: invalid expression "${rawExpression}"`);
                    }
                    target = null;
                }
                else {
                    target = coerceTarget(result.value);
                }
            }
            else {
                target = coerceTarget(fallbackSelector);
            }
            if (!target) {
                restoreToAnchor();
                return;
            }
            if (htmlEl.parentNode !== target) {
                target.appendChild(htmlEl);
            }
        };
        portalSyncByElement.set(htmlEl, syncPortal);
        deps.bindEffect(htmlEl, syncPortal);
        cleanups.push(() => {
            portalSyncByElement.delete(htmlEl);
            restoreToAnchor();
            anchor.remove();
        });
    }
}
