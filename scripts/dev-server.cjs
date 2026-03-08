#!/usr/bin/env node
/* Dalila Development Server */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// ============================================================================
// Configuration
// ============================================================================
function resolveServerConfig(argv = process.argv.slice(2), cwd = process.cwd()) {
  const projectDir = fs.realpathSync(cwd);
  const distMode = argv.includes('--dist');
  const rootDir = distMode ? path.join(projectDir, 'dist') : projectDir;
  const isDalilaRepo = !distMode && fs.existsSync(path.join(rootDir, 'src', 'core', 'signal.ts'));
  const defaultEntry = isDalilaRepo ? '/examples/playground/index.html' : '/index.html';

  return {
    projectDir,
    rootDir,
    distMode,
    isDalilaRepo,
    defaultEntry,
  };
}

const serverConfig = resolveServerConfig();
const projectDir = serverConfig.projectDir;
const rootDir = serverConfig.rootDir;
const rootDirAbs = fs.existsSync(rootDir) ? fs.realpathSync(rootDir) : path.resolve(rootDir);
const distMode = serverConfig.distMode;
const isDalilaRepo = serverConfig.isDalilaRepo;
const defaultEntry = serverConfig.defaultEntry;
const port = Number(process.env.PORT) || 4242;

// Load TypeScript (optional for user projects)
let ts = null;
try {
  ts = require('typescript');
} catch {
  // TypeScript not available
}

// ============================================================================
// HMR State
// ============================================================================
const hmrClients = new Set();
let hmrTimer = null;
let keepaliveInterval = null;

// ============================================================================
// Content Types
// ============================================================================
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.ts': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

// No-cache extensions for dev mode
const noCacheExtensions = new Set(['.html', '.js', '.mjs', '.ts', '.css']);

// ============================================================================
// Helpers
// ============================================================================
const DEV_SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline' https:",
    "img-src 'self' data: blob: https: http:",
    "font-src 'self' data: https:",
    "connect-src 'self' ws: wss: http: https:",
    "frame-src 'self' https:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; '),
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
});

function createSecurityHeaders(headers = {}) {
  return { ...DEV_SECURITY_HEADERS, ...headers };
}

function writeResponseHead(res, status, headers = {}) {
  res.writeHead(status, createSecurityHeaders(headers));
}

