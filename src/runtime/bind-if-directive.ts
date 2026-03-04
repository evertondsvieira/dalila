import type { BindContext, DisposeFunction, TransitionConfig } from './bind.js';

type TransitionRegistry = Map<string, TransitionConfig>;

interface TransitionController {
  hasTransition: boolean;
  enter: () => void;
  leave: (onDone: () => void) => void;
}

interface BindIfDirectiveDeps {
  qsaIncludingRoot: (root: Element, selector: string) => Element[];
  normalizeBinding: (raw: string | null) => string | null;
  warn: (message: string) => void;
  resolve: (value: unknown) => unknown;
  bindEffect: (target: Element | null | undefined, fn: () => void) => void;
  createTransitionController: (
    el: HTMLElement,
    registry: TransitionRegistry,
    cleanups: DisposeFunction[]
  ) => TransitionController;
  syncPortalElement: (el: HTMLElement) => void;
}

export function bindIfDirective(
  root: Element,
  ctx: BindContext,
  cleanups: DisposeFunction[],
  transitionRegistry: TransitionRegistry,
  deps: BindIfDirectiveDeps
): void {
  const elements = deps.qsaIncludingRoot(root, '[d-if]');

  for (const el of elements) {
    const bindingName = deps.normalizeBinding(el.getAttribute('d-if'));
    if (!bindingName) continue;

    const binding = ctx[bindingName];
    if (binding === undefined) {
      deps.warn(`d-if: "${bindingName}" not found in context`);
      continue;
    }

    const elseEl = el.nextElementSibling?.hasAttribute('d-else') ? el.nextElementSibling : null;

    const comment = document.createComment('d-if');
    el.parentNode?.replaceChild(comment, el);
    el.removeAttribute('d-if');

    const htmlEl = el as HTMLElement;
    const transitions = deps.createTransitionController(htmlEl, transitionRegistry, cleanups);

    let elseHtmlEl: HTMLElement | null = null;
    let elseComment: Comment | null = null;
    let elseTransitions: TransitionController | null = null;
    if (elseEl) {
      elseComment = document.createComment('d-else');
      elseEl.parentNode?.replaceChild(elseComment, elseEl);
      elseEl.removeAttribute('d-else');
      elseHtmlEl = elseEl as HTMLElement;
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
    } else if (elseHtmlEl && elseComment) {
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
        } else {
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
    } else {
      deps.bindEffect(htmlEl, () => {
        const value = !!deps.resolve(binding);
        if (value) {
          if (!htmlEl.parentNode) {
            comment.parentNode?.insertBefore(htmlEl, comment);
            deps.syncPortalElement(htmlEl);
          }
          transitions.enter();
        } else {
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
