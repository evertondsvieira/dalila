import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { createRouter } from '../dist/router/router.js';

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

async function withDom(urlPath, fn) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: `http://localhost${urlPath}`,
    pretendToBeVisual: true
  });

  const { window } = dom;

  (globalThis as any).window = window;
  (globalThis as any).document = window.document;
  (globalThis as any).history = window.history;
  (globalThis as any).location = window.location;
  (globalThis as any).Node = window.Node;
  (globalThis as any).Element = window.Element;
  (globalThis as any).HTMLElement = window.HTMLElement;
  (globalThis as any).NodeFilter = window.NodeFilter;
  (globalThis as any).DocumentFragment = window.DocumentFragment;
  (globalThis as any).MouseEvent = window.MouseEvent;
  (globalThis as any).requestAnimationFrame = window.requestAnimationFrame.bind(window);
  (globalThis as any).cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
  (globalThis as any).scrollTo = () => {};
  window.scrollTo = () => {};

  try {
    await fn();
  } finally {
    delete (globalThis as any).window;
    delete (globalThis as any).document;
    delete (globalThis as any).history;
    delete (globalThis as any).location;
    delete (globalThis as any).Node;
    delete (globalThis as any).Element;
    delete (globalThis as any).HTMLElement;
    delete (globalThis as any).NodeFilter;
    delete (globalThis as any).DocumentFragment;
    delete (globalThis as any).MouseEvent;
    delete (globalThis as any).requestAnimationFrame;
    delete (globalThis as any).cancelAnimationFrame;
    delete (globalThis as any).scrollTo;
  }
}

test('Router - redirect on start() keeps URL synchronized', { concurrency: false }, async () => {
  await withDom('/old', async () => {
    const outlet = document.createElement('main');
    document.body.appendChild(outlet);

    const router = createRouter({
      outlet,
      routes: [
        { path: '/old', redirect: '/new' },
        {
          path: '/new',
          view: () => {
            const el = document.createElement('div');
            el.textContent = 'new';
            return el;
          }
        }
      ]
    });

    router.start();
    await tick(20);

    assert.equal(window.location.pathname, '/new');
    assert.equal(router.route().path, '/new');
    assert.match(outlet.textContent ?? '', /new/);

    router.stop();
  });
});

test('Router - layout-only segment root does not keep stale DOM', { concurrency: false }, async () => {
  await withDom('/home', async () => {
    const outlet = document.createElement('main');
    document.body.appendChild(outlet);

    const router = createRouter({
      outlet,
      routes: [
        {
          path: '/home',
          view: () => {
            const el = document.createElement('div');
            el.textContent = 'home';
            return el;
          }
        },
        {
          path: '/dashboard',
          layout: (_ctx, children) => {
            const shell = document.createElement('section');
            shell.className = 'dashboard-shell';
            shell.append(...(Array.isArray(children) ? children : [children]));
            return shell;
          },
          children: [
            {
              path: 'users',
              view: () => {
                const el = document.createElement('div');
                el.textContent = 'users';
                return el;
              }
            }
          ]
        },
        {
          path: '*',
          view: () => {
            const el = document.createElement('div');
            el.textContent = 'fallback';
            return el;
          }
        }
      ]
    });

    router.start();
    await tick(20);
    assert.match(outlet.textContent ?? '', /home/);

    await router.navigate('/dashboard');
    await tick(20);

    assert.equal(router.route().path, '/dashboard');
    assert.match(outlet.textContent ?? '', /fallback/);
    assert.doesNotMatch(outlet.textContent ?? '', /home/);

    router.stop();
  });
});

test('Router - route lifecycle supports onRouteMount cleanup return and onRouteUnmount', { concurrency: false }, async () => {
  await withDom('/a', async () => {
    const outlet = document.createElement('main');
    document.body.appendChild(outlet);

    let mountCalls = 0;
    let cleanupCalls = 0;
    let unmountCalls = 0;

    const router = createRouter({
      outlet,
      routes: [
        {
          path: '/a',
          view: () => {
            const el = document.createElement('div');
            el.textContent = 'route-a';
            return el;
          },
          onRouteMount: () => {
            mountCalls += 1;
            return () => {
              cleanupCalls += 1;
            };
          },
          onRouteUnmount: () => {
            unmountCalls += 1;
          }
        },
        {
          path: '/b',
          view: () => {
            const el = document.createElement('div');
            el.textContent = 'route-b';
            return el;
          }
        }
      ]
    });

    router.start();
    await tick(20);

    assert.equal(mountCalls, 1);
    assert.equal(cleanupCalls, 0);
    assert.equal(unmountCalls, 0);

    await router.navigate('/b');
    await tick(20);

    assert.equal(cleanupCalls, 1);
    assert.equal(unmountCalls, 1);

    router.stop();
  });
});

