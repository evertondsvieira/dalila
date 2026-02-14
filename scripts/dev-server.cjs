#!/usr/bin/env node
/* Dalila Development Server */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// ============================================================================
// Configuration
// ============================================================================
const rootDir = fs.realpathSync(process.cwd());
const port = Number(process.env.PORT) || 4242;

// Detect if running in dalila repo or user project
const isDalilaRepo = fs.existsSync(path.join(rootDir, 'src', 'core', 'signal.ts'));
const defaultEntry = isDalilaRepo ? '/examples/playground/index.html' : '/index.html';

// Resolve dalila dist path
const dalilaDistPath = isDalilaRepo
  ? path.join(rootDir, 'dist')
  : path.join(rootDir, 'node_modules', 'dalila', 'dist');

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
function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(body);
}

/**
 * Secure path resolution:
 * - Strip leading slashes to treat URL as relative
 * - Use path.resolve for normalization
 * - Check containment using realpath-resolved rootDir + path.sep
 */
function resolvePath(urlPath) {
  // Decode and clean the path
  const decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);

  // Remove leading slashes to always treat as relative path
  const relativePath = decoded.replace(/^\/+/, '').replace(/\\/g, '/');

  // Resolve to absolute path
  const fsPath = path.resolve(rootDir, relativePath);

  // Normalize for comparison (handles .., ., etc.)
  const normalizedPath = path.normalize(fsPath);

  // Security check: must be within rootDir
  // Use startsWith with path.sep to prevent /root matching /rootkit
  if (!normalizedPath.startsWith(rootDir + path.sep) && normalizedPath !== rootDir) {
    return null;
  }

  return normalizedPath;
}

