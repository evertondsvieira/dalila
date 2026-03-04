export function bindIfDirective(root, ctx, cleanups, transitionRegistry, deps) {
    const elements = deps.qsaIncludingRoot(root, '[d-if]');
    for (const el of elements) {
        const bindingName = deps.normalizeBinding(el.getAttribute('d-if'));
        if (!bindingName)
            continue;
        const binding = ctx[bindingName];
        if (binding === undefined) {
            deps.warn(`d-if: "${bindingName}" not found in context`);
            continue;
        }
        const elseEl = el.nextElementSibling?.hasAttribute('d-else') ? el.nextElementSibling : null;
        const comment = document.createComment('d-if');
        el.parentNode?.replaceChild(comment, el);
        el.removeAttribute('d-if');
        const htmlEl = el;
        const transitions = deps.createTransitionController(htmlEl, transitionRegistry, cleanups);
        let elseHtmlEl = null;
        let elseComment = null;
        let elseTransitions = null;
        if (elseEl) {
            elseComment = document.createComment('d-else');
            elseEl.parentNode?.replaceChild(elseComment, elseEl);
            elseEl.removeAttribute('d-else');
            elseHtmlEl = elseEl;
            elseTransitions = deps.createTransitionController(elseHtmlEl, transitionRegistry, cleanups);
        }
        const initialValue = !!deps.resolve(binding);
        if (initialValue) {
            comment.parentNode?.insertBefore(htmlEl, comment);
            deps.syncPortalElement(htmlEl);
            if (transitions.hasTransition) {
                htmlEl.removeAttribute('data-leave');
                htmlEl.setAttribute('data-enter', '');
            }
        }
        else if (elseHtmlEl && elseComment) {
            elseComment.parentNode?.insertBefore(elseHtmlEl, elseComment);
            deps.syncPortalElement(elseHtmlEl);
            if (elseTransitions?.hasTransition) {
                elseHtmlEl.removeAttribute('data-leave');
                elseHtmlEl.setAttribute('data-enter', '');
            }
        }
        if (elseHtmlEl && elseComment) {
            const capturedElseEl = elseHtmlEl;
            const capturedElseComment = elseComment;
            deps.bindEffect(htmlEl, () => {
                const value = !!deps.resolve(binding);
                if (value) {
                    if (!htmlEl.parentNode) {
                        comment.parentNode?.insertBefore(htmlEl, comment);
                        deps.syncPortalElement(htmlEl);
                    }
                    transitions.enter();
                    elseTransitions?.leave(() => {
                        if (capturedElseEl.parentNode) {
                            capturedElseEl.parentNode.removeChild(capturedElseEl);
                        }
                    });
                }
                else {
                    transitions.leave(() => {
                        if (htmlEl.parentNode) {
                            htmlEl.parentNode.removeChild(htmlEl);
                        }
                    });
                    if (!capturedElseEl.parentNode) {
                        capturedElseComment.parentNode?.insertBefore(capturedElseEl, capturedElseComment);
                        deps.syncPortalElement(capturedElseEl);
                    }
                    elseTransitions?.enter();
                }
            });
        }
        else {
            deps.bindEffect(htmlEl, () => {
                const value = !!deps.resolve(binding);
                if (value) {
                    if (!htmlEl.parentNode) {
                        comment.parentNode?.insertBefore(htmlEl, comment);
                        deps.syncPortalElement(htmlEl);
                    }
                    transitions.enter();
                }
                else {
                    transitions.leave(() => {
                        if (htmlEl.parentNode) {
                            htmlEl.parentNode.removeChild(htmlEl);
                        }
                    });
                }
            });
        }
    }
}