function send(res, status, body, headers = {}) {
  writeResponseHead(res, status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(body);
}

const FORBIDDEN_PATH_ERROR_CODE = 'DALILA_FORBIDDEN_PATH';

function createForbiddenPathError() {
  const error = new Error('Forbidden');
  error.code = FORBIDDEN_PATH_ERROR_CODE;
  return error;
}

function isPathInsideRoot(candidatePath) {
  const normalizedPath = path.resolve(candidatePath);
  const relativePath = path.relative(rootDirAbs, normalizedPath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function normalizeServedPath(candidatePath) {
  if (typeof candidatePath !== 'string' || candidatePath.length === 0) {
    return null;
  }

  const normalizedPath = path.resolve(candidatePath);
  return isPathInsideRoot(normalizedPath) ? normalizedPath : null;
}

function statServedPath(targetPath) {
  const safePath = normalizeServedPath(targetPath);
  if (!safePath) {
    throw createForbiddenPathError();
  }

  return {
    safePath,
    stat: fs.statSync(safePath),
  };
}

function existsServedPath(targetPath) {
  const safePath = normalizeServedPath(targetPath);
  return safePath ? fs.existsSync(safePath) : false;
}

function readServedFile(targetPath, encoding, callback) {
  const safePath = normalizeServedPath(targetPath);
  if (!safePath) {
    queueMicrotask(() => callback(createForbiddenPathError()));
    return;
  }

  fs.readFile(safePath, encoding, callback);
}

function replaceServedPathExtension(targetPath, fromExtension, toExtension) {
  const safePath = normalizeServedPath(targetPath);
  if (!safePath || !safePath.endsWith(fromExtension)) {
    return null;
  }

  return normalizeServedPath(`${safePath.slice(0, -fromExtension.length)}${toExtension}`);
}

function appendServedPathExtension(targetPath, extension) {
  const safePath = normalizeServedPath(targetPath);
  if (!safePath) {
    return null;
  }

  return normalizeServedPath(`${safePath}${extension}`);
}

function joinServedPath(targetPath, childPath) {
  const safePath = normalizeServedPath(targetPath);
  if (!safePath) {
    return null;
  }

  return normalizeServedPath(path.join(safePath, childPath));
}

function escapeInlineScriptContent(script) {
  return script.replace(/--!>|-->|[<>\u2028\u2029]/g, (match) => {
    switch (match) {
      case '--!>':
        return '--!\\u003E';
      case '-->':
        return '--\\u003E';
      case '<':
        return '\\u003C';
      case '>':
        return '\\u003E';
      case '\u2028':
        return '\\u2028';
      case '\u2029':
        return '\\u2029';
      default:
        return match;
    }
  });
}

function stringifyInlineScriptPayload(value, indent = 0) {
  const json = escapeInlineScriptContent(JSON.stringify(value, null, 2));
  if (indent <= 0) {
    return json;
  }

  const padding = ' '.repeat(indent);
  return json
    .split('\n')
    .map((line) => `${padding}${line}`)
    .join('\n');
}

function normalizePreloadStorageType(storageType) {
  return storageType === 'sessionStorage' ? 'sessionStorage' : 'localStorage';
}

function isHtmlWhitespaceChar(char) {
  return char === ' ' || char === '\n' || char === '\r' || char === '\t' || char === '\f';
}

function isHtmlTagBoundary(char) {
  return !char || isHtmlWhitespaceChar(char) || char === '>' || char === '/';
}

function findHtmlTagEnd(html, startIndex) {
  let quote = null;

  for (let index = startIndex; index < html.length; index += 1) {
    const char = html[index];
    if (quote) {
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === '\'') {
      quote = char;
      continue;
    }

    if (char === '>') {
      return index;
    }
  }

  return -1;
}

function findScriptCloseTagStart(lower, searchIndex) {
  let index = lower.indexOf('</script', searchIndex);

  while (index !== -1) {
    if (isHtmlTagBoundary(lower[index + 8])) {
      return index;
    }
    index = lower.indexOf('</script', index + 8);
  }

  return -1;
}

function getHtmlAttributeValue(attributesSource, attributeName) {
  const name = attributeName.toLowerCase();
  let index = 0;

  while (index < attributesSource.length) {
    while (index < attributesSource.length && isHtmlWhitespaceChar(attributesSource[index])) {
      index += 1;
    }

    if (index >= attributesSource.length) {
      return null;
    }

    if (attributesSource[index] === '/') {
      index += 1;
      continue;
    }

    const nameStart = index;
    while (
      index < attributesSource.length
      && !isHtmlWhitespaceChar(attributesSource[index])
      && !['=', '>', '"', '\'', '`'].includes(attributesSource[index])
    ) {
      index += 1;
    }
    if (index === nameStart) {
      index += 1;
      continue;
    }

    const currentName = attributesSource.slice(nameStart, index).toLowerCase();

    while (index < attributesSource.length && isHtmlWhitespaceChar(attributesSource[index])) {
      index += 1;
    }

    if (attributesSource[index] !== '=') {
      continue;
    }
    index += 1;

    while (index < attributesSource.length && isHtmlWhitespaceChar(attributesSource[index])) {
      index += 1;
    }

    if (index >= attributesSource.length) {
      return currentName === name ? '' : null;
    }

    let value = '';
    const quote = attributesSource[index];
    if (quote === '"' || quote === '\'') {
      index += 1;
      const valueStart = index;
      while (index < attributesSource.length && attributesSource[index] !== quote) {
        index += 1;
      }
      value = attributesSource.slice(valueStart, index);
      if (index < attributesSource.length) {
        index += 1;
      }
    } else {
      const valueStart = index;
      while (
        index < attributesSource.length
        && !isHtmlWhitespaceChar(attributesSource[index])
        && attributesSource[index] !== '>'
      ) {
        index += 1;
      }
      value = attributesSource.slice(valueStart, index);
    }

    if (currentName === name) {
      return value;
    }
  }

  return null;
}

function forEachHtmlScriptElement(html, visitor) {
  const lower = html.toLowerCase();
  let searchIndex = 0;

  while (searchIndex < html.length) {
    const openStart = lower.indexOf('<script', searchIndex);
    if (openStart === -1) {
      return;
    }
    if (!isHtmlTagBoundary(lower[openStart + 7])) {
      searchIndex = openStart + 7;
      continue;
    }

    const openEnd = findHtmlTagEnd(html, openStart);
    if (openEnd === -1) {
      searchIndex = openStart + 7;
      continue;
    }

    const closeStart = findScriptCloseTagStart(lower, openEnd + 1);
    if (closeStart === -1) {
      searchIndex = openStart + 7;
      continue;
    }

    const closeEnd = findHtmlTagEnd(html, closeStart);
    if (closeEnd === -1) {
      searchIndex = closeStart + 8;
      continue;
    }

    const element = {
      attributesSource: html.slice(openStart + 7, openEnd),
      content: html.slice(openEnd + 1, closeStart),
      fullMatch: html.slice(openStart, closeEnd + 1),
      start: openStart,
      end: closeEnd + 1,
    };

    if (visitor(element) === false) {
      return;
    }

    searchIndex = closeEnd + 1;
  }
}

function findFirstHtmlScriptElementByType(html, type) {
  let found = null;

  forEachHtmlScriptElement(html, (element) => {
    const scriptType = getHtmlAttributeValue(element.attributesSource, 'type');
    if ((scriptType ?? '').toLowerCase() !== type) {
      return true;
    }

    found = element;
    return false;
  });

  return found;
}

/**
 * Secure path resolution:
 * - Strip leading slashes to treat URL as relative
 * - Use path.resolve for normalization
 * - Check containment using realpath-resolved rootDir + path.sep
 */
function resolvePath(urlPath) {
  // Decode and clean the path
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  } catch {
    return null;
  }

  // Remove leading slashes to always treat as relative path
  const relativePath = decoded.replace(/^\/+/, '').replace(/\\/g, '/');

  // Resolve to absolute path
  const fsPath = path.resolve(rootDirAbs, relativePath);
  return normalizeServedPath(fsPath);
}

function safeDecodeUrlPath(url) {
  try {
    return decodeURIComponent(url.split('?')[0].split('#')[0]);
  } catch {
    return null;
  }
}

function getRequestPath(url) {
  return safeDecodeUrlPath(url);
}

function normalizeHtmlRequestPath(requestPath) {
  return requestPath.endsWith('/') ? `${requestPath}index.html` : requestPath;
}

function resolveSpaFallbackPath(requestPath) {
  const normalized = requestPath.split('?')[0].split('#')[0];
  if (!normalized.startsWith('/')) return null;
  if (path.extname(normalized)) return null;

  const parts = normalized.split('/').filter(Boolean);
  while (parts.length > 0) {
    const candidate = `/${parts.join('/')}/index.html`;
    const candidateFsPath = resolvePath(candidate);
    if (candidateFsPath && fs.existsSync(candidateFsPath)) {
      return { requestPath: candidate, fsPath: candidateFsPath };
    }
    parts.pop();
  }

  const rootIndex = resolvePath('/index.html');
  if (rootIndex && fs.existsSync(rootIndex)) {
    return { requestPath: '/index.html', fsPath: rootIndex };
  }

  return null;
}

function shouldInjectBindings(requestPath, htmlContent = '') {
  if (distMode) return false;

  // Inject bindings for playground and module-based pages.
  const normalizedPath = normalizeHtmlRequestPath(requestPath);
  if (!normalizedPath.endsWith('.html')) return false;

  // Respect existing import maps that already define "dalila".
  const hasImportMap = /<script[^>]*type=["']importmap["'][^>]*>/i.test(htmlContent);
  const mapsDalila = /"dalila"\s*:/.test(htmlContent);
  if (hasImportMap && mapsDalila) return false;

  if (isDalilaRepo) {
    // Playground uses special full injection path.
    if (normalizedPath === '/examples/playground/index.html') return true;
    // Any HTML entry with module scripts may import Dalila bare specifiers.
    return /<script[^>]*type=["']module["'][^>]*>/i.test(htmlContent);
  }

  // User project mode keeps root-only behavior.
  return normalizedPath === '/index.html';
}

function resolveProjectSourceDir(projectRoot) {
  const defaultSourceDir = fs.existsSync(path.join(projectRoot, 'src'))
    ? path.join(projectRoot, 'src')
    : projectRoot;
  if (!ts) return defaultSourceDir;

  try {
    const configPath = ts.findConfigFile(projectRoot, ts.sys.fileExists, 'tsconfig.json');
    if (!configPath) return defaultSourceDir;

    let unrecoverableDiagnostic = null;
    const parsed = ts.getParsedCommandLineOfConfigFile(
      configPath,
      {},
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic(diagnostic) {
          unrecoverableDiagnostic = diagnostic;
        },
      }
    );

    if (unrecoverableDiagnostic || !parsed) {
      return defaultSourceDir;
    }

    if (typeof parsed.options?.rootDir === 'string' && parsed.options.rootDir.length > 0) {
      return path.resolve(path.dirname(configPath), parsed.options.rootDir);
    }

    if (defaultSourceDir !== projectRoot) {
      return defaultSourceDir;
    }

    const sourceDirs = parsed.fileNames
      .filter((filePath) => !filePath.endsWith('.d.ts'))
      .map((filePath) => path.dirname(path.resolve(filePath)));
    if (sourceDirs.length === 0) {
      return defaultSourceDir;
    }

    let commonDir = sourceDirs[0];
    for (const nextDir of sourceDirs.slice(1)) {
      while (commonDir !== path.dirname(commonDir)) {
        const relativePath = path.relative(commonDir, nextDir);
        if (relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))) {
          break;
        }
        commonDir = path.dirname(commonDir);
      }

      const relativePath = path.relative(commonDir, nextDir);
      if (relativePath !== '' && (relativePath.startsWith('..') || path.isAbsolute(relativePath))) {
        return defaultSourceDir;
      }
    }

    return commonDir;
  } catch {
    return defaultSourceDir;
  }
}

function toProjectRequestPath(projectRoot, targetAbsPath) {
  const relativePath = path.relative(projectRoot, targetAbsPath);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return '/';
  }

  return `/${relativePath.replace(/\\/g, '/')}`;
}

