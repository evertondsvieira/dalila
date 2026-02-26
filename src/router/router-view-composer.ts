import type { RouteCtx, RouteTable, RouteTableMatch } from './route-tables.js';

export type RouterRenderOutput = Node | DocumentFragment | Node[];

export interface ComposeViewStackResult {
  content: RouterRenderOutput | null;
  leafRoute: RouteTable | null;
  leafData: unknown;
}

interface ComposeViewStackOptions {
  matchStack: RouteTableMatch[];
  ctx: RouteCtx;
  dataStack: any[];
  withScopeRender: <T>(fn: () => T) => T;
  resolveTagLayout: (
    match: RouteTableMatch
  ) => ((ctx: RouteCtx, child: Node[], data: any) => RouterRenderOutput) | null;
}

export function composeViewStack(options: ComposeViewStackOptions): ComposeViewStackResult {
  const { matchStack, ctx, dataStack, withScopeRender, resolveTagLayout } = options;
  let content: RouterRenderOutput | null = null;
  let leafRoute: RouteTable | null = null;
  let leafData: unknown = undefined;

  for (let i = matchStack.length - 1; i >= 0; i -= 1) {
    const match = matchStack[i];
    const data = dataStack[i];
    const route = match.route;

    if (i === matchStack.length - 1) {
      leafRoute = route;
      leafData = data;
      if (!route.view) {
        console.warn(`[Dalila] Leaf route ${match.path} has no view function`);
        return { content: null, leafRoute, leafData };
      }
      content = withScopeRender(() => route.view!(ctx, data));

      if (!route.layout && content) {
        const tagLayout = resolveTagLayout(match);
        if (tagLayout) {
          const childNodes: Node[] = Array.isArray(content) ? content : [content];
          content = withScopeRender(() => tagLayout(ctx, childNodes, data));
        }
      }
      continue;
    }

    if (!content) continue;

    const childNodes: Node[] = Array.isArray(content) ? content : [content];
    if (route.layout) {
      content = withScopeRender(() => route.layout!(ctx, childNodes, data));
    } else {
      const tagLayout = resolveTagLayout(match);
      if (tagLayout) {
        content = withScopeRender(() => tagLayout(ctx, childNodes, data));
      }
    }
  }

  return { content, leafRoute, leafData };
}
