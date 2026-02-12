export type RouteFileType = 'middleware' | 'layout' | 'page' | 'error' | 'pending' | 'notFound';
export interface RouteFile {
    path: string;
    type: RouteFileType;
    importName: string;
    isHtml: boolean;
    htmlContent?: string;
    htmlPath?: string;
    sourceContent?: string;
    namedExports?: string[];
    tags?: string[];
    lazy?: boolean;
}
export interface RouteNode {
    fsPath: string;
    segment: string;
    routePath: string;
    files: RouteFile[];
    children: RouteNode[];
}
export declare function extractParamKeys(routePattern: string): string[];
export declare function injectHtmlPathTemplates(node: RouteNode, routesDir: string, projectRoot: string): Promise<void>;
export declare function findProjectRoot(startDir: string): Promise<string | null>;
export declare function findFile(node: RouteNode, type: RouteFileType, isHtml?: boolean): RouteFile | undefined;
export declare function buildRouteTree(routesDir: string, currentPath?: string, currentSegment?: string): Promise<RouteNode>;
export declare function collectHtmlPathDependencyDirs(routesDir: string): string[];
/**
 * Generate route files from the app directory.
 *
 * Produces three outputs: route table, route manifest, and route types.
 */
export declare function generateRoutesFile(routesDir: string, outputPath: string): Promise<void>;