function ensureTrailingSlash(urlPath) {
  return urlPath.endsWith('/') ? urlPath : `${urlPath}/`;
}

function createImportMapEntries(dalilaPath, sourceDirPath = '/src/') {
  return {
    'dalila': `${dalilaPath}/index.js`,
    'dalila/core': `${dalilaPath}/core/index.js`,
    'dalila/core/scope': `${dalilaPath}/core/scope.js`,
    'dalila/core/signal': `${dalilaPath}/core/signal.js`,
    'dalila/core/observability': `${dalilaPath}/core/observability.js`,
    'dalila/core/watch': `${dalilaPath}/core/watch.js`,
    'dalila/core/when': `${dalilaPath}/core/when.js`,
    'dalila/core/match': `${dalilaPath}/core/match.js`,
    'dalila/core/for': `${dalilaPath}/core/for.js`,
    'dalila/core/html': `${dalilaPath}/core/html.js`,
    'dalila/core/dev': `${dalilaPath}/core/dev.js`,
    'dalila/core/key': `${dalilaPath}/core/key.js`,
    'dalila/core/resource': `${dalilaPath}/core/resource.js`,
    'dalila/core/query': `${dalilaPath}/core/query.js`,
    'dalila/core/mutation': `${dalilaPath}/core/mutation.js`,
    'dalila/core/scheduler': `${dalilaPath}/core/scheduler.js`,
    'dalila/core/persist': `${dalilaPath}/core/persist.js`,
    'dalila/context': `${dalilaPath}/context/index.js`,
    'dalila/context/raw': `${dalilaPath}/context/raw.js`,
    'dalila/runtime': `${dalilaPath}/runtime/index.js`,
    'dalila/runtime/bind': `${dalilaPath}/runtime/bind.js`,
    'dalila/runtime/component': `${dalilaPath}/runtime/component.js`,
    'dalila/runtime/lazy': `${dalilaPath}/runtime/lazy.js`,
    'dalila/runtime/boundary': `${dalilaPath}/runtime/boundary.js`,
    'dalila/runtime/from-html': `${dalilaPath}/runtime/fromHtml.js`,
    'dalila/runtime/html-sinks': `${dalilaPath}/runtime/html-sinks.js`,
    'dalila/router': `${dalilaPath}/router/index.js`,
    'dalila/form': `${dalilaPath}/form/index.js`,
    'dalila/http': `${dalilaPath}/http/index.js`,
    'dalila/components/ui': `${dalilaPath}/components/ui/index.js`,
    'dalila/components/ui/dialog': `${dalilaPath}/components/ui/dialog/index.js`,
    'dalila/components/ui/drawer': `${dalilaPath}/components/ui/drawer/index.js`,
    'dalila/components/ui/dropdown': `${dalilaPath}/components/ui/dropdown/index.js`,
    'dalila/components/ui/popover': `${dalilaPath}/components/ui/popover/index.js`,
    'dalila/components/ui/combobox': `${dalilaPath}/components/ui/combobox/index.js`,
    'dalila/components/ui/accordion': `${dalilaPath}/components/ui/accordion/index.js`,
    'dalila/components/ui/tabs': `${dalilaPath}/components/ui/tabs/index.js`,
    'dalila/components/ui/calendar': `${dalilaPath}/components/ui/calendar/index.js`,
    'dalila/components/ui/toast': `${dalilaPath}/components/ui/toast/index.js`,
    'dalila/components/ui/dropzone': `${dalilaPath}/components/ui/dropzone/index.js`,
    'dalila/components/ui/runtime': `${dalilaPath}/components/ui/runtime.js`,
    'dalila/components/ui/env': `${dalilaPath}/components/ui/env.js`,
    '@/': ensureTrailingSlash(sourceDirPath),
  };
}

function createImportMapScript(dalilaPath, sourceDirPath = '/src/') {
  const payload = stringifyInlineScriptPayload(
    { imports: createImportMapEntries(dalilaPath, sourceDirPath) },
    4
  );

  return `  <script type="importmap">\n${payload}\n  </script>`;
}

function mergeImportMapIntoHtml(html, dalilaPath, sourceDirPath = '/src/') {
  const importMapElement = findFirstHtmlScriptElementByType(html, 'importmap');
  if (!importMapElement) {
    return {
      html,
      merged: false,
      script: '',
    };
  }

  const existingPayload = importMapElement.content.trim() || '{}';
  let importMap;
  try {
    importMap = JSON.parse(existingPayload);
  } catch {
    return {
      html,
      merged: false,
      script: '',
    };
  }

  const existingImports = importMap && typeof importMap.imports === 'object' && importMap.imports !== null
    ? importMap.imports
    : {};
  const mergedImportMap = {
    ...importMap,
    imports: {
      ...createImportMapEntries(dalilaPath, sourceDirPath),
      ...existingImports,
    },
  };
  const payload = stringifyInlineScriptPayload(mergedImportMap, 4);
  const script = `  <script type="importmap">\n${payload}\n  </script>`;

  return {
    html: `${html.slice(0, importMapElement.start)}${html.slice(importMapElement.end)}`,
    merged: true,
    script,
  };
}

