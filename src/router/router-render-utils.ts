import type { RouteCtx, RouteTableMatch } from './route-tables.js';

export type RouterRenderOutput = Node | DocumentFragment | Node[];

interface RenderWrappedBoundaryOptions {
  matchStack: RouteTableMatch[];
  ctx: RouteCtx;
  content: RouterRenderOutput;
  leafIndex: number;
  wrapWithLayouts: (
    matchStack: RouteTableMatch[],
    ctx: RouteCtx,
    content: RouterRenderOutput,
    dataStack?: any[],
    leafIndex?: number,
    includeLeafLayout?: boolean
  ) => RouterRenderOutput;
  mountToOutlet: (...nodes: Node[]) => void;
}

export function toRenderedNodes(content: RouterRenderOutput): Node[] {
  return Array.isArray(content) ? content : [content];
}

export function mountRenderedContent(
  mountToOutlet: (...nodes: Node[]) => void,
  content: RouterRenderOutput
): void {
  mountToOutlet(...toRenderedNodes(content));
}

export function renderWrappedBoundary(options: RenderWrappedBoundaryOptions): void {
  const {
    matchStack,
    ctx,
    content,
    leafIndex,
    wrapWithLayouts,
    mountToOutlet
  } = options;

  const wrapped = wrapWithLayouts(matchStack, ctx, content, [], leafIndex, true);
  mountRenderedContent(mountToOutlet, wrapped);
}
