import type { RouteCtx, RouteTableMatch } from './route-tables.js';
export type RouterRenderOutput = Node | DocumentFragment | Node[];
interface RenderWrappedBoundaryOptions {
    matchStack: RouteTableMatch[];
    ctx: RouteCtx;
    content: RouterRenderOutput;
    leafIndex: number;
    wrapWithLayouts: (matchStack: RouteTableMatch[], ctx: RouteCtx, content: RouterRenderOutput, dataStack?: any[], leafIndex?: number, includeLeafLayout?: boolean) => RouterRenderOutput;
    mountToOutlet: (...nodes: Node[]) => void;
}
export declare function toRenderedNodes(content: RouterRenderOutput): Node[];
export declare function mountRenderedContent(mountToOutlet: (...nodes: Node[]) => void, content: RouterRenderOutput): void;
export declare function renderWrappedBoundary(options: RenderWrappedBoundaryOptions): void;
export {};