// ============================================================================
// Preload Script Detection (auto-inject for persist() with preload: true)
// ============================================================================

/**
 * Scan TypeScript files for persist() calls with preload: true
 * Returns array of { name, defaultValue, storageType }
 */
function detectPreloadScripts(baseDir) {
  const preloads = [];

  try {
    const files = findTypeScriptFiles(baseDir);

    files.forEach((file) => {
      try {
        const source = fs.readFileSync(file, 'utf8');

        // Simple regex to detect persist() with preload: true
        // Pattern: persist(signal(defaultValue), { ... preload: true ... name: 'key' ... })
        const persistRegex = /persist\s*\(\s*signal\s*(?:<[^>]+>)?\s*\(\s*['"]?([^'")]+)['"]?\s*\)\s*,\s*\{([^}]+)\}\s*\)/g;

        let match;
        while ((match = persistRegex.exec(source)) !== null) {
          const defaultValue = match[1];
          const options = match[2];

          // Check if preload: true exists
          if (!options.includes('preload') || !options.match(/preload\s*:\s*true/)) {
            continue;
          }

          // Extract name
          const nameMatch = options.match(/name\s*:\s*['"]([^'"]+)['"]/);
          if (!nameMatch) continue;

          const name = nameMatch[1];

          // Extract storage type (default: localStorage)
          let storageType = 'localStorage';
          const storageMatch = options.match(/storage\s*:\s*(\w+)/);
          if (storageMatch && storageMatch[1] === 'sessionStorage') {
            storageType = 'sessionStorage';
          }

          preloads.push({ name, defaultValue, storageType });
        }
      } catch (err) {
        // Skip file on error
      }
    });
  } catch (err) {
    console.warn('[Preload] Detection error:', err.message);
  }

  return preloads;
}

/**
 * Find all .ts files in directory (recursive)
 */
function findTypeScriptFiles(dir, files = []) {
  if (!fs.existsSync(dir)) return files;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    entries.forEach((entry) => {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        findTypeScriptFiles(fullPath, files);
      } else if (entry.isFile() && entry.name.endsWith('.ts')) {
        files.push(fullPath);
      }
    });
  } catch (err) {
    // Skip on error
  }

  return files;
}

/**
 * Generate inline preload script
 */
function generatePreloadScript(name, defaultValue, storageType = 'localStorage') {
  const safeStorageType = normalizePreloadStorageType(storageType);
  const payload = JSON.stringify({
    key: name,
    defaultValue,
    storageType: safeStorageType,
  });
  const fallbackValue = JSON.stringify(defaultValue);
  const script = `(function(){try{var p=${payload};var s=window[p.storageType];var v=s.getItem(p.key);document.documentElement.setAttribute('data-theme',v==null?p.defaultValue:JSON.parse(v))}catch(e){document.documentElement.setAttribute('data-theme',${fallbackValue})}})();`;
  return escapeInlineScriptContent(script);
}

function renderPreloadScriptTags(baseDir) {
  const preloads = detectPreloadScripts(baseDir);
  if (preloads.length === 0) return '';

  return preloads
    .map((preload) => `  <script>${generatePreloadScript(preload.name, preload.defaultValue, preload.storageType)}</script>`)
    .join('\n');
}

