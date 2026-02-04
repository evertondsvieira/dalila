export declare function collectHtmlPathDependencyDirs(routesDir: string): string[];
/**
 * Generate route files from the app directory.
 *
 * Produces three outputs: route table, route manifest, and route types.
 */
export declare function generateRoutesFile(routesDir: string, outputPath: string): Promise<void>;
