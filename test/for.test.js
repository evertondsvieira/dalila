import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import { signal, effect } from '../dist/core/signal.js';
import { createScope, withScope } from '../dist/core/scope.js';
import { setDevMode, isInDevMode } from '../dist/core/dev.js';
import { createList, forEach } from '../dist/core/for.js';

// More robust than a single Promise.resolve() because Dalila may schedule >1 microtask.
const flush = async (ticks = 4) => {
  for (let i = 0; i < ticks; i++) {
    // cover both promise-microtasks and explicit queueMicrotask scheduling
    await Promise.resolve();
    await new Promise((r) => queueMicrotask(r));
  }
};

describe('List Rendering (for)', () => {
  let dom;
  let document;

  beforeEach(() => {
    dom = new JSDOM('<!DOCTYPE html><body></body>', { pretendToBeVisual: true });
    document = dom.window.document;

    globalThis.document = document;
    globalThis.Node = dom.window.Node;
    globalThis.Comment = dom.window.Comment;
    globalThis.DocumentFragment = dom.window.DocumentFragment;
    globalThis.HTMLElement = dom.window.HTMLElement;
  });

  afterEach(() => {
    // cleanup globals to avoid cross-test leakage
    delete globalThis.document;
    delete globalThis.Node;
    delete globalThis.Comment;
    delete globalThis.DocumentFragment;
    delete globalThis.HTMLElement;

    dom?.window?.close?.();
    dom = null;
    document = null;
  });

  describe('createList()', () => {
    it('should render initial list', async () => {
      const scope = createScope();

      await withScope(scope, async () => {
        const items = signal([
          { id: 1, text: 'Item 1' },
          { id: 2, text: 'Item 2' },
          { id: 3, text: 'Item 3' }
        ]);

        const fragment = createList(
          () => items(),
          (item) => {
            const div = document.createElement('div');
            div.textContent = item.text;
            div.setAttribute('data-id', String(item.id));
            return div;
          },
          (item) => item.id.toString()
        );

        const container = document.createElement('div');
        document.body.appendChild(container);
        container.appendChild(fragment);

        await flush();

        const divs = container.querySelectorAll('div');
        assert.strictEqual(divs.length, 3);
        assert.strictEqual(divs[0].textContent, 'Item 1');
        assert.strictEqual(divs[1].textContent, 'Item 2');
        assert.strictEqual(divs[2].textContent, 'Item 3');

        container.remove();
      });

      scope.dispose();
    });

    it('should add new items', async () => {
      const scope = createScope();

      await withScope(scope, async () => {
        const items = signal([{ id: 1, text: 'Item 1' }]);

        const fragment = createList(
          () => items(),
          (item) => {
            const div = document.createElement('div');
            div.textContent = item.text;
            return div;
          },
          (item) => item.id.toString()
        );

        const container = document.createElement('div');
        document.body.appendChild(container);
        container.appendChild(fragment);

        await flush();

        items.set([
          { id: 1, text: 'Item 1' },
          { id: 2, text: 'Item 2' }
        ]);

        await flush();

        const divs = container.querySelectorAll('div');
        assert.strictEqual(divs.length, 2);
        assert.strictEqual(divs[0].textContent, 'Item 1');
        assert.strictEqual(divs[1].textContent, 'Item 2');

        container.remove();
      });

      scope.dispose();
    });

    it('should remove items', async () => {
      const scope = createScope();

      await withScope(scope, async () => {
        const items = signal([
          { id: 1, text: 'Item 1' },
          { id: 2, text: 'Item 2' },
          { id: 3, text: 'Item 3' }
        ]);

        const fragment = createList(
          () => items(),
          (item) => {
            const div = document.createElement('div');
            div.textContent = item.text;
            return div;
          },
          (item) => item.id.toString()
        );

        const container = document.createElement('div');
        document.body.appendChild(container);
        container.appendChild(fragment);

        await flush();

        items.set([
          { id: 1, text: 'Item 1' },
          { id: 3, text: 'Item 3' }
        ]);

        await flush();

        const divs = container.querySelectorAll('div');
        assert.strictEqual(divs.length, 2);
        assert.strictEqual(divs[0].textContent, 'Item 1');
        assert.strictEqual(divs[1].textContent, 'Item 3');

        container.remove();
      });

      scope.dispose();
    });

    it('should reorder items without re-rendering', async () => {
      const scope = createScope();
      let renderCount = 0;

      await withScope(scope, async () => {
        const item1 = { id: 1, text: 'Item 1' };
        const item2 = { id: 2, text: 'Item 2' };
        const item3 = { id: 3, text: 'Item 3' };

        const items = signal([item1, item2, item3]);

        const fragment = createList(
          () => items(),
          (item) => {
            renderCount++;
            const div = document.createElement('div');
            div.textContent = item.text;
            div.setAttribute('data-id', String(item.id));
            return div;
          },
          (item) => item.id.toString()
        );

        const container = document.createElement('div');
        document.body.appendChild(container);
        container.appendChild(fragment);

        await flush();

        const initialDivs = Array.from(container.querySelectorAll('div'));
        const initialRenderCount = renderCount;

        items.set([item3, item2, item1]);
        await flush();

        const newDivs = Array.from(container.querySelectorAll('div'));

        assert.strictEqual(renderCount, initialRenderCount);
        assert.strictEqual(newDivs[0].textContent, 'Item 3');
        assert.strictEqual(newDivs[1].textContent, 'Item 2');
        assert.strictEqual(newDivs[2].textContent, 'Item 1');

        assert.strictEqual(newDivs[0], initialDivs[2]);
        assert.strictEqual(newDivs[1], initialDivs[1]);
        assert.strictEqual(newDivs[2], initialDivs[0]);

        container.remove();
      });

      scope.dispose();
    });

    it('should update changed items', async () => {
      const scope = createScope();

      await withScope(scope, async () => {
        const items = signal([
          { id: 1, text: 'Item 1' },
          { id: 2, text: 'Item 2' }
        ]);

        const fragment = createList(
          () => items(),
          (item) => {
            const div = document.createElement('div');
            div.textContent = item.text;
            return div;
          },
          (item) => item.id.toString()
        );

        const container = document.createElement('div');
        document.body.appendChild(container);
        container.appendChild(fragment);

        await flush();

        items.set([
          { id: 1, text: 'Item 1' },
          { id: 2, text: 'Updated Item 2' }
        ]);

        await flush();

        const divs = container.querySelectorAll('div');
        assert.strictEqual(divs.length, 2);
        assert.strictEqual(divs[0].textContent, 'Item 1');
        assert.strictEqual(divs[1].textContent, 'Updated Item 2');

        container.remove();
      });

      scope.dispose();
    });

    it('should handle empty array', async () => {
      const scope = createScope();

      await withScope(scope, async () => {
        const items = signal([]);

        const fragment = createList(
          () => items(),
          // not called when empty
          (item) => {
            const div = document.createElement('div');
            div.textContent = item.text;
            return div;
          },
          (item) => item.id.toString()
        );

        const container = document.createElement('div');
        document.body.appendChild(container);
        container.appendChild(fragment);

        await flush();

        const divs = container.querySelectorAll('div');
        assert.strictEqual(divs.length, 0);

        container.remove();
      });

      scope.dispose();
    });

    it('should transition from empty to non-empty', async () => {
      const scope = createScope();

      await withScope(scope, async () => {
        const items = signal([]);

        const fragment = createList(
          () => items(),
          (item) => {
            const div = document.createElement('div');
            div.textContent = item.text;
            return div;
          },
          (item) => item.id.toString()
        );

        const container = document.createElement('div');
        document.body.appendChild(container);
        container.appendChild(fragment);

        await flush();

        items.set([
          { id: 1, text: 'Item 1' },
          { id: 2, text: 'Item 2' }
        ]);

        await flush();

        const divs = container.querySelectorAll('div');
        assert.strictEqual(divs.length, 2);
        assert.strictEqual(divs[0].textContent, 'Item 1');
        assert.strictEqual(divs[1].textContent, 'Item 2');

        container.remove();
      });

      scope.dispose();
    });

    it('should transition from non-empty to empty', async () => {
      const scope = createScope();

      await withScope(scope, async () => {
        const items = signal([
          { id: 1, text: 'Item 1' },
          { id: 2, text: 'Item 2' }
        ]);

        const fragment = createList(
          () => items(),
          (item) => {
            const div = document.createElement('div');
            div.textContent = item.text;
            return div;
          },
          (item) => item.id.toString()
        );

        const container = document.createElement('div');
        document.body.appendChild(container);
        container.appendChild(fragment);

        await flush();

        items.set([]);
        await flush();

        const divs = container.querySelectorAll('div');
        assert.strictEqual(divs.length, 0);

        container.remove();
      });

      scope.dispose();
    });

    it('should provide reactive index', async () => {
      const scope = createScope();

      await withScope(scope, async () => {
        const items = signal([
          { id: 1, text: 'A' },
          { id: 2, text: 'B' }
        ]);

        const fragment = createList(
          () => items(),
          (item, index) => {
            const div = document.createElement('div');
            div.textContent = `${index}: ${item.text}`;
            return div;
          },
          (item) => item.id.toString()
        );

        const container = document.createElement('div');
        document.body.appendChild(container);
        container.appendChild(fragment);

        await flush();

        const divs = container.querySelectorAll('div');
        assert.strictEqual(divs[0].textContent, '0: A');
        assert.strictEqual(divs[1].textContent, '1: B');

        container.remove();
      });

      scope.dispose();
    });

    it('should handle complex updates (add, remove, reorder)', async () => {
      const scope = createScope();

      await withScope(scope, async () => {
        const items = signal([
          { id: 1, text: 'Item 1' },
          { id: 2, text: 'Item 2' },
          { id: 3, text: 'Item 3' }
        ]);

        const fragment = createList(
          () => items(),
          (item) => {
            const div = document.createElement('div');
            div.textContent = item.text;
            return div;
          },
          (item) => item.id.toString()
        );

        const container = document.createElement('div');
        document.body.appendChild(container);
        container.appendChild(fragment);

        await flush();

        items.set([
          { id: 3, text: 'Item 3' },
          { id: 4, text: 'Item 4' },
          { id: 1, text: 'Item 1' }
        ]);

        await flush();

        const divs = container.querySelectorAll('div');
        assert.strictEqual(divs.length, 3);
        assert.strictEqual(divs[0].textContent, 'Item 3');
        assert.strictEqual(divs[1].textContent, 'Item 4');
        assert.strictEqual(divs[2].textContent, 'Item 1');

        container.remove();
      });

      scope.dispose();
    });

    it('should handle items without keyFn (uses index)', async () => {
      const scope = createScope();

      await withScope(scope, async () => {
        const items = signal(['A', 'B', 'C']);

        const fragment = createList(
          () => items(),
          (item) => {
            const div = document.createElement('div');
            div.textContent = item;
            return div;
          }
          // no keyFn
        );

        const container = document.createElement('div');
        document.body.appendChild(container);
        container.appendChild(fragment);

        await flush();

        const divs = container.querySelectorAll('div');
        assert.strictEqual(divs.length, 3);
        assert.strictEqual(divs[0].textContent, 'A');
        assert.strictEqual(divs[1].textContent, 'B');
        assert.strictEqual(divs[2].textContent, 'C');

        container.remove();
      });

      scope.dispose();
    });
  });

  describe('forEach() - low level API', () => {
    it('should provide reactive index signal', async () => {
      const scope = createScope();

      await withScope(scope, async () => {
        const items = signal([
          { id: 1, text: 'A' },
          { id: 2, text: 'B' }
        ]);

        const fragment = forEach(
          () => items(),
          (item, index) => {
            const div = document.createElement('div');
            div.textContent = `${index()}: ${item.text}`;
            return div;
          },
          (item) => item.id.toString()
        );

        const container = document.createElement('div');
        container.appendChild(fragment);

        await flush();

        const divs = container.querySelectorAll('div');
        assert.strictEqual(divs[0].textContent, '0: A');
        assert.strictEqual(divs[1].textContent, '1: B');
      });

      scope.dispose();
    });

    it('should update reactive index without re-rendering on reorder', async () => {
      const scope = createScope();
      let renderCount = 0;

      await withScope(scope, async () => {
        const item1 = { id: 1, text: 'A' };
        const item2 = { id: 2, text: 'B' };
        const item3 = { id: 3, text: 'C' };

        const items = signal([item1, item2, item3]);

        const fragment = forEach(
          () => items(),
          (item, index) => {
            renderCount++;
            const div = document.createElement('div');
            div.setAttribute('data-id', String(item.id));

            const textNode = document.createTextNode('');
            div.appendChild(textNode);

            // created inside item's scope (because forEach renders withScope(item.scope))
            effect(() => {
              textNode.data = `${index()}: ${item.text}`;
            });

            return div;
          },
          (item) => item.id.toString()
        );

        const container = document.createElement('div');
        container.appendChild(fragment);

        await flush();

        const initialDivs = Array.from(container.querySelectorAll('div'));
        const initialRenderCount = renderCount;

        assert.strictEqual(initialDivs[0].textContent, '0: A');
        assert.strictEqual(initialDivs[1].textContent, '1: B');
        assert.strictEqual(initialDivs[2].textContent, '2: C');

        items.set([item3, item2, item1]);
        await flush();

        const newDivs = Array.from(container.querySelectorAll('div'));

        assert.strictEqual(renderCount, initialRenderCount, 'Should not re-render on reorder');

        assert.strictEqual(newDivs[0], initialDivs[2], 'First div should be the original third');
        assert.strictEqual(newDivs[1], initialDivs[1], 'Second div should be the original second');
        assert.strictEqual(newDivs[2], initialDivs[0], 'Third div should be the original first');

        assert.strictEqual(newDivs[0].textContent, '0: C');
        assert.strictEqual(newDivs[1].textContent, '1: B');
        assert.strictEqual(newDivs[2].textContent, '2: A');
      });

      scope.dispose();
    });

    it('should stop reacting when parent scope is disposed', async () => {
      const scope = createScope();

      const items = signal([
        { id: 1, text: 'A' },
        { id: 2, text: 'B' }
      ]);

      const container = document.createElement('div');
      document.body.appendChild(container);

      await withScope(scope, async () => {
        const fragment = forEach(
          () => items(),
          (item) => {
            const div = document.createElement('div');
            div.textContent = item.text;
            return div;
          },
          (item) => item.id.toString()
        );

        container.appendChild(fragment);
        await flush();

        assert.strictEqual(container.querySelectorAll('div').length, 2);
      });

      // dispose parent scope (should dispose forEach effect)
      scope.dispose();
      await flush();

      items.set([
        { id: 1, text: 'A' },
        { id: 2, text: 'B' },
        { id: 3, text: 'C' }
      ]);

      await flush();

      assert.strictEqual(
        container.querySelectorAll('div').length,
        0,
        'DOM should be cleared after scope disposal'
      );

      container.remove();
    });

    it('should throw on duplicate keys in dev mode', async () => {
      const prevMode = isInDevMode();
      setDevMode(true);

      const scope = createScope();
      try {
        await withScope(scope, async () => {
          const items = signal([
            { id: 1, text: 'A' },
            { id: 1, text: 'B' }, // duplicate
            { id: 2, text: 'C' }
          ]);

          let errorThrown = false;
          let errorMessage = '';

          try {
            const fragment = forEach(
              () => items(),
              (item) => {
                const div = document.createElement('div');
                div.textContent = item.text;
                return div;
              },
              (item) => item.id.toString()
            );

            const container = document.createElement('div');
            container.appendChild(fragment);
            await flush();
          } catch (err) {
            errorThrown = true;
            errorMessage = err?.message || String(err);
          }

          assert.ok(errorThrown, 'Should throw error for duplicate keys');
          assert.ok(errorMessage.includes('Duplicate key'), 'Error message should mention duplicate key');
          assert.ok(errorMessage.includes('"1"'), 'Error message should include the duplicate key value');
        });
      } finally {
        scope.dispose();
        setDevMode(prevMode);
      }
    });

    it('should ignore duplicate keys in production without crashing', async () => {
      const prevMode = isInDevMode();
      setDevMode(false);

      const scope = createScope();
      try {
        await withScope(scope, async () => {
          const items = signal([
            { id: 1, text: 'A' },
            { id: 1, text: 'B' }, // duplicate
            { id: 2, text: 'C' }
          ]);

          const fragment = forEach(
            () => items(),
            (item) => {
              const div = document.createElement('div');
              div.textContent = item.text;
              return div;
            },
            (item) => item.id.toString()
          );

          const container = document.createElement('div');
          container.appendChild(fragment);

          await flush();

          const divs = container.querySelectorAll('div');
          assert.strictEqual(divs.length, 2, 'Should render only unique keys in prod');
          assert.strictEqual(divs[0].textContent, 'A');
          assert.strictEqual(divs[1].textContent, 'C');
        });
      } finally {
        scope.dispose();
        setDevMode(prevMode);
      }
    });

    it('should warn when called outside scope in dev mode', async () => {
      const prevMode = isInDevMode();
      setDevMode(true);

      const warnings = [];
      const originalWarn = console.warn;
      console.warn = (msg) => warnings.push(String(msg));

      try {
        const items = signal([{ id: 1, text: 'A' }]);

        const fragment = forEach(
          () => items(),
          (item) => {
            const div = document.createElement('div');
            div.textContent = item.text;
            return div;
          },
          (item) => item.id.toString()
        );

        const container = document.createElement('div');
        container.appendChild(fragment);

        await flush();

        assert.ok(
          warnings.some((w) => w.includes('forEach() called outside of a scope')),
          'Should warn when forEach is called outside of a scope'
        );
      } finally {
        console.warn = originalWarn;
        setDevMode(prevMode);
      }
    });

    it('should support manual cleanup via fragment.dispose()', async () => {
      const items = signal([
        { id: 1, text: 'A' },
        { id: 2, text: 'B' }
      ]);

      const fragment = forEach(
        () => items(),
        (item) => {
          const div = document.createElement('div');
          div.textContent = item.text;
          return div;
        },
        (item) => item.id.toString()
      );

      const container = document.createElement('div');
      document.body.appendChild(container);
      container.appendChild(fragment);

      await flush();

      assert.strictEqual(container.querySelectorAll('div').length, 2);

      fragment.dispose();
      fragment.dispose(); // idempotent
      await flush();

      items.set([
        { id: 1, text: 'A' },
        { id: 2, text: 'B' },
        { id: 3, text: 'C' }
      ]);

      await flush();

      const finalDivCount = container.querySelectorAll('div').length;
      assert.strictEqual(finalDivCount, 0, 'DOM should be cleared after manual dispose');

      container.remove();
    });

    it('should auto-dispose when removed from the DOM outside a scope', async () => {
      const items = signal([
        { id: 1, text: 'A' },
        { id: 2, text: 'B' }
      ]);

      let renderCount = 0;

      const fragment = forEach(
        () => items(),
        (item) => {
          renderCount++;
          const div = document.createElement('div');
          div.textContent = item.text;
          return div;
        },
        (item) => item.id.toString()
      );

      const container = document.createElement('div');
      document.body.appendChild(container);
      container.appendChild(fragment);

      await flush();
      assert.strictEqual(renderCount, 2);

      container.remove();
      await flush();

      items.set([
        { id: 1, text: 'A' },
        { id: 2, text: 'B' },
        { id: 3, text: 'C' }
      ]);

      await flush();
      assert.strictEqual(renderCount, 2, 'Should not re-render after auto-dispose');
    });

    it('fragment.dispose() is safe when parent scope disposes again', async () => {
      const scope = createScope();
      const items = signal([
        { id: 1, text: 'X' },
        { id: 2, text: 'Y' }
      ]);

      const container = document.createElement('div');
      document.body.appendChild(container);
      let fragment;

      await withScope(scope, async () => {
        fragment = forEach(
          () => items(),
          (item) => {
            const div = document.createElement('div');
            div.textContent = item.text;
            return div;
          },
          (item) => item.id.toString()
        );

        container.appendChild(fragment);
        await flush();
      });

      fragment.dispose();
      scope.dispose(); // should not explode / double-dispose
      await flush();

      items.set([
        { id: 1, text: 'X' },
        { id: 2, text: 'Y' },
        { id: 3, text: 'Z' }
      ]);

      await flush();

      const divs = container.querySelectorAll('div');
      assert.strictEqual(divs.length, 0, 'DOM should remain cleared after dispose + scope cleanup');

      container.remove();
    });
  });
});