function injectHeadFragments(html, fragments, options = {}) {
  const content = fragments.filter(Boolean).join('\n');
  if (!content) return html;

  const headOpenMatch = html.match(/<head\b[^>]*>/i);
  const headCloseMatch = html.match(/<\/head>/i);
  if (!headOpenMatch || headOpenMatch.index == null || !headCloseMatch || headCloseMatch.index == null) {
    return `${content}\n${html}`;
  }

  const headStart = headOpenMatch.index + headOpenMatch[0].length;
  const headEnd = headCloseMatch.index;
  const headContent = html.slice(headStart, headEnd);
  const moduleScriptMatch = options.beforeModule
    ? headContent.match(/<script\b[^>]*\btype=["']module["'][^>]*>/i)
    : null;
  const stylesheetMatch = options.beforeStyles
    ? headContent.match(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/i)
    : null;
  const insertionOffset = moduleScriptMatch?.index
    ?? stylesheetMatch?.index
    ?? headContent.length;
  const insertionIndex = headStart + insertionOffset;

  return `${html.slice(0, insertionIndex)}\n${content}\n${html.slice(insertionIndex)}`;
}

function buildProjectSourceDirPath(projectRoot) {
  return toProjectRequestPath(projectRoot, resolveProjectSourceDir(projectRoot));
}

function buildProjectHeadAdditions(projectRoot, dalilaPath) {
  const sourceDir = resolveProjectSourceDir(projectRoot);
  return [
    `  <style>[d-loading]{visibility:hidden}</style>`,
    renderPreloadScriptTags(sourceDir),
    createImportMapScript(dalilaPath, buildProjectSourceDirPath(projectRoot)),
  ].filter(Boolean);
}

function buildUserProjectHeadAdditions(projectRoot, dalilaPath) {
  return buildProjectHeadAdditions(projectRoot, dalilaPath);
}

function buildRepoProjectHeadAdditions(projectRoot, dalilaPath) {
  return buildProjectHeadAdditions(projectRoot, dalilaPath);
}

// ============================================================================
// Auto-detect and add d-loading attribute
// ============================================================================

/**
 * Detect elements that need d-loading attribute (have tokens or d-* attributes)
 * and automatically add d-loading to them
 */
function addLoadingAttributes(html) {
  // Match elements with:
  // 1. Text containing {tokens}
  // 2. Attributes like d-on-*, d-when, d-match

  // Simple regex-based approach: find elements with tokens or d-* attributes
  // Look for opening tags that contain either {tokens} in their content or d-* attributes

  // Strategy: Find the root element that will be bound (usually has class="container" or id="app")
  // and add d-loading to it

  // For playground, we know it's .container
  // For a more general solution, we could detect elements with many {tokens} or d-* attributes

  let output = html;

  // Pattern: <div class="container"> (without d-loading already)
  // Replace with: <div class="container" d-loading>
  output = output.replace(
    /(<div\s+class="container"(?![^>]*d-loading)[^>]*)(>)/i,
    '$1 d-loading$2'
  );

  // Also handle id="app" pattern
  output = output.replace(
    /(<div\s+id="app"(?![^>]*d-loading)[^>]*)(>)/i,
    '$1 d-loading$2'
  );

  return output;
}

// ============================================================================
// Binding Injection (for HTML files that need runtime bindings)
// ============================================================================
function injectBindings(html, options = {}) {
  const isPlaygroundPage = options.isPlaygroundPage === true;
  // Different paths for dalila repo vs user projects
  const dalilaPath = isDalilaRepo ? '/dist' : '/node_modules/dalila/dist';
  const sourceDirPath = buildProjectSourceDirPath(projectDir);
  const mergedImportMap = mergeImportMapIntoHtml(html, dalilaPath, sourceDirPath);
  const importMap = mergedImportMap.merged
    ? mergedImportMap.script
    : createImportMapScript(dalilaPath, sourceDirPath);

  // For user projects, inject import map + HMR script
  if (!isDalilaRepo) {
    let output = addLoadingAttributes(mergedImportMap.html);

    // Smart HMR script for user projects
    const hmrScript = `
  <script type="module">
    // HMR: Use native bind() HMR support
    let disposeBinding = null;

    const rebind = async () => {
      const hmrContext = window.__dalila_hmr_context;
      if (!hmrContext) {
        console.warn('[HMR] Cannot rebind: bind() not called yet');
        return;
      }

      try {
        const { bind } = await import('${dalilaPath}/runtime/index.js');
        const { root, ctx, options } = hmrContext;

        // Dispose old bindings
        if (disposeBinding) {
          try { disposeBinding(); } catch (e) {}
        }

        // Rebind with preserved context
        disposeBinding = bind(root, ctx, options);
        console.log('[HMR] Rebound successfully');
      } catch (e) {
        console.error('[HMR] Rebind failed:', e);
      }
    };

    const patchNode = (current, next) => {
      if (!current || !next) return;

      if (current.nodeType !== next.nodeType) {
        current.replaceWith(next.cloneNode(true));
        return;
      }

      if (current.nodeType === Node.TEXT_NODE) {
        if (current.data !== next.data) current.data = next.data;
        return;
      }

      if (current.nodeType === Node.ELEMENT_NODE) {
        if (current.tagName !== next.tagName) {
          current.replaceWith(next.cloneNode(true));
          return;
        }

        const currentAttrs = current.getAttributeNames();
        const nextAttrs = next.getAttributeNames();

        currentAttrs.forEach((name) => {
          if (!nextAttrs.includes(name)) current.removeAttribute(name);
        });
        nextAttrs.forEach((name) => {
          const value = next.getAttribute(name);
          if (current.getAttribute(name) !== value) {
            if (value === null) {
              current.removeAttribute(name);
            } else {
              current.setAttribute(name, value);
            }
          }
        });

        const currentChildren = Array.from(current.childNodes);
        const nextChildren = Array.from(next.childNodes);
        const max = Math.max(currentChildren.length, nextChildren.length);

        for (let i = 0; i < max; i += 1) {
          const currentChild = currentChildren[i];
          const nextChild = nextChildren[i];

          if (!currentChild && nextChild) {
            current.appendChild(nextChild.cloneNode(true));
          } else if (currentChild && !nextChild) {
            currentChild.remove();
          } else if (currentChild && nextChild) {
            patchNode(currentChild, nextChild);
          }
        }
      }
    };

    const refreshStyles = () => {
      const links = document.querySelectorAll('link[rel="stylesheet"]');
      links.forEach((link) => {
        const url = new URL(link.href);
        url.searchParams.set('v', String(Date.now()));
        link.href = url.toString();
      });
    };

    const refreshMarkup = async () => {
      const res = await fetch(window.location.pathname, { cache: 'no-store' });
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');

      // Find root element (prefer #app, fallback to body)
      const nextRoot = doc.querySelector('#app') || doc.body;
      const currentRoot = document.querySelector('#app') || document.body;

      if (nextRoot && currentRoot) {
        patchNode(currentRoot, nextRoot);
        console.log('[HMR] HTML patched');

        // Rebind after patching
        rebind();
      }
    };

    if (window.__dalila_hmr) {
      window.__dalila_hmr.close();
    }
    const hmr = new EventSource('/__hmr');
    window.__dalila_hmr = hmr;

    hmr.addEventListener('update', async (event) => {
      let file = '';
      try {
        const payload = JSON.parse(event.data || '{}');
        file = payload.file || '';
      } catch {
        file = '';
      }

      console.log('[HMR] File changed:', file);

      if (file.endsWith('.css')) {
        refreshStyles();
        console.log('[HMR] CSS reloaded');
        return;
      }

      if (file.endsWith('.html')) {
        await refreshMarkup();
        return;
      }

      // For TS/JS files, full reload is needed to re-import modules
      console.log('[HMR] Reloading page...');
      location.reload();
    });

    hmr.onerror = () => {
      console.warn('[HMR] Connection lost, will retry...');
    };
  </script>`;

    const headAdditions = buildUserProjectHeadAdditions(projectDir, dalilaPath)
      .filter((fragment) => !mergedImportMap.merged || !/type=["']importmap["']/i.test(fragment));
    if (importMap) {
      headAdditions.push(importMap);
    }
    output = injectHeadFragments(output, headAdditions, {
      beforeModule: true,
      beforeStyles: true,
    });
    output = injectHeadFragments(output, [hmrScript], {
      beforeModule: true,
      beforeStyles: true,
    });

    return output;
  }

  // Dalila repo: only inject import map for non-playground pages
  if (!isPlaygroundPage) {
    return injectHeadFragments(html, [importMap], {
      beforeModule: true,
      beforeStyles: true,
    });
  }

  // Dalila repo: full playground injection
  const script = `
  <script type="module">
    import { bind } from 'dalila/runtime';
    import { createController } from '/examples/playground/script.ts';

    (async () => {
      try {
        const ctx = await createController();
        const rootSelector = '.container';

        // Current dispose function
        let dispose = null;

        const getRoot = () => document.querySelector(rootSelector) || document.body;

        // Bind the template using the shared runtime
        const bindAll = () => {
          // Dispose previous bindings
          if (dispose) {
            try { dispose(); } catch (e) { console.warn('[Dalila] Dispose error:', e); }
          }

          const root = getRoot();
          if (!root) return;

          // Use the shared bind() function
          dispose = bind(root, ctx);
        };

        const refreshStyles = () => {
          const links = document.querySelectorAll('link[rel="stylesheet"]');
          links.forEach((link) => {
            if (!link.href.includes('/examples/playground/style.css')) return;
            const url = new URL(link.href);
            url.searchParams.set('v', String(Date.now()));
            link.href = url.toString();
          });
        };

        const patchNode = (current, next) => {
          if (!current || !next) return;

          if (current.nodeType !== next.nodeType) {
            current.replaceWith(next.cloneNode(true));
            return;
          }

          if (current.nodeType === Node.TEXT_NODE) {
            if (current.data !== next.data) current.data = next.data;
            return;
          }

          if (current.nodeType === Node.ELEMENT_NODE) {
            if (current.tagName !== next.tagName) {
              current.replaceWith(next.cloneNode(true));
              return;
            }

            const currentAttrs = current.getAttributeNames();
            const nextAttrs = next.getAttributeNames();

            currentAttrs.forEach((name) => {
              if (!nextAttrs.includes(name)) current.removeAttribute(name);
            });
            nextAttrs.forEach((name) => {
              const value = next.getAttribute(name);
              if (current.getAttribute(name) !== value) {
                if (value === null) {
                  current.removeAttribute(name);
                } else {
                  current.setAttribute(name, value);
                }
              }
            });

            const currentChildren = Array.from(current.childNodes);
            const nextChildren = Array.from(next.childNodes);
            const max = Math.max(currentChildren.length, nextChildren.length);

            for (let i = 0; i < max; i += 1) {
              const currentChild = currentChildren[i];
              const nextChild = nextChildren[i];

              if (!currentChild && nextChild) {
                current.appendChild(nextChild.cloneNode(true));
              } else if (currentChild && !nextChild) {
                currentChild.remove();
              } else if (currentChild && nextChild) {
                patchNode(currentChild, nextChild);
              }
            }
          }
        };

        const refreshMarkup = async () => {
          const res = await fetch('/examples/playground/index.html', { cache: 'no-store' });
          const html = await res.text();
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const nextContainer = doc.querySelector(rootSelector);
          const container = getRoot();
          if (nextContainer && container) {
            patchNode(container, nextContainer);
            bindAll();
          }
        };

        bindAll();

        // HMR: close previous EventSource before creating new one
        if (window.__dalila_hmr) {
          window.__dalila_hmr.close();
        }
        const hmr = new EventSource('/__hmr');
        window.__dalila_hmr = hmr;

        hmr.addEventListener('update', async (event) => {
          let file = '';
          try {
            const payload = JSON.parse(event.data || '{}');
            file = payload.file || '';
          } catch {
            file = '';
          }

          if (file.endsWith('.css')) {
            refreshStyles();
            return;
          }

          await refreshMarkup();
          if (file.endsWith('.ts')) refreshStyles();
        });

        hmr.onerror = () => {
          console.warn('[HMR] Connection lost, will retry...');
        };
      } catch (error) {
        console.error('[Dalila] Failed to initialize:', error);
      }
    })();
  </script>`;

  // Auto-add d-loading to root elements
  let output = addLoadingAttributes(html);

  // Detect and inject preload scripts
  output = injectHeadFragments(output, [
    `  <style>[d-loading]{visibility:hidden}</style>`,
    renderPreloadScriptTags(path.join(projectDir, 'examples', 'playground')),
    importMap,
  ], {
    beforeModule: true,
    beforeStyles: true,
  });

  if (output.includes('</body>')) {
    return output.replace('</body>', `${script}\n</body>`);
  }

  return `${output}\n${script}`;
}

// ============================================================================
// HTTP Server
// ============================================================================
const server = http.createServer((req, res) => {
  if (!req.url) {
    send(res, 400, 'Bad Request');
    return;
  }

  if (req.url.startsWith('/api/rabbit')) {
    const upstream = 'https://rabbit-api-two.vercel.app/api/random';
    const upstreamReq = https.request(upstream, (upstreamRes) => {
      const status = upstreamRes.statusCode || 500;
      const headers = {
        'Content-Type': upstreamRes.headers['content-type'] || 'application/json; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
      };
      writeResponseHead(res, status, headers);
      upstreamRes.pipe(res);
    });

    upstreamReq.on('error', () => {
      send(res, 502, 'Bad Gateway');
    });

    upstreamReq.end();
    return;
  }

  // SSE endpoint for HMR
  if (req.url.startsWith('/__hmr')) {
    writeResponseHead(res, 200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    });
    res.write(':ok\n\n'); // Initial comment to establish connection
    hmrClients.add(res);

    req.on('close', () => {
      hmrClients.delete(res);
    });

    req.on('error', () => {
      hmrClients.delete(res);
    });
    return;
  }

  const requestPath = getRequestPath(req.url);
  if (!requestPath) {
    send(res, 400, 'Bad Request');
    return;
  }
  const effectivePath =
    requestPath === '/' || requestPath === '/index.html' ? defaultEntry : requestPath;
  let resolvedRequestPath = effectivePath;
  const fetchModeHeader = req.headers['sec-fetch-mode'];
  const fetchDestHeader = req.headers['sec-fetch-dest'];
  const fetchMode = Array.isArray(fetchModeHeader) ? fetchModeHeader[0] : fetchModeHeader;
  const fetchDest = Array.isArray(fetchDestHeader) ? fetchDestHeader[0] : fetchDestHeader;
  const isNavigationRequest = fetchMode === 'navigate' || fetchDest === 'document';
  const isScriptRequest = fetchDest === 'script';
  const fsPath = resolvePath(effectivePath);

  if (!fsPath) {
    send(res, 403, 'Forbidden');
    return;
  }

  let targetPath = fsPath;
  try {
    const target = statServedPath(targetPath);
    targetPath = target.safePath;
    const stat = target.stat;
    if (stat.isDirectory()) {
      // Redirect directory URLs without trailing slash to include it
      if (!requestPath.endsWith('/')) {
        writeResponseHead(res, 301, { 'Location': requestPath + '/' });
        res.end();
        return;
      }
      const indexPath = joinServedPath(targetPath, 'index.html');
      if (!indexPath) {
        send(res, 403, 'Forbidden');
        return;
      }
      targetPath = indexPath;
    }
  } catch (err) {
    if (err && err.code === FORBIDDEN_PATH_ERROR_CODE) {
      send(res, 403, 'Forbidden');
      return;
    }

    // If .js file not found, try .ts alternative
    if (targetPath.endsWith('.js')) {
      const tsPath = replaceServedPathExtension(targetPath, '.js', '.ts');
      if (tsPath && existsServedPath(tsPath)) {
        targetPath = tsPath;
      } else {
        send(res, 404, 'Not Found');
        return;
      }
    } else {
      // Extensionless import — try .ts, then .js
      const tsPath = appendServedPathExtension(targetPath, '.ts');
      const jsPath = appendServedPathExtension(targetPath, '.js');
      if (!path.extname(targetPath) && isScriptRequest && tsPath && existsServedPath(tsPath)) {
        targetPath = tsPath;
      } else if (!path.extname(targetPath) && isScriptRequest && jsPath && existsServedPath(jsPath)) {
        targetPath = jsPath;
      } else {
        const spaFallback = resolveSpaFallbackPath(requestPath);
        if (spaFallback) {
          targetPath = spaFallback.fsPath;
          resolvedRequestPath = spaFallback.requestPath;
        } else {
          send(res, 404, 'Not Found');
          return;
        }
      }
    }
  }

  // Raw import — serve file as `export default` JS module.
  // Triggered by ?raw suffix OR .html imported as script/module.
  const isRawQuery = req.url && req.url.includes('?raw');
  const isHtmlModuleImport = targetPath.endsWith('.html')
    && isScriptRequest
    && !isNavigationRequest;
  if (isRawQuery || isHtmlModuleImport) {
    readServedFile(targetPath, 'utf8', (err, source) => {
      if (err) {
        if (err.code === FORBIDDEN_PATH_ERROR_CODE) {
          send(res, 403, 'Forbidden');
          return;
        }
        send(res, err.code === 'ENOENT' ? 404 : 500, err.code === 'ENOENT' ? 'Not Found' : 'Error');
        return;
      }
      const escaped = source.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
      writeResponseHead(res, 200, {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      });
      res.end(`export default \`${escaped}\`;`);
    });
    return;
  }

  // TypeScript transpilation (only if ts available)
  if (targetPath.endsWith('.ts') && ts) {
    readServedFile(targetPath, 'utf8', (err, source) => {
      if (err) {
        if (err.code === FORBIDDEN_PATH_ERROR_CODE) {
          send(res, 403, 'Forbidden');
          return;
        }
        if (err.code === 'ENOENT' || err.code === 'EISDIR') {
          send(res, 404, 'Not Found');
          return;
        }
        send(res, 500, 'Internal Server Error');
        return;
      }

      try {
        const output = ts.transpileModule(source, {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2020,
          },
          fileName: targetPath,
        });

        // No-cache headers for dev
        writeResponseHead(res, 200, {
          'Content-Type': 'text/javascript; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Pragma': 'no-cache',
        });
        res.end(output.outputText);
      } catch (transpileErr) {
        console.error('TypeScript transpile error:', transpileErr);
        send(res, 500, 'TypeScript Compilation Error');
      }
    });
    return;
  }

  // Static file serving
  readServedFile(targetPath, null, (err, data) => {
    if (err) {
      if (err.code === FORBIDDEN_PATH_ERROR_CODE) {
        send(res, 403, 'Forbidden');
        return;
      }
      if (err.code === 'ENOENT' || err.code === 'EISDIR') {
        const spaFallback = resolveSpaFallbackPath(requestPath);
        if (spaFallback) {
          targetPath = spaFallback.fsPath;
          resolvedRequestPath = spaFallback.requestPath;
          readServedFile(targetPath, null, (fallbackErr, fallbackData) => {
            if (fallbackErr) {
              if (fallbackErr.code === FORBIDDEN_PATH_ERROR_CODE) {
                send(res, 403, 'Forbidden');
                return;
              }
              send(res, 404, 'Not Found');
              return;
            }

            const htmlSource = fallbackData.toString('utf8');
            const headers = {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'no-store, no-cache, must-revalidate',
              'Pragma': 'no-cache',
            };

            if (shouldInjectBindings(resolvedRequestPath, htmlSource)) {
              const html = injectBindings(htmlSource, {
                isPlaygroundPage: normalizeHtmlRequestPath(resolvedRequestPath) === '/examples/playground/index.html',
              });
              writeResponseHead(res, 200, headers);
              res.end(html);
              return;
            }

            writeResponseHead(res, 200, headers);
            res.end(fallbackData);
          });
          return;
        }

        send(res, 404, 'Not Found');
        return;
      }
      send(res, 500, 'Internal Server Error');
      return;
    }

    const ext = path.extname(targetPath).toLowerCase();
    const contentType = contentTypes[ext] || 'application/octet-stream';

    // Build cache headers
    const headers = { 'Content-Type': contentType };
    if (noCacheExtensions.has(ext)) {
      headers['Cache-Control'] = 'no-store, no-cache, must-revalidate';
      headers['Pragma'] = 'no-cache';
    }

    if (ext === '.html') {
      const htmlSource = data.toString('utf8');
      if (shouldInjectBindings(resolvedRequestPath, htmlSource)) {
        const html = injectBindings(htmlSource, {
          isPlaygroundPage: normalizeHtmlRequestPath(resolvedRequestPath) === '/examples/playground/index.html',
        });
        writeResponseHead(res, 200, headers);
        res.end(html);
        return;
      }
    }

    writeResponseHead(res, 200, headers);
    res.end(data);
  });
});

// ============================================================================
// File Watcher (cross-platform)
// ============================================================================
const RECURSIVE_WATCH_IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  'coverage',
  'playwright-report',
  'test-results',
]);
const ROOT_WATCH_IGNORED_NAMES = new Set([
  'src',
  ...RECURSIVE_WATCH_IGNORED_DIRS,
]);

