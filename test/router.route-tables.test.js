import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compileRoutes,
  findCompiledRouteStackResult
} from '../dist/router/route-tables.js';

function findCompiledStackResult(pathname, routes) {
  return findCompiledRouteStackResult(pathname, compileRoutes(routes));
}

function findCompiledExactLeaf(pathname, routes) {
  const result = findCompiledStackResult(pathname, routes);
  if (!result?.exact) return null;
  return result.stack[result.stack.length - 1] ?? null;
}

test('RouteTables - root nested routes win over wildcard/dynamic siblings', () => {
  const routes = [
    {
      path: '*',
      view: () => null
    },
    {
      path: ':slug',
      view: () => null
    },
    {
      path: '/',
      layout: () => null,
      children: [
        {
          path: 'dashboard',
          view: () => null
        }
      ]
    }
  ];

  const result = findCompiledStackResult('/dashboard', routes);
  assert.ok(result, 'should find a stack result');
  assert.equal(result.exact, true, 'should be an exact match');
  assert.deepEqual(result.stack.map((match) => match.path), ['/', '/dashboard']);
});

test('RouteTables - exact match works for redirect-only routes', () => {
  const routes = [
    {
      path: '/old',
      redirect: '/new'
    },
    {
      path: '*',
      view: () => null
    }
  ];

  const result = findCompiledStackResult('/old', routes);
  assert.ok(result, 'should find a stack result');
  assert.equal(result.exact, true, 'redirect-only route should be exact');
  assert.equal(result.stack[0].path, '/old');
});

test('RouteTables - guard-only parent falls back to wildcard sibling', () => {
  const routes = [
    {
      path: '/admin',
      guard: () => true,
      children: [
        {
          path: 'users',
          view: () => null
        }
      ]
    },
    {
      path: '*',
      view: () => null
    }
  ];

  const result = findCompiledStackResult('/admin', routes);
  assert.ok(result, 'should resolve with wildcard fallback');
  assert.equal(result.exact, true, 'wildcard should be exact fallback');
  assert.deepEqual(result.stack.map((match) => match.path), ['/*']);
});

test('RouteTables - layout-only segment without page falls back to wildcard sibling', () => {
  const routes = [
    {
      path: '/dashboard',
      layout: () => null,
      children: [
        {
          path: 'users',
          view: () => null
        }
      ]
    },
    {
      path: '*',
      view: () => null
    }
  ];

  const result = findCompiledStackResult('/dashboard', routes);
  assert.ok(result, 'should resolve with wildcard fallback');
  assert.equal(result.exact, true, 'wildcard should be exact fallback');
  assert.deepEqual(result.stack.map((match) => match.path), ['/*']);
});

test('RouteTables - optional catch-all matches empty and nested paths', () => {
  const routes = [
    {
      path: '/docs/:slug*?',
      view: () => null
    }
  ];

  const emptyMatch = findCompiledExactLeaf('/docs', routes);
  assert.ok(emptyMatch, 'optional catch-all should match base path');
  assert.deepEqual(emptyMatch.params, { slug: [] });

  const nestedMatch = findCompiledExactLeaf('/docs/guides/v1', routes);
  assert.ok(nestedMatch, 'optional catch-all should match nested path');
  assert.deepEqual(nestedMatch.params, { slug: ['guides', 'v1'] });
});

test('RouteTables - required catch-all does not match empty suffix', () => {
  const routes = [
    {
      path: '/docs/:slug*',
      view: () => null
    }
  ];

  const emptyMatch = findCompiledExactLeaf('/docs', routes);
  assert.equal(emptyMatch, null, 'required catch-all must not match empty suffix');

  const nestedMatch = findCompiledExactLeaf('/docs/intro', routes);
  assert.ok(nestedMatch, 'required catch-all should match non-empty suffix');
  assert.deepEqual(nestedMatch.params, { slug: ['intro'] });
});

test('RouteTables - static route outranks dynamic sibling', () => {
  const routes = [
    { path: '/users/:id', view: () => null },
    { path: '/users/new', view: () => null }
  ];

  const result = findCompiledStackResult('/users/new', routes);
  assert.ok(result, 'should resolve static route');
  assert.equal(result.exact, true);
  assert.equal(result.stack[0].path, '/users/new');
});

test('RouteTables - static route outranks optional catch-all sibling', () => {
  const routes = [
    { path: '/docs/:slug*?', view: () => null },
    { path: '/docs', view: () => null }
  ];

  const result = findCompiledStackResult('/docs', routes);
  assert.ok(result, 'should resolve exact static route');
  assert.equal(result.exact, true);
  assert.equal(result.stack[0].path, '/docs');
});
