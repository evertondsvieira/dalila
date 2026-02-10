import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
function escapeTemplateLiteral(str) {
    return str
        .replace(/\\/g, '\\\\')
        .replace(/`/g, '\\`')
        .replace(/\$\{/g, '\\${');
}
const RESERVED_FILES = {
    'middleware.ts': 'middleware',
    'layout.ts': 'layout',
    'layout.html': 'layout',
    'page.ts': 'page',
    'page.html': 'page',
    'error.ts': 'error',
    'error.html': 'error',
    'loading.ts': 'pending',
    'loading.html': 'pending',
    'not-found.ts': 'notFound',
    'not-found.html': 'notFound'
};
function getFileType(filename) {
    return RESERVED_FILES[filename] ?? null;
}
function segmentToPath(segment) {
    if (segment.startsWith('[[...') && segment.endsWith(']]')) {
        return ':' + segment.slice(5, -2) + '*?';
    }
    if (segment.startsWith('[...') && segment.endsWith(']')) {
        return ':' + segment.slice(4, -1) + '*';
    }
    if (segment.startsWith('[') && segment.endsWith(']')) {
        return ':' + segment.slice(1, -1);
    }
    return segment;
}
function sanitizeImportName(relPath) {
    return relPath
        .replace(/\\/g, '_')
        .replace(/\//g, '_')
        .replace(/\.(ts|html)$/, '')
        .replace(/[^a-zA-Z0-9_]/g, '_');
}
function moduleExport(file, exportName, options = {}) {
    const allowValue = options.allowValue ?? false;
    if (file.lazy) {
        const lazyLoader = `${file.importName}_lazy`;
        return `(...args: any[]) => ${lazyLoader}().then(mod => {
      const exported = (mod as any).${exportName};
      if (typeof exported === 'function') {
        return exported(...args);
      }
      return ${allowValue ? 'exported' : 'undefined'};
    })`;
    }
    return `(${file.importName} as any).${exportName}`;
}
function routeDataExpr(dataVar) {
    const paramsSpread = `...(ctx.params as Record<string, unknown>)`;
    if (dataVar) {
        return `{ ${paramsSpread}, ...((${dataVar} ?? {}) as Record<string, unknown>), params: ctx.params, query: ctx.query.toString(), path: ctx.path, fullPath: ctx.fullPath }`;
    }
    return `{ ${paramsSpread}, params: ctx.params, query: ctx.query.toString(), path: ctx.path, fullPath: ctx.fullPath }`;
}
function segmentSortRank(segment) {
    if (segment.includes('*'))
        return 2;
    if (segment.startsWith(':'))
        return 1;
    return 0;
}
function compareRouteNodes(a, b) {
    const aSegment = a.routePath.split('/').filter(Boolean).pop() ?? '';
    const bSegment = b.routePath.split('/').filter(Boolean).pop() ?? '';
    const rankDiff = segmentSortRank(aSegment) - segmentSortRank(bSegment);
    if (rankDiff !== 0)
        return rankDiff;
    const lenDiff = bSegment.length - aSegment.length;
    if (lenDiff !== 0)
        return lenDiff;
    return aSegment.localeCompare(bSegment);
}
function toImportPath(outputPath, sourcePath) {
    const fromDir = path.dirname(outputPath);
    let rel = path.relative(fromDir, sourcePath).replace(/\\/g, '/');
    if (!rel.startsWith('.')) {
        rel = './' + rel;
    }
    return rel.replace(/\.ts$/, '.js');
}
function normalizeRoutePath(routePath) {
    if (!routePath)
        return '/';
    let normalized = routePath.startsWith('/') ? routePath : `/${routePath}`;
    normalized = normalized.replace(/\/{2,}/g, '/');
    if (normalized.length > 1 && normalized.endsWith('/')) {
        normalized = normalized.slice(0, -1);
    }
    return normalized;
}
function joinRoutePaths(parent, child) {
    if (!child || child === '.')
        return normalizeRoutePath(parent || '/');
    if (child.startsWith('/'))
        return normalizeRoutePath(child);
    const base = normalizeRoutePath(parent || '/');
    const trimmedBase = base === '/' ? '' : base;
    return normalizeRoutePath(`${trimmedBase}/${child}`);
}
function parseRouteParamSegment(segment) {
    if (!segment.startsWith(':'))
        return null;
    const raw = segment.slice(1);
    if (!raw)
        return null;
    if (raw.endsWith('*?')) {
        const key = raw.slice(0, -2);
        if (!key)
            return null;
        return { key, isCatchAll: true, isOptionalCatchAll: true };
    }
    if (raw.endsWith('*')) {
        const key = raw.slice(0, -1);
        if (!key)
            return null;
        return { key, isCatchAll: true, isOptionalCatchAll: false };
    }
    return { key: raw, isCatchAll: false, isOptionalCatchAll: false };
}
function extractParamKeys(routePattern) {
    const keys = [];
    const segments = normalizeRoutePath(routePattern).split('/').filter(Boolean);
    for (const segment of segments) {
        const param = parseRouteParamSegment(segment);
        if (!param)
            continue;
        keys.push(param.key);
    }
    return keys;
}
function computeRouteScore(routePattern) {
    const segments = normalizeRoutePath(routePattern).split('/').filter(Boolean);
    if (segments.length === 0)
        return 1000;
    let score = 0;
    for (const segment of segments) {
        if (segment === '*' || segment.includes('*')) {
            score += 1;
        }
        else if (segment.startsWith(':')) {
            score += 2;
        }
        else {
            score += 3;
        }
    }
    return score * 100 + segments.length;
}
function routeIdFromFsPath(fsPath) {
    if (!fsPath)
        return 'root';
    return fsPath
        .replace(/\\/g, '/')
        .replace(/\//g, '_')
        .replace(/[^a-zA-Z0-9_]/g, '_');
}
function extractTagsFromTsSource(source) {
    const tagsDecl = source.match(/export\s+const\s+tags\s*=\s*\[([\s\S]*?)\]/m);
    if (!tagsDecl)
        return [];
    const body = tagsDecl[1];
    const tags = [];
    const stringLiteral = /['"`]([^'"`]+)['"`]/g;
    let match = null;
    while ((match = stringLiteral.exec(body))) {
        const value = match[1].trim();
        if (value)
            tags.push(value);
    }
    return [...new Set(tags)];
}
function extractHtmlPathFromTsSource(source) {
    const htmlPathDecl = source.match(/export\s+const\s+htmlPath\s*=\s*(['"`])([^'"`]+)\1/m);
    if (!htmlPathDecl)
        return undefined;
    const value = htmlPathDecl[2]?.trim();
    if (!value)
        return undefined;
    return value;
}
function extractNamedExportsFromTsSource(source) {
    const exports = new Set();
    const declarationMatcher = /export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
    let declarationMatch = null;
    while ((declarationMatch = declarationMatcher.exec(source))) {
        exports.add(declarationMatch[1]);
    }
    const exportListMatcher = /export\s*{\s*([^}]+)\s*}/g;
    let exportListMatch = null;
    while ((exportListMatch = exportListMatcher.exec(source))) {
        const listBody = exportListMatch[1];
        const parts = listBody.split(',');
        for (const part of parts) {
            const normalized = part.trim().replace(/^type\s+/, '');
            if (!normalized)
                continue;
            if (normalized.includes(' as ')) {
                const alias = normalized.split(/\s+as\s+/).pop()?.trim();
                if (alias)
                    exports.add(alias);
            }
            else {
                exports.add(normalized);
            }
        }
    }
    return [...exports];
}
function collectNodeTags(node) {
    const tags = new Set();
    for (const file of node.files) {
        if (file.isHtml || !file.tags)
            continue;
        for (const tag of file.tags) {
            tags.add(tag);
        }
    }
    return [...tags];
}
function hasNamedExport(file, exportName) {
    return Boolean(file?.namedExports?.includes(exportName));
}
async function pathExists(filePath) {
    try {
        await fsp.access(filePath);
        return true;
    }
    catch {
        return false;
    }
}
function resolveHtmlPath(htmlPath, routesDir, filePath, projectRoot) {
    const routeFileAbsPath = path.join(routesDir, filePath);
    const routeFileDir = path.dirname(routeFileAbsPath);
    if (htmlPath.startsWith('@/')) {
        return path.resolve(projectRoot, 'src', htmlPath.slice(2));
    }
    if (path.isAbsolute(htmlPath)) {
        return path.resolve(htmlPath);
    }
    if (htmlPath.startsWith('./') || htmlPath.startsWith('../')) {
        return path.resolve(routeFileDir, htmlPath);
    }
    if (htmlPath.startsWith('src/')) {
        return path.resolve(projectRoot, htmlPath);
    }
    return path.resolve(routeFileDir, htmlPath);
}
async function injectHtmlPathTemplates(node, routesDir, projectRoot) {
    const syntheticHtmlFiles = [];
    for (const file of node.files) {
        if (file.isHtml || !file.htmlPath)
            continue;
        const hasLocalHtmlSibling = node.files.some((candidate) => candidate.isHtml && candidate.type === file.type);
        if (hasLocalHtmlSibling)
            continue;
        const resolvedHtmlPath = resolveHtmlPath(file.htmlPath, routesDir, file.path, projectRoot);
        if (!await pathExists(resolvedHtmlPath)) {
            throw new Error(`htmlPath not found for "${file.path}": "${file.htmlPath}" (resolved to "${resolvedHtmlPath}")`);
        }
        const htmlContent = await fsp.readFile(resolvedHtmlPath, 'utf-8');
        const relToProject = path.relative(projectRoot, resolvedHtmlPath).replace(/\\/g, '/');
        syntheticHtmlFiles.push({
            path: relToProject.startsWith('..') ? resolvedHtmlPath.replace(/\\/g, '/') : relToProject,
            type: file.type,
            importName: `${file.importName}__htmlPath`,
            isHtml: true,
            htmlContent
        });
    }
    if (syntheticHtmlFiles.length > 0) {
        node.files.push(...syntheticHtmlFiles);
    }
    await Promise.all(node.children.map(child => injectHtmlPathTemplates(child, routesDir, projectRoot)));
}
function hasPageRouteExports(pageTs) {
    return Boolean(pageTs
        && (hasNamedExport(pageTs, 'view')
            || hasNamedExport(pageTs, 'redirect')));
}
const DEFAULT_ROUTE_TAG_POLICY = {
    allowed: ['auth', 'public'],
    exclusiveGroups: [
        ['public', 'auth']
    ],
    forbiddenPairs: [
        ['public', 'auth']
    ],
    priority: ['auth', 'public']
};
async function findProjectRoot(startDir) {
    let current = path.resolve(startDir);
    while (true) {
        if (await pathExists(path.join(current, 'package.json'))) {
            return current;
        }
        const parent = path.dirname(current);
        if (parent === current)
            return null;
        current = parent;
    }
}
function findProjectRootSync(startDir) {
    let current = path.resolve(startDir);
    while (true) {
        if (fs.existsSync(path.join(current, 'package.json'))) {
            return current;
        }
        const parent = path.dirname(current);
        if (parent === current)
            return null;
        current = parent;
    }
}
function normalizeStringArray(input, field) {
    if (!Array.isArray(input)) {
        throw new Error(`Invalid route tags config: "${field}" must be an array.`);
    }
    const result = [];
    for (const value of input) {
        if (typeof value !== 'string' || !value.trim()) {
            throw new Error(`Invalid route tags config: "${field}" must contain non-empty strings.`);
        }
        result.push(value.trim());
    }
    return result;
}
function normalizeStringMatrix(input, field) {
    if (!Array.isArray(input)) {
        throw new Error(`Invalid route tags config: "${field}" must be an array of string arrays.`);
    }
    return input.map((row, index) => normalizeStringArray(row, `${field}[${index}]`));
}
function mergeTagPolicy(base, raw) {
    if (!raw)
        return base;
    const merged = {
        allowed: raw.allowed ? normalizeStringArray(raw.allowed, 'routeTags.allowed') : base.allowed,
        exclusiveGroups: raw.exclusiveGroups
            ? normalizeStringMatrix(raw.exclusiveGroups, 'routeTags.exclusiveGroups')
            : base.exclusiveGroups,
        forbiddenPairs: raw.forbiddenPairs
            ? normalizeStringMatrix(raw.forbiddenPairs, 'routeTags.forbiddenPairs')
            : base.forbiddenPairs,
        priority: raw.priority
            ? normalizeStringArray(raw.priority, 'routeTags.priority')
            : base.priority
    };
    return merged;
}
async function loadTagPolicy(routesDir, outputPath) {
    const cwdConfigPath = path.join(path.dirname(outputPath), 'dalila.routes.json');
    const projectRoot = await findProjectRoot(routesDir);
    const rootConfigPath = projectRoot ? path.join(projectRoot, 'dalila.routes.json') : '';
    const candidates = [cwdConfigPath, rootConfigPath].filter(Boolean);
    for (const configPath of candidates) {
        if (!await pathExists(configPath))
            continue;
        const rawText = await fsp.readFile(configPath, 'utf-8');
        const parsed = JSON.parse(rawText);
        const routeTags = parsed.routeTags
            ? parsed.routeTags
            : parsed;
        return mergeTagPolicy(DEFAULT_ROUTE_TAG_POLICY, routeTags);
    }
    return DEFAULT_ROUTE_TAG_POLICY;
}
function resolvePrimaryTag(tags, policy) {
    for (const tag of policy.priority) {
        if (tags.includes(tag))
            return tag;
    }
    return tags[0];
}
function validateManifestTags(entries, policy) {
    for (const entry of entries) {
        const tagSet = new Set(entry.tags);
        if (policy.allowed) {
            for (const tag of tagSet) {
                if (!policy.allowed.includes(tag)) {
                    throw new Error(`Route "${entry.pattern}" uses unknown tag "${tag}". Allowed tags: ${policy.allowed.join(', ')}.`);
                }
            }
        }
        for (const group of policy.exclusiveGroups) {
            const present = group.filter(tag => tagSet.has(tag));
            if (present.length > 1) {
                throw new Error(`Route "${entry.pattern}" has conflicting exclusive tags: ${present.join(', ')}.`);
            }
        }
        for (const pair of policy.forbiddenPairs) {
            if (pair.length < 2)
                continue;
            const [left, right] = pair;
            if (tagSet.has(left) && tagSet.has(right)) {
                throw new Error(`Route "${entry.pattern}" has forbidden tag combination: ${left} + ${right}.`);
            }
        }
    }
}
function findFile(node, type, isHtml) {
    return node.files.find((file) => {
        if (file.type !== type)
            return false;
        if (typeof isHtml === 'boolean' && file.isHtml !== isHtml)
            return false;
        return true;
    });
}
function stateProps(errorHtml, errorTs, pendingHtml, pendingTs, notFoundHtml, notFoundTs) {
    const props = [];
    if (errorHtml) {
        const errorConst = errorHtml.importName + '_html';
        props.push(`error: (ctx, err) => fromHtml(${errorConst}, { data: { errorMessage: String(err), ...${routeDataExpr()} }, scope: ctx.scope })`);
    }
    else if (errorTs && hasNamedExport(errorTs, 'error')) {
        props.push(`error: ${moduleExport(errorTs, 'error')}`);
    }
    if (pendingHtml) {
        const pendingConst = pendingHtml.importName + '_html';
        props.push(`pending: (ctx) => fromHtml(${pendingConst}, { data: ${routeDataExpr()}, scope: ctx.scope })`);
    }
    else if (pendingTs && hasNamedExport(pendingTs, 'pending')) {
        props.push(`pending: ${moduleExport(pendingTs, 'pending')}`);
    }
    if (notFoundHtml) {
        const notFoundConst = notFoundHtml.importName + '_html';
        props.push(`notFound: (ctx) => fromHtml(${notFoundConst}, { data: ${routeDataExpr()}, scope: ctx.scope })`);
    }
    else if (notFoundTs && hasNamedExport(notFoundTs, 'notFound')) {
        props.push(`notFound: ${moduleExport(notFoundTs, 'notFound')}`);
    }
    return props;
}
function pageProps(pageHtml, pageTs) {
    const props = [];
    if (!pageHtml && !pageTs) {
        return props;
    }
    if (pageHtml) {
        const viewConst = pageHtml.importName + '_html';
        if (pageTs) {
            props.push(`view: (ctx, data) => fromHtml(${viewConst}, { data: ${routeDataExpr('data')}, scope: ctx.scope })`);
            if (hasNamedExport(pageTs, 'loader')) {
                props.push(`loader: ${moduleExport(pageTs, 'loader')}`);
            }
            if (hasNamedExport(pageTs, 'preload')) {
                props.push(`preload: ${moduleExport(pageTs, 'preload')}`);
            }
            if (hasNamedExport(pageTs, 'redirect')) {
                props.push(`redirect: ${moduleExport(pageTs, 'redirect', { allowValue: true })}`);
            }
            if (hasNamedExport(pageTs, 'validation')) {
                props.push(`validation: ${moduleExport(pageTs, 'validation', { allowValue: true })}`);
            }
            if (hasNamedExport(pageTs, 'onMount')) {
                if (pageTs.lazy) {
                    const lazyLoader = `${pageTs.importName}_lazy`;
                    props.push(`onMount: (root: HTMLElement) => ${lazyLoader}().then(mod => {
      if (typeof (mod as any).onMount === 'function') {
        (mod as any).onMount(root);
      }
    })`);
                }
                else {
                    props.push(`onMount: ${moduleExport(pageTs, 'onMount')}`);
                }
            }
        }
        else {
            props.push(`view: (ctx) => fromHtml(${viewConst}, { data: ${routeDataExpr()}, scope: ctx.scope })`);
        }
        return props;
    }
    if (!pageTs) {
        return props;
    }
    if (hasNamedExport(pageTs, 'view')) {
        props.push(`view: ${moduleExport(pageTs, 'view')}`);
    }
    if (hasNamedExport(pageTs, 'loader')) {
        props.push(`loader: ${moduleExport(pageTs, 'loader')}`);
    }
    if (hasNamedExport(pageTs, 'preload')) {
        props.push(`preload: ${moduleExport(pageTs, 'preload')}`);
    }
    if (hasNamedExport(pageTs, 'redirect')) {
        props.push(`redirect: ${moduleExport(pageTs, 'redirect', { allowValue: true })}`);
    }
    if (hasNamedExport(pageTs, 'validation')) {
        props.push(`validation: ${moduleExport(pageTs, 'validation', { allowValue: true })}`);
    }
    return props;
}
function layoutProps(indent, layoutHtml, layoutTs) {
    const lines = [];
    if (layoutHtml) {
        const layoutConst = layoutHtml.importName + '_html';
        if (layoutTs) {
            lines.push(`${indent}layout: (ctx, children, data) => fromHtml(${layoutConst}, { data: ${routeDataExpr('data')}, children, scope: ctx.scope }),`);
            if (hasNamedExport(layoutTs, 'loader')) {
                lines.push(`${indent}loader: ${moduleExport(layoutTs, 'loader')},`);
            }
            if (hasNamedExport(layoutTs, 'preload')) {
                lines.push(`${indent}preload: ${moduleExport(layoutTs, 'preload')},`);
            }
            if (hasNamedExport(layoutTs, 'redirect')) {
                lines.push(`${indent}redirect: ${moduleExport(layoutTs, 'redirect', { allowValue: true })},`);
            }
            if (hasNamedExport(layoutTs, 'validation')) {
                lines.push(`${indent}validation: ${moduleExport(layoutTs, 'validation', { allowValue: true })},`);
            }
        }
        else {
            lines.push(`${indent}layout: (ctx, children) => fromHtml(${layoutConst}, { data: ${routeDataExpr()}, children, scope: ctx.scope }),`);
        }
    }
    else if (layoutTs) {
        if (hasNamedExport(layoutTs, 'layout')) {
            lines.push(`${indent}layout: ${moduleExport(layoutTs, 'layout')},`);
        }
        if (hasNamedExport(layoutTs, 'loader')) {
            lines.push(`${indent}loader: ${moduleExport(layoutTs, 'loader')},`);
        }
        if (hasNamedExport(layoutTs, 'preload')) {
            lines.push(`${indent}preload: ${moduleExport(layoutTs, 'preload')},`);
        }
        if (hasNamedExport(layoutTs, 'redirect')) {
            lines.push(`${indent}redirect: ${moduleExport(layoutTs, 'redirect', { allowValue: true })},`);
        }
        if (hasNamedExport(layoutTs, 'validation')) {
            lines.push(`${indent}validation: ${moduleExport(layoutTs, 'validation', { allowValue: true })},`);
        }
    }
    return lines;
}
/** Build the route tree by scanning the app directory for convention files. */
function buildRouteTreeSync(routesDir, currentPath = '', currentSegment = '') {
    const node = {
        fsPath: currentPath.replace(/\\/g, '/'),
        segment: currentSegment,
        routePath: currentSegment ? segmentToPath(currentSegment) : '/',
        files: [],
        children: []
    };
    const fullPath = path.join(routesDir, currentPath);
    if (!fs.existsSync(fullPath)) {
        return node;
    }
    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
    for (const entry of entries) {
        if (!entry.isFile())
            continue;
        const fileType = getFileType(entry.name);
        if (!fileType)
            continue;
        const relPath = path.join(currentPath, entry.name);
        const isHtml = entry.name.endsWith('.html');
        const fullFilePath = path.join(routesDir, relPath);
        const sourceContent = isHtml ? undefined : fs.readFileSync(fullFilePath, 'utf-8');
        node.files.push({
            path: relPath,
            type: fileType,
            importName: sanitizeImportName(relPath),
            isHtml,
            htmlContent: isHtml ? fs.readFileSync(fullFilePath, 'utf-8') : undefined,
            htmlPath: sourceContent ? extractHtmlPathFromTsSource(sourceContent) : undefined,
            sourceContent,
            namedExports: sourceContent ? extractNamedExportsFromTsSource(sourceContent) : undefined,
            tags: sourceContent ? extractTagsFromTsSource(sourceContent) : undefined
        });
    }
    for (const entry of entries) {
        if (!entry.isDirectory())
            continue;
        if (entry.name.startsWith('.') || entry.name === 'node_modules')
            continue;
        const childPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
        node.children.push(buildRouteTreeSync(routesDir, childPath, entry.name));
    }
    return node;
}
async function buildRouteTree(routesDir, currentPath = '', currentSegment = '') {
    const node = {
        fsPath: currentPath.replace(/\\/g, '/'),
        segment: currentSegment,
        routePath: currentSegment ? segmentToPath(currentSegment) : '/',
        files: [],
        children: []
    };
    const fullPath = path.join(routesDir, currentPath);
    if (!await pathExists(fullPath)) {
        return node;
    }
    const entries = await fsp.readdir(fullPath, { withFileTypes: true });
    const fileReads = [];
    for (const entry of entries) {
        if (!entry.isFile())
            continue;
        const fileType = getFileType(entry.name);
        if (!fileType)
            continue;
        const relPath = path.join(currentPath, entry.name);
        const isHtml = entry.name.endsWith('.html');
        const fullFilePath = path.join(routesDir, relPath);
        fileReads.push(fsp.readFile(fullFilePath, 'utf-8').then(content => {
            const sourceContent = isHtml ? undefined : content;
            node.files.push({
                path: relPath,
                type: fileType,
                importName: sanitizeImportName(relPath),
                isHtml,
                htmlContent: isHtml ? content : undefined,
                htmlPath: sourceContent ? extractHtmlPathFromTsSource(sourceContent) : undefined,
                sourceContent,
                namedExports: sourceContent ? extractNamedExportsFromTsSource(sourceContent) : undefined,
                tags: sourceContent ? extractTagsFromTsSource(sourceContent) : undefined
            });
        }));
    }
    await Promise.all(fileReads);
    const childBuilds = [];
    for (const entry of entries) {
        if (!entry.isDirectory())
            continue;
        if (entry.name.startsWith('.') || entry.name === 'node_modules')
            continue;
        const childPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
        childBuilds.push(buildRouteTree(routesDir, childPath, entry.name));
    }
    node.children = await Promise.all(childBuilds);
    return node;
}
function markLazyModules(node) {
    const hasLayoutHtml = Boolean(findFile(node, 'layout', true));
    for (const file of node.files) {
        if (file.isHtml) {
            file.lazy = false;
            continue;
        }
        const hasPageViewExport = file.type === 'page' && Boolean(file.namedExports?.includes('view'));
        file.lazy = (file.type === 'page' && !hasPageViewExport)
            || file.type === 'middleware'
            || (file.type === 'layout' && hasLayoutHtml);
    }
    for (const child of node.children) {
        markLazyModules(child);
    }
}
function collectHtmlPathDependencyDirsFromTree(node, routesDir, projectRoot, out) {
    for (const file of node.files) {
        if (file.isHtml || !file.htmlPath)
            continue;
        const resolvedHtmlPath = resolveHtmlPath(file.htmlPath, routesDir, file.path, projectRoot);
        out.add(path.dirname(resolvedHtmlPath));
    }
    for (const child of node.children) {
        collectHtmlPathDependencyDirsFromTree(child, routesDir, projectRoot, out);
    }
}
export function collectHtmlPathDependencyDirs(routesDir) {
    if (!fs.existsSync(routesDir))
        return [];
    const tree = buildRouteTreeSync(routesDir, '', '');
    const projectRoot = findProjectRootSync(routesDir) ?? process.cwd();
    const dirs = new Set();
    collectHtmlPathDependencyDirsFromTree(tree, routesDir, projectRoot, dirs);
    return [...dirs];
}
/** Collect import statements for a route node's files. */
function generateImports(node, routesDir, outputPath) {
    const imports = [];
    for (const file of node.files) {
        if (file.isHtml || file.lazy)
            continue;
        const sourcePath = path.join(routesDir, file.path);
        const importPath = toImportPath(outputPath, sourcePath);
        imports.push(`import * as ${file.importName} from '${importPath}';`);
    }
    for (const child of node.children) {
        imports.push(...generateImports(child, routesDir, outputPath));
    }
    return imports;
}
function generateLazyModuleLoaders(node, routesDir, outputPath) {
    const loaders = [];
    for (const file of node.files) {
        if (file.isHtml || !file.lazy)
            continue;
        const sourcePath = path.join(routesDir, file.path);
        const importPath = toImportPath(outputPath, sourcePath);
        loaders.push(`const ${file.importName}_lazy = () => import('${importPath}');`);
    }
    for (const child of node.children) {
        loaders.push(...generateLazyModuleLoaders(child, routesDir, outputPath));
    }
    return loaders;
}
function collectHtmlFiles(node) {
    const files = node.files.filter((file) => file.isHtml);
    for (const child of node.children) {
        files.push(...collectHtmlFiles(child));
    }
    return files;
}
function generateHtmlConstants(htmlFiles) {
    return htmlFiles.map((file) => {
        const constName = file.importName + '_html';
        const escaped = escapeTemplateLiteral(file.htmlContent);
        return `const ${constName} = \`${escaped}\`;`;
    });
}
function collectManifestEntries(node, routesDir, outputPath, parentPattern = '/', inheritedTags = [], inheritedModules = []) {
    const entries = [];
    const currentPattern = node.segment
        ? joinRoutePaths(parentPattern, node.routePath)
        : normalizeRoutePath(parentPattern);
    const pageHtml = findFile(node, 'page', true);
    const pageTs = findFile(node, 'page', false);
    const hasPage = Boolean(pageHtml || hasPageRouteExports(pageTs));
    const ownTags = collectNodeTags(node);
    const mergedTags = [...new Set([...inheritedTags, ...ownTags])];
    const ownModules = node.files
        .filter(file => !file.isHtml)
        .map(file => toImportPath(outputPath, path.join(routesDir, file.path)));
    const mergedModules = [...new Set([...inheritedModules, ...ownModules])];
    if (hasPage) {
        const pattern = normalizeRoutePath(currentPattern);
        entries.push({
            id: routeIdFromFsPath(node.fsPath),
            pattern,
            score: computeRouteScore(pattern),
            paramKeys: extractParamKeys(pattern),
            tags: mergedTags,
            modules: mergedModules
        });
    }
    for (const child of [...node.children].sort(compareRouteNodes)) {
        entries.push(...collectManifestEntries(child, routesDir, outputPath, currentPattern, mergedTags, mergedModules));
    }
    return entries;
}
function validateManifestEntries(entries) {
    const seenByPattern = new Map();
    const seenById = new Map();
    for (const entry of entries) {
        const existingPattern = seenByPattern.get(entry.pattern);
        if (existingPattern) {
            throw new Error(`Conflicting routes for pattern "${entry.pattern}": "${existingPattern}" and "${entry.id}".`);
        }
        seenByPattern.set(entry.pattern, entry.id);
        const existingId = seenById.get(entry.id);
        if (existingId) {
            throw new Error(`Duplicate route ID "${entry.id}" generated for patterns "${existingId}" and "${entry.pattern}". ` +
                `Rename one of the files to avoid ID collision.`);
        }
        seenById.set(entry.id, entry.pattern);
    }
}
function generateManifestFile(entries, policy) {
    const importTypeLine = `import type { RouteManifestEntry } from 'dalila/router';`;
    const sorted = [...entries].sort((a, b) => {
        if (b.score !== a.score)
            return b.score - a.score;
        return a.pattern.localeCompare(b.pattern);
    });
    const lines = [];
    lines.push(`// This file is auto-generated by 'dalila routes generate'`);
    lines.push(`// Do not edit manually - your changes will be overwritten`);
    lines.push('');
    lines.push(importTypeLine);
    lines.push('');
    lines.push(`export const routeManifest: RouteManifestEntry[] = [`);
    for (const entry of sorted) {
        const loadExpr = entry.modules.length === 0
            ? `() => Promise.resolve()`
            : entry.modules.length === 1
                ? `() => import('${entry.modules[0]}').then(() => undefined)`
                : `() => Promise.all([${entry.modules.map(modulePath => `import('${modulePath}')`).join(', ')}]).then(() => undefined)`;
        const primaryTag = resolvePrimaryTag(entry.tags, policy);
        lines.push(`  {`);
        lines.push(`    id: '${entry.id}',`);
        lines.push(`    pattern: '${entry.pattern}',`);
        lines.push(`    score: ${entry.score},`);
        lines.push(`    paramKeys: ${JSON.stringify(entry.paramKeys)},`);
        lines.push(`    tags: ${JSON.stringify(entry.tags)},`);
        if (primaryTag) {
            lines.push(`    primaryTag: '${primaryTag}',`);
        }
        lines.push(`    modules: ${JSON.stringify(entry.modules)},`);
        lines.push(`    load: ${loadExpr}`);
        lines.push(`  },`);
    }
    lines.push(`];`);
    lines.push('');
    lines.push(`const manifestById = new Map(routeManifest.map(route => [route.id, route]));`);
    lines.push('');
    lines.push(`export function getRouteManifestEntry(id: string): RouteManifestEntry | undefined {`);
    lines.push(`  return manifestById.get(id);`);
    lines.push(`}`);
    lines.push('');
    lines.push(`export async function prefetchRouteById(id: string): Promise<void> {`);
    lines.push(`  const entry = manifestById.get(id);`);
    lines.push(`  if (!entry) return;`);
    lines.push(`  await entry.load();`);
    lines.push(`}`);
    lines.push('');
    return lines.join('\n');
}
function paramsTypeForPattern(pattern) {
    const segments = normalizeRoutePath(pattern).split('/').filter(Boolean);
    const fields = [];
    for (const segment of segments) {
        const param = parseRouteParamSegment(segment);
        if (!param)
            continue;
        if (param.isOptionalCatchAll) {
            fields.push(`${param.key}?: string[]`);
        }
        else if (param.isCatchAll) {
            fields.push(`${param.key}: string[]`);
        }
        else {
            fields.push(`${param.key}: string`);
        }
    }
    if (fields.length === 0) {
        return '{}';
    }
    return `{ ${fields.join('; ')} }`;
}
function generateRouteTypesFile(entries) {
    const patterns = [...new Set(entries.map(entry => entry.pattern))];
    const patternLiteral = patterns.length > 0
        ? patterns.map(pattern => `'${pattern}'`).join(' | ')
        : 'never';
    const lines = [];
    lines.push(`// This file is auto-generated by 'dalila routes generate'`);
    lines.push(`// Do not edit manually - your changes will be overwritten`);
    lines.push('');
    lines.push(`export type RoutePattern = ${patternLiteral};`);
    lines.push('');
    lines.push(`export type RouteParamsByPattern = {`);
    for (const pattern of patterns) {
        lines.push(`  '${pattern}': ${paramsTypeForPattern(pattern)};`);
    }
    lines.push(`};`);
    lines.push('');
    lines.push(`export type RouteSearchByPattern = {`);
    lines.push(`  [P in RoutePattern]: Record<string, string | string[]>;`);
    lines.push(`};`);
    lines.push('');
    lines.push(`export type RouteParams<P extends RoutePattern> = RouteParamsByPattern[P];`);
    lines.push(`export type RouteSearch<P extends RoutePattern> = RouteSearchByPattern[P];`);
    lines.push('');
    lines.push(`export function buildRoutePath<P extends RoutePattern>(pattern: P, params: RouteParams<P>): string {`);
    lines.push(`  const out: string[] = [];`);
    lines.push(`  for (const segment of pattern.split('/').filter(Boolean)) {`);
    lines.push(`    if (!segment.startsWith(':')) {`);
    lines.push(`      out.push(segment);`);
    lines.push(`      continue;`);
    lines.push(`    }`);
    lines.push('');
    lines.push(`    const isOptionalCatchAll = segment.endsWith('*?');`);
    lines.push(`    const isCatchAll = isOptionalCatchAll || segment.endsWith('*');`);
    lines.push(`    const key = segment.slice(1, isCatchAll ? (isOptionalCatchAll ? -2 : -1) : undefined);`);
    lines.push(`    const value = (params as Record<string, unknown>)[key];`);
    lines.push('');
    lines.push(`    if (isCatchAll) {`);
    lines.push(`      if (value === undefined || value === null) {`);
    lines.push(`        if (isOptionalCatchAll) continue;`);
    lines.push(`        throw new Error(\`Missing route param: \${key}\`);`);
    lines.push(`      }`);
    lines.push(`      if (!Array.isArray(value)) {`);
    lines.push(`        throw new Error(\`Route param "\${key}" must be an array\`);`);
    lines.push(`      }`);
    lines.push(`      if (value.length === 0) {`);
    lines.push(`        if (isOptionalCatchAll) continue;`);
    lines.push(`        throw new Error(\`Route param "\${key}" cannot be empty\`);`);
    lines.push(`      }`);
    lines.push(`      out.push(...value.map(v => encodeURIComponent(String(v))));`);
    lines.push(`      continue;`);
    lines.push(`    }`);
    lines.push('');
    lines.push(`    if (value === undefined || value === null) {`);
    lines.push(`      throw new Error(\`Missing route param: \${key}\`);`);
    lines.push(`    }`);
    lines.push(`    out.push(encodeURIComponent(String(value)));`);
    lines.push(`  }`);
    lines.push('');
    lines.push(`  return out.length === 0 ? '/' : \`/\${out.join('/')}\`;`);
    lines.push(`}`);
    lines.push('');
    return lines.join('\n');
}
/** Generate the route object literal for a single route node. */
function generateRouteObject(node, depth = 0) {
    const indent = '  '.repeat(depth);
    const middleware = findFile(node, 'middleware');
    const layoutHtml = findFile(node, 'layout', true);
    const layoutTs = findFile(node, 'layout', false);
    const hasLayout = Boolean(layoutHtml || layoutTs);
    const pageHtml = findFile(node, 'page', true);
    const pageTs = findFile(node, 'page', false);
    const hasPage = Boolean(pageHtml || hasPageRouteExports(pageTs));
    const errorHtml = findFile(node, 'error', true);
    const errorTs = findFile(node, 'error', false);
    const pendingHtml = findFile(node, 'pending', true);
    const pendingTs = findFile(node, 'pending', false);
    const notFoundHtml = findFile(node, 'notFound', true);
    const notFoundTs = findFile(node, 'notFound', false);
    if (!hasPage && node.children.length === 0) {
        return null;
    }
    const lines = [];
    lines.push(`${indent}{`);
    lines.push(`${indent}  path: '${node.routePath}',`);
    if (middleware && hasNamedExport(middleware, 'middleware')) {
        lines.push(`${indent}  middleware: ${moduleExport(middleware, 'middleware', { allowValue: true })},`);
    }
    if (middleware && hasNamedExport(middleware, 'guard')) {
        lines.push(`${indent}  guard: ${moduleExport(middleware, 'guard')},`);
    }
    lines.push(...layoutProps(`${indent}  `, layoutHtml, layoutTs));
    const segmentStateProps = stateProps(errorHtml, errorTs, pendingHtml, pendingTs, notFoundHtml, notFoundTs);
    for (const prop of segmentStateProps) {
        lines.push(`${indent}  ${prop},`);
    }
    const ownPageProps = pageProps(pageHtml, pageTs);
    if (hasPage && !hasLayout) {
        for (const prop of ownPageProps) {
            lines.push(`${indent}  ${prop},`);
        }
    }
    const children = [];
    if (hasLayout && hasPage) {
        children.push(`${indent}    { path: '', ${ownPageProps.join(', ')} }`);
    }
    for (const child of [...node.children].sort(compareRouteNodes)) {
        const childCode = generateRouteObject(child, depth + 2);
        if (childCode) {
            children.push(childCode);
        }
    }
    if (children.length > 0) {
        lines.push(`${indent}  children: [`);
        lines.push(children.join(',\n'));
        lines.push(`${indent}  ]`);
    }
    lines.push(`${indent}}`);
    return lines.join('\n');
}
/**
 * Generate route files from the app directory.
 *
 * Produces three outputs: route table, route manifest, and route types.
 */
export async function generateRoutesFile(routesDir, outputPath) {
    console.log('🔍 Scanning app directory:', routesDir);
    if (!await pathExists(routesDir)) {
        throw new Error(`Routes directory not found: ${routesDir}`);
    }
    const tree = await buildRouteTree(routesDir, '', '');
    const projectRoot = await findProjectRoot(routesDir) ?? process.cwd();
    await injectHtmlPathTemplates(tree, routesDir, projectRoot);
    markLazyModules(tree);
    console.log('✅ Route tree built');
    const outputBase = outputPath.endsWith('.ts') ? outputPath.slice(0, -3) : outputPath;
    const manifestOutputPath = `${outputBase}.manifest.ts`;
    const typesOutputPath = `${outputBase}.types.ts`;
    const imports = generateImports(tree, routesDir, outputPath);
    const lazyLoaders = generateLazyModuleLoaders(tree, routesDir, outputPath);
    console.log(`✅ Found ${imports.length} eagerly imported route modules`);
    if (lazyLoaders.length > 0) {
        console.log(`✅ Found ${lazyLoaders.length} lazily loaded route modules`);
    }
    const htmlFiles = collectHtmlFiles(tree);
    const htmlConstants = generateHtmlConstants(htmlFiles);
    if (htmlFiles.length > 0) {
        console.log(`✅ Found ${htmlFiles.length} HTML templates`);
    }
    const rootCode = generateRouteObject(tree, 1);
    const hasHtml = htmlFiles.length > 0;
    const manifestEntries = collectManifestEntries(tree, routesDir, manifestOutputPath);
    const tagPolicy = await loadTagPolicy(routesDir, outputPath);
    validateManifestEntries(manifestEntries);
    validateManifestTags(manifestEntries, tagPolicy);
    const sections = [];
    sections.push(`// This file is auto-generated by 'dalila routes generate'\n` +
        `// Do not edit manually - your changes will be overwritten`);
    const importLines = [];
    importLines.push(`import type { RouteTable } from 'dalila/router';`);
    if (hasHtml) {
        importLines.push(`import { fromHtml } from 'dalila';`);
    }
    if (imports.length > 0) {
        importLines.push(...imports);
    }
    sections.push(importLines.join('\n'));
    if (htmlConstants.length > 0) {
        sections.push(htmlConstants.join('\n'));
    }
    if (lazyLoaders.length > 0) {
        sections.push(lazyLoaders.join('\n'));
    }
    sections.push(`export const routes: RouteTable[] = [\n${rootCode || ''}\n];`);
    const code = sections.join('\n\n') + '\n';
    await Promise.all([
        fsp.writeFile(outputPath, code, 'utf-8'),
        fsp.writeFile(manifestOutputPath, generateManifestFile(manifestEntries, tagPolicy), 'utf-8'),
        fsp.writeFile(typesOutputPath, generateRouteTypesFile(manifestEntries), 'utf-8')
    ]);
    console.log('✅ Generated routes file:', outputPath);
    console.log('✅ Generated route manifest:', manifestOutputPath);
    console.log('✅ Generated route types:', typesOutputPath);
    console.log('');
    console.log('Import in your app:');
    console.log(`  import { routes } from './${path.basename(outputPath, '.ts')}';`);
    console.log(`  import { routeManifest } from './${path.basename(manifestOutputPath, '.ts')}';`);
    console.log('');
}