function collectTopLevelRecursiveWatchDirs(baseDir) {
  if (!fs.existsSync(baseDir)) return [];

  try {
    return fs.readdirSync(baseDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !ROOT_WATCH_IGNORED_NAMES.has(entry.name))
      .map((entry) => path.join(baseDir, entry.name));
  } catch {
    return [];
  }
}

function createWatchTargets() {
  if (distMode) return [];

  if (isDalilaRepo) {
    return [{ dir: path.join(rootDir, 'examples', 'playground'), recursive: true }];
  }

  return [
    { dir: path.join(projectDir, 'src'), recursive: true },
    { dir: projectDir, recursive: false, watchChildDirsRecursive: true },
  ];
}

const watchTargets = createWatchTargets();

const watchers = [];
const watchedDirs = new Set();
const watcherEntries = new Map();

function unwatchDirectoryTree(dir, state = { watchedDirs, watcherEntries }) {
  const resolvedDir = path.resolve(dir);
  for (const watchedDir of Array.from(state.watchedDirs)) {
    if (watchedDir !== resolvedDir && !watchedDir.startsWith(resolvedDir + path.sep)) {
      continue;
    }

    const watcher = state.watcherEntries.get(watchedDir);
    if (watcher) {
      state.watcherEntries.delete(watchedDir);
      try {
        if (typeof watcher.close === 'function') watcher.close();
      } catch { /* ignore */ }
    }

    state.watchedDirs.delete(watchedDir);
  }
}