test('Router - stop() triggers route lifecycle cleanup', { concurrency: false }, async () => {
  await withDom('/cleanup', async () => {
    const outlet = document.createElement('main');
    document.body.appendChild(outlet);

    let cleanupCalls = 0;
    let unmountCalls = 0;

    const router = createRouter({
      outlet,
      routes: [
        {
          path: '/cleanup',
          view: () => {
            const el = document.createElement('div');
            el.textContent = 'cleanup';
            return el;
          },
          onRouteMount: () => () => {
            cleanupCalls += 1;
          },
          onRouteUnmount: () => {
            unmountCalls += 1;
          }
        }
      ]
    });

    router.start();
    await tick(20);

    router.stop();

    assert.equal(cleanupCalls, 1);
    assert.equal(unmountCalls, 1);
  });
});

test('Router - guard redirect on start() updates location with replace semantics', { concurrency: false }, async () => {
  await withDom('/admin', async () => {
    const outlet = document.createElement('main');
    document.body.appendChild(outlet);

    const router = createRouter({
      outlet,
      routes: [
        {
          path: '/admin',
          guard: () => '/login',
          view: () => {
            const el = document.createElement('div');
            el.textContent = 'admin';
            return el;
          }
        },
        {
          path: '/login',
          view: () => {
            const el = document.createElement('div');
            el.textContent = 'login';
            return el;
          }
        }
      ]
    });

    const initialLength = window.history.length;
    router.start();
    await tick(20);

    assert.equal(window.location.pathname, '/login');
    assert.equal(router.route().path, '/login');
    assert.equal(window.history.length, initialLength);
    assert.match(outlet.textContent ?? '', /login/);

    router.stop();
  });
});

test('Router - query validation blocks invalid query params', { concurrency: false }, async () => {
  await withDom('/search?page=0', async () => {
    const outlet = document.createElement('main');
    document.body.appendChild(outlet);

    const router = createRouter({
      outlet,
      errorView: (_ctx, error) => {
        const el = document.createElement('div');
        el.textContent = String(error);
        return el;
      },
      routes: [
        {
          path: '/search',
          validation: {
            query: {
              page: ['required', 'min:1']
            }
          },
          view: () => {
            const el = document.createElement('div');
            el.textContent = 'search-ok';
            return el;
          }
        }
      ]
    });

    router.start();
    await tick(20);

    assert.equal(router.status().state, 'error');
    assert.match(outlet.textContent ?? '', /Invalid query param "page"/);
    assert.doesNotMatch(outlet.textContent ?? '', /search-ok/);

    router.stop();
  });
});

test('Router - query validation accepts valid query params', { concurrency: false }, async () => {
  await withDom('/search?page=2', async () => {
    const outlet = document.createElement('main');
    document.body.appendChild(outlet);

    let loadedPage = '';

    const router = createRouter({
      outlet,
      routes: [
        {
          path: '/search',
          validation: async () => ({
            query: {
              page: ['required', 'min:1']
            }
          }),
          loader: async (ctx) => {
            loadedPage = ctx.query.get('page') ?? '';
            return { loadedPage };
          },
          view: (_ctx, data) => {
            const el = document.createElement('div');
            el.textContent = `search-ok:${data.loadedPage}`;
            return el;
          }
        }
      ]
    });

    router.start();
    await tick(20);

    assert.equal(router.status().state, 'idle');
    assert.equal(loadedPage, '2');
    assert.match(outlet.textContent ?? '', /search-ok:2/);

    router.stop();
  });
});

test('Router - params validation blocks invalid route params', { concurrency: false }, async () => {
  await withDom('/users/0', async () => {
    const outlet = document.createElement('main');
    document.body.appendChild(outlet);

    let loadedId = '';

    const router = createRouter({
      outlet,
      errorView: (_ctx, error) => {
        const el = document.createElement('div');
        el.textContent = String(error);
        return el;
      },
      routes: [
        {
          path: '/users/:id',
          validation: {
            params: {
              id: ['required', 'min:1']
            }
          },
          loader: async (ctx) => {
            loadedId = String(ctx.params.id);
            return { loadedId };
          },
          view: (_ctx, data) => {
            const el = document.createElement('div');
            el.textContent = `user:${data.loadedId}`;
            return el;
          }
        }
      ]
    });

    router.start();
    await tick(20);

    assert.equal(router.status().state, 'error');
    assert.match(outlet.textContent ?? '', /Invalid route param "id"/);
    assert.equal(loadedId, '');

    router.stop();
  });
});