function getRequestPath(url) {
  return decodeURIComponent(url.split('?')[0].split('#')[0]);
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
  // Minified inline script (same as createThemeScript)
  return `(function(){try{var v=${storageType}.getItem('${name}');document.documentElement.setAttribute('data-theme',v?JSON.parse(v):'${defaultValue}')}catch(e){document.documentElement.setAttribute('data-theme','${defaultValue}')}})();`;
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
function injectBindings(html, requestPath) {
  const normalizedPath = normalizeHtmlRequestPath(requestPath);
  // Different paths for dalila repo vs user projects
  const dalilaPath = isDalilaRepo ? '/dist' : '/node_modules/dalila/dist';

  const importMap = `
  <script type="importmap">
    {
      "imports": {
        "dalila": "${dalilaPath}/index.js",
        "dalila/core": "${dalilaPath}/core/index.js",
        "dalila/context": "${dalilaPath}/context/index.js",
        "dalila/context/raw": "${dalilaPath}/context/raw.js",
        "dalila/runtime": "${dalilaPath}/runtime/index.js",
        "dalila/router": "${dalilaPath}/router/index.js",
        "dalila/form": "${dalilaPath}/form/index.js",
        "dalila/components/ui": "${dalilaPath}/components/ui/index.js",
        "dalila/components/ui/dialog": "${dalilaPath}/components/ui/dialog/index.js",
        "dalila/components/ui/drawer": "${dalilaPath}/components/ui/drawer/index.js",
        "dalila/components/ui/dropdown": "${dalilaPath}/components/ui/dropdown/index.js",
        "dalila/components/ui/popover": "${dalilaPath}/components/ui/popover/index.js",
        "dalila/components/ui/combobox": "${dalilaPath}/components/ui/combobox/index.js",
        "dalila/components/ui/accordion": "${dalilaPath}/components/ui/accordion/index.js",
        "dalila/components/ui/tabs": "${dalilaPath}/components/ui/tabs/index.js",
        "dalila/components/ui/calendar": "${dalilaPath}/components/ui/calendar/index.js",
        "dalila/components/ui/toast": "${dalilaPath}/components/ui/toast/index.js",
        "dalila/components/ui/dropzone": "${dalilaPath}/components/ui/dropzone/index.js",
        "@/": "/src/"
      }
    }
  </script>`;

  // For user projects, inject import map + HMR script
  if (!isDalilaRepo) {
    let output = addLoadingAttributes(html);

    // FOUC prevention CSS
    const foucPreventionCSS = `  <style>[d-loading]{visibility:hidden}</style>`;

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

    // Inject HMR + import map in HEAD (HMR must load before user scripts)
    if (output.includes('</head>')) {
      output = output.replace('</head>', `${foucPreventionCSS}\n${importMap}\n${hmrScript}\n</head>`);
    } else {
      output = `${foucPreventionCSS}\n${importMap}\n${hmrScript}\n${output}`;
    }

    return output;
  }

  // Dalila repo: only inject import map for non-playground pages
  if (normalizedPath !== '/examples/playground/index.html') {
    if (html.includes('</head>')) {
      return html.replace('</head>', `${importMap}\n</head>`);
    }
    return `${importMap}\n${html}`;
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
  const preloads = detectPreloadScripts(path.join(rootDir, 'examples', 'playground'));
  let preloadScripts = '';

  if (preloads.length > 0) {
    preloadScripts = preloads
      .map((p) => `  <script>${generatePreloadScript(p.name, p.defaultValue, p.storageType)}</script>`)
      .join('\n');
  }

  // FOUC prevention: hide elements with d-loading until bind() completes
  const foucPreventionCSS = `  <style>[d-loading]{visibility:hidden}</style>`;

  if (output.includes('</head>')) {
    // Inject: FOUC CSS -> Preload scripts -> Import map
    if (preloadScripts) {
      output = output.replace('</head>', `${foucPreventionCSS}\n${preloadScripts}\n${importMap}\n</head>`);
    } else {
      output = output.replace('</head>', `${foucPreventionCSS}\n${importMap}\n</head>`);
    }
  } else {
    output = `${foucPreventionCSS}\n${preloadScripts}\n${importMap}\n${output}`;
  }

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
      res.writeHead(status, headers);
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
    res.writeHead(200, {
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
    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
      // Redirect directory URLs without trailing slash to include it
      if (!requestPath.endsWith('/')) {
        res.writeHead(301, { 'Location': requestPath + '/' });
        res.end();
        return;
      }
      targetPath = path.join(targetPath, 'index.html');
    }
  } catch {
    // If .js file not found, try .ts alternative
    if (targetPath.endsWith('.js')) {
      const tsPath = targetPath.replace(/\.js$/, '.ts');
      if (fs.existsSync(tsPath)) {
        targetPath = tsPath;
      } else {
        send(res, 404, 'Not Found');
        return;
      }
    } else {
      // Extensionless import — try .ts, then .js
      const tsPath = targetPath + '.ts';
      const jsPath = targetPath + '.js';
      if (!path.extname(targetPath) && isScriptRequest && fs.existsSync(tsPath)) {
        targetPath = tsPath;
      } else if (!path.extname(targetPath) && isScriptRequest && fs.existsSync(jsPath)) {
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
    fs.readFile(targetPath, 'utf8', (err, source) => {
      if (err) {
        send(res, err.code === 'ENOENT' ? 404 : 500, err.code === 'ENOENT' ? 'Not Found' : 'Error');
        return;
      }
      const escaped = source.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
      res.writeHead(200, {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      });
      res.end(`export default \`${escaped}\`;`);
    });
    return;
  }

  // TypeScript transpilation (only if ts available)
  if (targetPath.endsWith('.ts') && ts) {
    fs.readFile(targetPath, 'utf8', (err, source) => {
      if (err) {
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
        res.writeHead(200, {
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
  fs.readFile(targetPath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT' || err.code === 'EISDIR') {
        const spaFallback = resolveSpaFallbackPath(requestPath);
        if (spaFallback) {
          targetPath = spaFallback.fsPath;
          resolvedRequestPath = spaFallback.requestPath;
          fs.readFile(targetPath, (fallbackErr, fallbackData) => {
            if (fallbackErr) {
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
              const html = injectBindings(htmlSource, resolvedRequestPath);
              res.writeHead(200, headers);
              res.end(html);
              return;
            }

            res.writeHead(200, headers);
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
        const html = injectBindings(htmlSource, resolvedRequestPath);
        res.writeHead(200, headers);
        res.end(html);
        return;
      }
    }

    res.writeHead(200, headers);
    res.end(data);
  });
});

// ============================================================================
// File Watcher (cross-platform)
// ============================================================================
const watchTargets = isDalilaRepo
  ? [path.join(rootDir, 'examples', 'playground')]
  : [path.join(rootDir, 'src'), rootDir];

const watchers = [];

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

  function watchDirectory(dir) {
    if (!fs.existsSync(dir)) return;

    try {
      // Watch the directory itself
      const watcher = fs.watch(dir, (eventType, filename) => {
        if (!filename) return;
        if (filename.endsWith('.map')) return;
        notifyHmr(filename);

        // Check if a new subdirectory was added
        if (eventType === 'rename') {
          const fullPath = path.join(dir, filename);
          try {
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
              watchDirectory(fullPath);
            }
          } catch { /* file might have been deleted */ }
        }
      });
      watchers.push(watcher);

      // Watch subdirectories recursively
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      entries.forEach((entry) => {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          watchDirectory(path.join(dir, entry.name));
        }
      });
    } catch (err) {
      console.warn('[Watcher] Could not watch:', dir, err.message);
    }
  }

  watchTargets.forEach((dir) => watchDirectory(dir));
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

  hmrClients.forEach((client) => {
    try { client.end(); } catch { /* ignore */ }
  });
  hmrClients.clear();

  server.close();
};

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
setupWatcher();
startKeepalive();

server.listen(port, () => {
  console.log('');
  console.log('  🐰 ✂️  Dalila dev server');
  console.log(`        http://localhost:${port}`);
  console.log('');
});