/**
 * Safe SSE broadcast with error handling
 */
const notifyHmr = (filename) => {
  if (hmrTimer) clearTimeout(hmrTimer);
  hmrTimer = setTimeout(() => {
    const payload = `event: update\ndata: ${JSON.stringify({ file: filename })}\n\n`;
    const deadClients = [];

    hmrClients.forEach((client) => {
      try {
        const ok = client.write(payload);
        if (!ok) {
          deadClients.push(client);
        }
      } catch (err) {
        console.warn('[HMR] Client write error:', err.message);
        deadClients.push(client);
      }
    });

    // Remove dead clients
    deadClients.forEach((client) => {
      hmrClients.delete(client);
      try { client.end(); } catch { /* ignore */ }
    });
  }, 50);
};

/**
 * Use native fs.watch for file watching.
 */
function setupWatcher() {
  // Manual directory walking + fs.watch on each file/subdir
  // fs.watch with recursive:true doesn't work reliably on Linux
  console.log('[Watcher] Using fs.watch');

  function shouldWatchRecursiveDir(name) {
    return !name.startsWith('.') && !RECURSIVE_WATCH_IGNORED_DIRS.has(name);
  }

  function watchDirectory(dir, options = {}) {
    if (!fs.existsSync(dir)) return;
    const resolvedDir = path.resolve(dir);
    if (watchedDirs.has(resolvedDir)) return;

    try {
      // Watch the directory itself
      const watcher = fs.watch(dir, (eventType, filename) => {
        if (!fs.existsSync(dir)) {
          unwatchDirectoryTree(resolvedDir);
          return;
        }

        if (!filename) return;
        const filenameValue = filename.toString();
        if (filenameValue.endsWith('.map')) return;
        if (!options.recursive && ROOT_WATCH_IGNORED_NAMES.has(filenameValue)) return;
        notifyHmr(filenameValue);

        // Check if a new subdirectory was added
        if (options.recursive && eventType === 'rename') {
          if (!shouldWatchRecursiveDir(filenameValue)) return;
          const fullPath = path.join(dir, filenameValue);
          try {
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
              watchDirectory(fullPath, options);
            }
          } catch {
            unwatchDirectoryTree(fullPath);
          }
        } else if (options.watchChildDirsRecursive && eventType === 'rename') {
          if (ROOT_WATCH_IGNORED_NAMES.has(filenameValue) || filenameValue.startsWith('.')) return;
          const fullPath = path.join(dir, filenameValue);
          try {
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
              watchDirectory(fullPath, { recursive: true });
            }
          } catch {
            unwatchDirectoryTree(fullPath);
          }
        }
      });
      watcher.on('error', () => {
        unwatchDirectoryTree(resolvedDir);
      });
      watcher.on('close', () => {
        watcherEntries.delete(resolvedDir);
        watchedDirs.delete(resolvedDir);
      });
      watchers.push(watcher);
      watcherEntries.set(resolvedDir, watcher);
      watchedDirs.add(resolvedDir);

      // Watch subdirectories recursively
      if (options.recursive) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        entries.forEach((entry) => {
          if (entry.isDirectory() && shouldWatchRecursiveDir(entry.name)) {
            watchDirectory(path.join(dir, entry.name), options);
          }
        });
      } else if (options.watchChildDirsRecursive) {
        const childDirs = collectTopLevelRecursiveWatchDirs(dir);
        childDirs.forEach((childDir) => {
          watchDirectory(childDir, { recursive: true });
        });
      }
    } catch (err) {
      console.warn('[Watcher] Could not watch:', dir, err.message);
    }
  }

  watchTargets.forEach((target) => watchDirectory(target.dir, target));
}

