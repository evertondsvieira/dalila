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
    resolveTagLayout: (match: RouteTableMatch) => ((ctx: RouteCtx, child: Node[], data: any) => RouterRenderOutput) | null;
}
export declare function composeViewStack(options: ComposeViewStackOptions): ComposeViewStackResult;
export {};