test('Router - invalidateByTag evicts matching preload entries', { concurrency: false }, async () => {
  await withDom('/home', async () => {
    const outlet = document.createElement('main');
    document.body.appendChild(outlet);

    let preloadRuns = 0;

    const router = createRouter({
      outlet,
      routes: [
        {
          path: '/home',
          view: () => {
            const el = document.createElement('div');
            el.textContent = 'home';
            return el;
          }
        },
        {
          path: '/users',
          tags: ['users'],
          preload: async () => {
            preloadRuns += 1;
            return { preloadRuns };
          },
          view: () => {
            const el = document.createElement('div');
            el.textContent = 'users';
            return el;
          }
        }
      ]
    });

    router.start();
    await tick(20);

    router.preload('/users');
    await tick(20);
    router.preload('/users');
    await tick(20);

    assert.equal(preloadRuns, 1);

    router.invalidateByTag('users');
    router.preload('/users');
    await tick(20);

    assert.equal(preloadRuns, 2);

    router.stop();
  });
});

test('Router - route middleware pipeline can redirect before guard', { concurrency: false }, async () => {
  await withDom('/admin', async () => {
    const outlet = document.createElement('main');
    document.body.appendChild(outlet);

    const middlewareCalls = [];

    const router = createRouter({
      outlet,
      routes: [
        {
          path: '/admin',
          middleware: async () => [
            () => {
              middlewareCalls.push('audit');
              return true;
            },
            () => {
              middlewareCalls.push('auth');
              return '/login';
            }
          ],
          guard: () => {
            middlewareCalls.push('guard');
            return true;
          },
          view: () => {
            const el = document.createElement('div');
            el.textContent = 'admin';
            return el;
          }
        },
        {
          path: '/login',
          view: () => {
            const el = document.createElement('div');
            el.textContent = 'login';
            return el;
          }
        }
      ]
    });

    router.start();
    await tick(20);

    assert.deepEqual(middlewareCalls, ['audit', 'auth']);
    assert.equal(router.route().path, '/login');
    assert.match(outlet.textContent ?? '', /login/);

    router.stop();
  });
});

test('Router - global middleware can redirect before route middleware', { concurrency: false }, async () => {
  await withDom('/admin', async () => {
    const outlet = document.createElement('main');
    document.body.appendChild(outlet);

    const calls = [];

    const router = createRouter({
      outlet,
      globalMiddleware: [
        (ctx) => {
          calls.push(`global:${ctx.path}`);
          if (ctx.path === '/admin') {
            return '/login';
          }
          return true;
        }
      ],
      routes: [
        {
          path: '/admin',
          middleware: [
            () => {
              calls.push('route-middleware');
              return true;
            }
          ],
          guard: () => {
            calls.push('guard');
            return true;
          },
          view: () => {
            const el = document.createElement('div');
            el.textContent = 'admin';
            return el;
          }
        },
        {
          path: '/login',
          view: () => {
            const el = document.createElement('div');
            el.textContent = 'login';
            return el;
          }
        }
      ]
    });

    router.start();
    await tick(20);

    assert.deepEqual(calls, ['global:/admin', 'global:/login']);
    assert.equal(router.route().path, '/login');
    assert.match(outlet.textContent ?? '', /login/);

    router.stop();
  });
});

test('Router - invalidateWhere evicts preload entries by predicate', { concurrency: false }, async () => {
  await withDom('/home', async () => {
    const outlet = document.createElement('main');
    document.body.appendChild(outlet);

    const preloadRuns = new Map();

    const router = createRouter({
      outlet,
      routes: [
        {
          path: '/home',
          view: () => {
            const el = document.createElement('div');
            el.textContent = 'home';
            return el;
          }
        },
        {
          path: '/users/:id',
          tags: ['users'],
          preload: async (ctx) => {
            const id = String(ctx.params.id);
            const next = (preloadRuns.get(id) ?? 0) + 1;
            preloadRuns.set(id, next);
            return { id, run: next };
          },
          view: () => {
            const el = document.createElement('div');
            el.textContent = 'users';
            return el;
          }
        }
      ]
    });

    router.start();
    await tick(20);

    router.preload('/users/123');
    router.preload('/users/456');
    await tick(20);

    router.invalidateWhere((entry) => entry.routePath === '/users/:id' && entry.params.id === '123');

    router.preload('/users/123');
    router.preload('/users/456');
    await tick(20);

    assert.equal(preloadRuns.get('123'), 2);
    assert.equal(preloadRuns.get('456'), 1);

    router.stop();
  });
});