// ============================================================================
// Keepalive ping for SSE connections
// ============================================================================
function startKeepalive() {
  keepaliveInterval = setInterval(() => {
    const deadClients = [];

    hmrClients.forEach((client) => {
      try {
        // Send SSE comment as keepalive
        const ok = client.write(':ping\n\n');
        if (!ok) {
          deadClients.push(client);
        }
      } catch {
        deadClients.push(client);
      }
    });

    deadClients.forEach((client) => {
      hmrClients.delete(client);
      try { client.end(); } catch { /* ignore */ }
    });
  }, 30000); // Every 30 seconds
}

// ============================================================================
// Cleanup
// ============================================================================
const cleanup = () => {
  if (hmrTimer) clearTimeout(hmrTimer);
  if (keepaliveInterval) clearInterval(keepaliveInterval);

  watchers.forEach((w) => {
    try {
      if (typeof w.close === 'function') w.close();
    } catch { /* ignore */ }
  });
  watcherEntries.clear();
  watchedDirs.clear();

  hmrClients.forEach((client) => {
    try { client.end(); } catch { /* ignore */ }
  });
  hmrClients.clear();

  server.close();
};

module.exports = {
  resolveServerConfig,
  resolvePath,
  getRequestPath,
  safeDecodeUrlPath,
  createImportMapEntries,
  createImportMapScript,
  mergeImportMapIntoHtml,
  detectPreloadScripts,
  buildUserProjectHeadAdditions,
  injectHeadFragments,
  collectTopLevelRecursiveWatchDirs,
  createWatchTargets,
  unwatchDirectoryTree,
  generatePreloadScript,
  createSecurityHeaders,
};

if (require.main === module) {
  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });

  // ============================================================================
  // Startup
  // ============================================================================
  if (distMode && !fs.existsSync(rootDir)) {
    console.error('[Dalila] dist directory not found. Run "npm run build" before "dalila-dev --dist".');
    process.exit(1);
  }

  if (!distMode) {
    setupWatcher();
    startKeepalive();
  }

  server.listen(port, () => {
    console.log('');
    console.log(`  🐰✂️  Dalila ${distMode ? 'preview server' : 'dev server'}`);
    console.log(`        http://localhost:${port}`);
    console.log('');
  });
}