test('Router - coalesces simultaneous navigate calls to the same route', { concurrency: false }, async () => {
  await withDom('/home', async () => {
    const outlet = document.createElement('main');
    document.body.appendChild(outlet);

    let loaderRuns = 0;

    const router = createRouter({
      outlet,
      routes: [
        {
          path: '/home',
          view: () => {
            const el = document.createElement('div');
            el.textContent = 'home';
            return el;
          }
        },
        {
          path: '/data',
          loader: async () => {
            loaderRuns += 1;
            await tick(30);
            return { loaderRuns };
          },
          view: (_ctx, data) => {
            const el = document.createElement('div');
            el.textContent = `data:${data.loaderRuns}`;
            return el;
          }
        }
      ]
    });

    router.start();
    await tick(20);

    const navigationA = router.navigate('/data');
    const navigationB = router.navigate('/data');
    await Promise.all([navigationA, navigationB]);
    await tick(20);

    assert.equal(loaderRuns, 1);
    assert.equal(router.route().path, '/data');
    assert.match(outlet.textContent ?? '', /data:1/);

    router.stop();
  });
});

test('Router - prefetchByTag preloads only matching tagged routes', { concurrency: false }, async () => {
  await withDom('/home', async () => {
    const outlet = document.createElement('main');
    document.body.appendChild(outlet);

    let criticalRuns = 0;
    let miscRuns = 0;

    const router = createRouter({
      outlet,
      routes: [
        {
          path: '/home',
          view: () => {
            const el = document.createElement('div');
            el.textContent = 'home';
            return el;
          }
        },
        {
          path: '/critical',
          tags: ['critical'],
          preload: async () => {
            criticalRuns += 1;
            return { criticalRuns };
          },
          view: () => {
            const el = document.createElement('div');
            el.textContent = 'critical';
            return el;
          }
        },
        {
          path: '/misc',
          tags: ['misc'],
          preload: async () => {
            miscRuns += 1;
            return { miscRuns };
          },
          view: () => {
            const el = document.createElement('div');
            el.textContent = 'misc';
            return el;
          }
        }
      ]
    });

    router.start();
    await tick(20);

    await router.prefetchByTag('critical');

    assert.equal(criticalRuns, 1);
    assert.equal(miscRuns, 0);

    router.preload('/critical');
    await tick(20);
    assert.equal(criticalRuns, 1);

    router.stop();
  });
});

test('Router - prefetchByScore preloads only routes above threshold', { concurrency: false }, async () => {
  await withDom('/home', async () => {
    const outlet = document.createElement('main');
    document.body.appendChild(outlet);

    let highRuns = 0;
    let lowRuns = 0;

    const router = createRouter({
      outlet,
      routes: [
        {
          path: '/home',
          view: () => {
            const el = document.createElement('div');
            el.textContent = 'home';
            return el;
          }
        },
        {
          path: '/high-priority',
          score: 900,
          preload: async () => {
            highRuns += 1;
            return { highRuns };
          },
          view: () => {
            const el = document.createElement('div');
            el.textContent = 'high';
            return el;
          }
        },
        {
          path: '/low-priority',
          score: 200,
          preload: async () => {
            lowRuns += 1;
            return { lowRuns };
          },
          view: () => {
            const el = document.createElement('div');
            el.textContent = 'low';
            return el;
          }
        }
      ]
    });

    router.start();
    await tick(20);

    await router.prefetchByScore(500);

    assert.equal(highRuns, 1);
    assert.equal(lowRuns, 0);

    router.stop();
  });
});

test('Router - manifest load failure sets error state and renders error view', { concurrency: false }, async () => {
  await withDom('/home', async () => {
    const outlet = document.createElement('main');
    document.body.appendChild(outlet);

    let onErrorCalls = 0;
    let errorViewScopeDisposed = false;
    const capturedErrors = [];

    const router = createRouter({
      outlet,
      routeManifest: [
        {
          id: 'broken-route',
          pattern: '/broken',
          score: 999,
          paramKeys: [],
          tags: [],
          modules: ['./broken.js'],
          load: async () => {
            throw new Error('missing chunk');
          }
        }
      ],
      hooks: {
        onError: (error) => {
          onErrorCalls += 1;
          capturedErrors.push(String(error));
        }
      },
      errorView: (_ctx, error) => {
        _ctx.scope.onCleanup(() => {
          errorViewScopeDisposed = true;
        });
        const el = document.createElement('div');
        el.textContent = `error:${String(error)}`;
        return el;
      },
      routes: [
        {
          path: '/home',
          view: () => {
            const el = document.createElement('div');
            el.textContent = 'home';
            return el;
          }
        },
        {
          path: '/broken',
          view: () => {
            const el = document.createElement('div');
            el.textContent = 'broken';
            return el;
          }
        }
      ]
    });

    router.start();
    await tick(20);
    await router.navigate('/broken');
    await tick(20);

    assert.equal(router.status().state, 'error');
    assert.equal(router.route().path, '/home');
    assert.match(outlet.textContent ?? '', /error:Error: missing chunk/);
    assert.equal(onErrorCalls, 1);
    assert.match(capturedErrors[0] ?? '', /missing chunk/);
    assert.equal(errorViewScopeDisposed, false);

    router.stop();
    assert.equal(errorViewScopeDisposed, true);
  });
});
