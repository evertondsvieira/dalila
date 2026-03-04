import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const FOUC_PREVENTION_STYLE = `  <style>[d-loading]{visibility:hidden}</style>`;
const SCRIPT_SOURCE_EXTENSIONS = new Set(['.ts', '.mts', '.cts']);
const SCRIPT_REQUEST_SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);
const STATIC_DIR_EXCLUDES = new Set([
  'src',
  'public',
  'node_modules',
  'dist',
  'coverage',
  'playwright-report',
  'test-results',
]);
const HTML_ENTRY_DIR_EXCLUDES = new Set([
  'node_modules',
  'dist',
  'coverage',
  'playwright-report',
  'test-results',
]);
const STATIC_FILE_EXCLUDES = new Set([
  'package.json',
  'package-lock.json',
  'bun.lock',
  'bun.lockb',
  'pnpm-lock.yaml',
  'yarn.lock',
  'tsconfig.json',
  'build.mjs',
  'dev.mjs',
]);

function resolvePackageModule(moduleName, projectDir) {
  try {
    return require.resolve(moduleName, { paths: [projectDir] });
  } catch {
    return require.resolve(moduleName);
  }
}

function isScriptSourceFile(filePath) {
  return SCRIPT_SOURCE_EXTENSIONS.has(path.extname(filePath)) && !filePath.endsWith('.d.ts');
}

function walkFiles(dir, files = []) {
  if (!fs.existsSync(dir)) return files;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(entryPath, files);
      continue;
    }

    files.push(entryPath);
  }

  return files;
}

export function detectPreloadScripts(baseDir) {
  const preloads = [];

  for (const filePath of walkFiles(baseDir)) {
    if (!isScriptSourceFile(filePath)) continue;

    try {
      const source = fs.readFileSync(filePath, 'utf8');
      const persistRegex = /persist\s*\(\s*signal\s*(?:<[^>]+>)?\s*\(\s*['"]?([^'")]+)['"]?\s*\)\s*,\s*\{([^}]+)\}\s*\)/g;

      let match;
      while ((match = persistRegex.exec(source)) !== null) {
        const defaultValue = match[1];
        const options = match[2];

        if (!options.includes('preload') || !options.match(/preload\s*:\s*true/)) {
          continue;
        }

        const nameMatch = options.match(/name\s*:\s*['"]([^'"]+)['"]/);
        if (!nameMatch) continue;

        let storageType = 'localStorage';
        const storageMatch = options.match(/storage\s*:\s*(\w+)/);
        if (storageMatch && storageMatch[1] === 'sessionStorage') {
          storageType = 'sessionStorage';
        }

        preloads.push({
          name: nameMatch[1],
          defaultValue,
          storageType,
        });
      }
    } catch {
      // Ignore malformed files during packaging.
    }
  }

  return preloads;
}

export function generatePreloadScript(name, defaultValue, storageType = 'localStorage') {
  const k = JSON.stringify(name);
  const d = JSON.stringify(defaultValue);
  const script = `(function(){try{var v=${storageType}.getItem(${k});document.documentElement.setAttribute('data-theme',v?JSON.parse(v):${d})}catch(e){document.documentElement.setAttribute('data-theme',${d})}})();`;

  return script
    .replace(/</g, '\\x3C')
    .replace(/-->/g, '--\\x3E')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function renderPreloadScriptTags(baseDir) {
  const preloads = detectPreloadScripts(baseDir);
  if (preloads.length === 0) return '';

  return preloads
    .map((preload) => `  <script>${generatePreloadScript(preload.name, preload.defaultValue, preload.storageType)}</script>`)
    .join('\n');
}

function ensureFileExists(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing ${label}: ${filePath}`);
  }
}

function copyDirectoryContents(sourceDir, destinationDir) {
  if (!fs.existsSync(sourceDir)) return;
  fs.mkdirSync(path.dirname(destinationDir), { recursive: true });
  fs.cpSync(sourceDir, destinationDir, { recursive: true, force: true });
}

function copyStaticSourceAssets(sourceDir, destinationDir) {
  if (!fs.existsSync(sourceDir)) return;

  for (const filePath of walkFiles(sourceDir)) {
    if (isScriptSourceFile(filePath) || filePath.endsWith('.d.ts')) {
      continue;
    }

    const relativePath = path.relative(sourceDir, filePath);
    const targetPath = path.join(destinationDir, relativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(filePath, targetPath);
  }
}

function resolveDalilaPackageRoot(projectDir) {
  const dalilaEntry = require.resolve('dalila', { paths: [projectDir] });
  return path.dirname(path.dirname(dalilaEntry));
}

function formatTypeScriptError(ts, diagnostic) {
  return ts.formatDiagnostic(diagnostic, {
    getCanonicalFileName: (value) => value,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => '\n',
  });
}

function parseTypeScriptConfig(ts, configPath) {
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

  if (unrecoverableDiagnostic) {
    throw new Error(formatTypeScriptError(ts, unrecoverableDiagnostic));
  }

  if (!parsed) {
    throw new Error(`Failed to parse TypeScript config: ${configPath}`);
  }

  if (parsed.errors?.length) {
    throw new Error(parsed.errors.map((diagnostic) => formatTypeScriptError(ts, diagnostic)).join('\n'));
  }

  return parsed;
}

function inferCommonSourceDir(fileNames, fallbackDir) {
  const sourceDirs = fileNames
    .filter((filePath) => !filePath.endsWith('.d.ts'))
    .map((filePath) => path.dirname(path.resolve(filePath)));

  if (sourceDirs.length === 0) {
    return fallbackDir;
  }

  let commonDir = sourceDirs[0];
  for (const nextDir of sourceDirs.slice(1)) {
    while (commonDir !== path.dirname(commonDir)) {
      const relativePath = path.relative(commonDir, nextDir);
      if (relativePath === '' || isRelativePathInsideBase(relativePath)) {
        break;
      }
      commonDir = path.dirname(commonDir);
    }

    const relativePath = path.relative(commonDir, nextDir);
    if (relativePath !== '' && !isRelativePathInsideBase(relativePath)) {
      return fallbackDir;
    }
  }

  return commonDir;
}

function loadTypeScriptBuildConfig(projectDir) {
  const ts = require(resolvePackageModule('typescript', projectDir));
  const configPath = ts.findConfigFile(projectDir, ts.sys.fileExists, 'tsconfig.json');
  const packageOutDirAbs = path.join(projectDir, 'dist');
  const defaultSourceDirAbs = fs.existsSync(path.join(projectDir, 'src'))
    ? path.join(projectDir, 'src')
    : projectDir;

  if (!configPath) {
    return {
      projectDir,
      configPath: null,
      configDir: projectDir,
      compileOutDirAbs: packageOutDirAbs,
      packageOutDirAbs,
      rootDirAbs: projectDir,
      sourceDirAbs: defaultSourceDirAbs,
    };
  }

  const configDir = path.dirname(configPath);
  const parsed = parseTypeScriptConfig(ts, configPath);
  const inferredRootDirAbs = inferCommonSourceDir(parsed.fileNames, projectDir);
  const explicitRootDirAbs = typeof parsed.options.rootDir === 'string'
    ? path.resolve(configDir, parsed.options.rootDir)
    : null;
  const sourceDirAbs = explicitRootDirAbs
    ?? (defaultSourceDirAbs !== projectDir ? defaultSourceDirAbs : inferredRootDirAbs);

  return {
    projectDir,
    configPath,
    configDir,
    compileOutDirAbs: parsed.options.outDir
      ? path.resolve(configDir, parsed.options.outDir)
      : packageOutDirAbs,
    packageOutDirAbs,
    rootDirAbs: explicitRootDirAbs ?? inferredRootDirAbs,
    sourceDirAbs,
  };
}

function resolveExportTarget(target) {
  if (typeof target === 'string') return target;
  if (!target || typeof target !== 'object') return null;
  return target.default || target.import || null;
}

function buildDalilaImportEntries(projectDir) {
  const dalilaRoot = resolveDalilaPackageRoot(projectDir);
  const dalilaPackageJson = JSON.parse(
    fs.readFileSync(path.join(dalilaRoot, 'package.json'), 'utf8')
  );
  const distRoot = path.join(dalilaRoot, 'dist');
  const distIndexPath = path.join(distRoot, 'index.js');
  const imports = {};

  for (const [subpath, target] of Object.entries(dalilaPackageJson.exports ?? {})) {
    const exportTarget = resolveExportTarget(target);
    if (!exportTarget || !exportTarget.endsWith('.js')) continue;

    const absoluteTarget = path.resolve(dalilaRoot, exportTarget);
    if (absoluteTarget !== distIndexPath && !absoluteTarget.startsWith(distRoot + path.sep)) {
      continue;
    }

    const relativeTarget = path.relative(distRoot, absoluteTarget).replace(/\\/g, '/');
    const specifier = subpath === '.' ? 'dalila' : `dalila/${subpath.slice(2)}`;
    imports[specifier] = `/vendor/dalila/${relativeTarget}`;
  }

  return imports;
}

function normalizeNodeModulesImportTarget(target, projectDir, baseDirAbs = projectDir) {
  if (typeof target !== 'string') return null;

  const { pathname, suffix } = splitUrlTarget(target);
  if (isUrlWithScheme(pathname)) {
    return null;
  }

  if (pathname.startsWith('/node_modules/')) {
    return {
      relativeTarget: pathname.slice('/node_modules/'.length),
      suffix,
    };
  }

  if (pathname.startsWith('node_modules/')) {
    return {
      relativeTarget: pathname.slice('node_modules/'.length),
      suffix,
    };
  }

  if (!pathname.startsWith('./') && !pathname.startsWith('../')) {
    return null;
  }

  const nodeModulesRoot = path.join(projectDir, 'node_modules');
  const resolvedAbsPath = resolveLocalProjectPath(projectDir, pathname, baseDirAbs);
  const relativeTarget = path.relative(nodeModulesRoot, resolvedAbsPath);
  if (!isRelativePathInsideBase(relativeTarget)) {
    return null;
  }

  return {
    relativeTarget: toPosixPath(relativeTarget),
    suffix,
  };
}

function splitUrlTarget(target) {
  const match = String(target).match(/^([^?#]*)([?#].*)?$/);
  return {
    pathname: match?.[1] ?? String(target),
    suffix: match?.[2] ?? '',
  };
}

function isUrlWithScheme(pathname) {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(pathname) || pathname.startsWith('//');
}

function isLocalUrlPath(pathname) {
  return pathname.startsWith('/') || pathname.startsWith('./') || pathname.startsWith('../');
}

function resolveLocalProjectPath(projectDir, pathname, baseDirAbs = projectDir) {
  if (pathname.startsWith('/')) {
    return path.resolve(projectDir, pathname.slice(1));
  }

  return path.resolve(baseDirAbs, pathname);
}

function emittedExtensionCandidates(sourceExt) {
  switch (sourceExt) {
    case '.mts':
      return ['.mjs', '.js'];
    case '.cts':
      return ['.cjs', '.js'];
    case '.ts':
      return ['.js'];
    default:
      return [];
  }
}

function replaceExtension(filePath, nextExt) {
  return `${filePath.slice(0, -path.extname(filePath).length)}${nextExt}`;
}

function toPosixPath(value) {
  return value.replace(/\\/g, '/');
}

function isRelativePathInsideBase(relativePath) {
  return !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

function getProjectRelativeCandidates(targetAbsPath, buildConfig) {
  const relativeCandidates = [];
  const relativeToRootDir = path.relative(buildConfig.rootDirAbs, targetAbsPath);
  if (isRelativePathInsideBase(relativeToRootDir)) {
    relativeCandidates.push(relativeToRootDir);
  }

  const relativeToProject = path.relative(buildConfig.projectDir, targetAbsPath);
  if (isRelativePathInsideBase(relativeToProject)) {
    relativeCandidates.push(relativeToProject);
  }

  return [...new Set(relativeCandidates)];
}

function resolveCompiledSourceOutputPath(sourceAbsPath, buildConfig) {
  const sourceExt = path.extname(sourceAbsPath);
  const candidateExts = emittedExtensionCandidates(sourceExt);
  if (candidateExts.length === 0) return null;

  for (const relativeCandidate of getProjectRelativeCandidates(sourceAbsPath, buildConfig)) {
    for (const candidateExt of candidateExts) {
      const compiledAbsPath = path.join(
        buildConfig.compileOutDirAbs,
        replaceExtension(relativeCandidate, candidateExt)
      );
      if (fs.existsSync(compiledAbsPath)) {
        return compiledAbsPath;
      }
    }
  }

  return null;
}

function toPackagedUrlFromCompiledOutput(compiledAbsPath, buildConfig) {
  return `/${toPosixPath(path.relative(buildConfig.compileOutDirAbs, compiledAbsPath))}`;
}

function resolvePackagedProjectUrlPath(targetAbsPath, buildConfig) {
  const [relativeCandidate] = getProjectRelativeCandidates(targetAbsPath, buildConfig);
  if (relativeCandidate == null) {
    return null;
  }

  if (!relativeCandidate) {
    return '/';
  }

  return `/${toPosixPath(relativeCandidate)}`;
}

function ensureTrailingSlash(urlPath) {
  return urlPath.endsWith('/') ? urlPath : `${urlPath}/`;
}

function buildUserProjectImportEntries(buildConfig) {
  const sourceDirUrl = resolvePackagedProjectUrlPath(buildConfig.sourceDirAbs, buildConfig) ?? '/src/';
  return {
    '@/': ensureTrailingSlash(sourceDirUrl),
  };
}

function getScriptSourceRequestCandidates(requestAbsPath) {
  const requestExt = path.extname(requestAbsPath);
  if (SCRIPT_SOURCE_EXTENSIONS.has(requestExt)) {
    return {
      candidates: [requestAbsPath],
      requireExistingFile: false,
    };
  }

  if (!SCRIPT_REQUEST_SOURCE_EXTENSIONS.has(requestExt)) {
    return {
      candidates: [],
      requireExistingFile: true,
    };
  }

  switch (requestExt) {
    case '.mjs':
      return {
        candidates: [replaceExtension(requestAbsPath, '.mts'), replaceExtension(requestAbsPath, '.ts')],
        requireExistingFile: true,
      };
    case '.cjs':
      return {
        candidates: [replaceExtension(requestAbsPath, '.cts'), replaceExtension(requestAbsPath, '.ts')],
        requireExistingFile: true,
      };
    case '.js':
    default:
      return {
        candidates: [
          replaceExtension(requestAbsPath, '.ts'),
          replaceExtension(requestAbsPath, '.mts'),
          replaceExtension(requestAbsPath, '.cts'),
        ],
        requireExistingFile: true,
      };
  }
}

function resolveLocalSourceScriptPath(target, buildConfig, baseDirAbs = buildConfig.projectDir) {
  const { pathname } = splitUrlTarget(target);
  if (!isLocalUrlPath(pathname) || isUrlWithScheme(pathname)) {
    return null;
  }

  const requestAbsPath = resolveLocalProjectPath(buildConfig.projectDir, pathname, baseDirAbs);
  const { candidates, requireExistingFile } = getScriptSourceRequestCandidates(requestAbsPath);
  for (const candidateAbsPath of candidates) {
    if (!requireExistingFile || fs.existsSync(candidateAbsPath)) {
      return candidateAbsPath;
    }
  }

  return null;
}

function rewriteLocalSourceTarget(target, buildConfig, baseDirAbs = buildConfig.projectDir) {
  const { suffix } = splitUrlTarget(target);
  const sourceAbsPath = resolveLocalSourceScriptPath(target, buildConfig, baseDirAbs);
  if (!sourceAbsPath) {
    return null;
  }

  const compiledAbsPath = resolveCompiledSourceOutputPath(sourceAbsPath, buildConfig);
  if (!compiledAbsPath) {
    throw new Error(`Compiled output not found for source target "${target}"`);
  }

  return `${toPackagedUrlFromCompiledOutput(compiledAbsPath, buildConfig)}${suffix}`;
}

function rewriteImportMapScopeName(scopeName, buildConfig, baseDirAbs = buildConfig.projectDir) {
  const rewrittenSourceTarget = rewriteLocalSourceTarget(scopeName, buildConfig, baseDirAbs);
  if (rewrittenSourceTarget) {
    return rewrittenSourceTarget;
  }

  const { pathname, suffix } = splitUrlTarget(scopeName);
  if (!isLocalUrlPath(pathname) || isUrlWithScheme(pathname)) {
    return scopeName;
  }

  const packagedUrlPath = resolvePackagedProjectUrlPath(
    resolveLocalProjectPath(buildConfig.projectDir, pathname, baseDirAbs),
    buildConfig
  );
  if (!packagedUrlPath) {
    return scopeName;
  }

  const needsTrailingSlash = pathname.endsWith('/') && packagedUrlPath !== '/' && !packagedUrlPath.endsWith('/');
  return `${packagedUrlPath}${needsTrailingSlash ? '/' : ''}${suffix}`;
}

function getPackagePathParts(relativeTarget) {
  const segments = relativeTarget.split('/').filter(Boolean);
  if (segments.length === 0) {
    throw new Error(`Invalid node_modules import target: "${relativeTarget}"`);
  }

  if (segments[0].startsWith('@')) {
    if (segments.length < 2) {
      throw new Error(`Invalid scoped package import target: "${relativeTarget}"`);
    }
    return segments.slice(0, 2);
  }

  return segments.slice(0, 1);
}

function rewriteImportMapTarget(projectDir, vendorDir, target, buildConfig, copiedPackages, baseDirAbs = projectDir) {
  const normalizedTarget = normalizeNodeModulesImportTarget(target, projectDir, baseDirAbs);
  if (normalizedTarget) {
    const relativeTarget = normalizedTarget.relativeTarget;
    const packagePathParts = getPackagePathParts(relativeTarget);
    const packagePath = path.join(...packagePathParts);
    const sourcePackageDir = path.join(projectDir, 'node_modules', packagePath);
    const destinationPackageDir = path.join(vendorDir, 'node_modules', packagePath);
    ensureFileExists(sourcePackageDir, `import-map package for target "${target}"`);

    if (!copiedPackages.has(packagePath)) {
      copyDirectoryContents(sourcePackageDir, destinationPackageDir);
      copiedPackages.add(packagePath);
    }

    return `/vendor/node_modules/${relativeTarget}${normalizedTarget.suffix}`;
  }

  const rewrittenSourceTarget = rewriteLocalSourceTarget(target, buildConfig, baseDirAbs);
  if (rewrittenSourceTarget) {
    return rewrittenSourceTarget;
  }

  return target;
}

function packageExistingImportMapImports(projectDir, vendorDir, imports, buildConfig, copiedPackages = new Set(), baseDirAbs = projectDir) {
  const rewrittenImports = {};

  for (const [specifier, target] of Object.entries(imports ?? {})) {
    rewrittenImports[specifier] = rewriteImportMapTarget(projectDir, vendorDir, target, buildConfig, copiedPackages, baseDirAbs);
  }

  return rewrittenImports;
}

function packageExistingImportMapScopes(projectDir, vendorDir, scopes, buildConfig, copiedPackages = new Set(), baseDirAbs = projectDir) {
  const rewrittenScopes = {};

  for (const [scopeName, scopeImports] of Object.entries(scopes ?? {})) {
    const rewrittenScopeName = rewriteImportMapScopeName(scopeName, buildConfig, baseDirAbs);
    if (!scopeImports || typeof scopeImports !== 'object' || Array.isArray(scopeImports)) {
      rewrittenScopes[rewrittenScopeName] = scopeImports;
      continue;
    }

    const rewrittenScopeImports = packageExistingImportMapImports(
      projectDir,
      vendorDir,
      scopeImports,
      buildConfig,
      copiedPackages,
      baseDirAbs
    );

    rewrittenScopes[rewrittenScopeName] = {
      ...(rewrittenScopes[rewrittenScopeName] ?? {}),
      ...rewrittenScopeImports,
    };
  }

  return rewrittenScopes;
}

function extractImportMap(html) {
  const importMapPattern = /<script[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/i;
  const match = html.match(importMapPattern);
  if (!match) {
    return {
      html,
      importMap: { imports: {} },
    };
  }

  let importMap = { imports: {} };
  try {
    const parsed = JSON.parse(match[1]);
    if (parsed && typeof parsed === 'object') {
      importMap = parsed;
    }
  } catch {
    // Ignore invalid import maps and replace them with the packaged version.
  }

  return {
    html: html.replace(match[0], '').trimEnd() + '\n',
    importMap,
  };
}

function renderImportMapScript(importMap) {
  const payload = JSON.stringify(importMap, null, 2)
    .split('\n')
    .map(line => `    ${line}`)
    .join('\n');

  return `  <script type="importmap">\n${payload}\n  </script>`;
}

function shouldPackageHtmlEntry(source) {
  return /<script[^>]*type=["']module["'][^>]*>/i.test(source)
    || /<script[^>]*type=["']importmap["'][^>]*>/i.test(source);
}

function injectHeadContent(html, fragments) {
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
  const moduleScriptMatch = headContent.match(/<script\b[^>]*\btype=["']module["'][^>]*>/i);
  const stylesheetMatch = headContent.match(/<link\b[^>]*\brel=["']stylesheet["'][^>]*>/i);
  const insertionOffset = moduleScriptMatch?.index
    ?? stylesheetMatch?.index
    ?? headContent.length;
  const insertionIndex = headStart + insertionOffset;

  return `${html.slice(0, insertionIndex)}\n${content}\n${html.slice(insertionIndex)}`;
}

function rewriteInlineModuleSpecifiers(source, buildConfig, baseDirAbs = buildConfig.projectDir) {
  const rewriteStaticSpecifierMatch = (fullMatch, prefix, quote, specifier) => {
    const rewrittenSpecifier = rewriteLocalSourceTarget(specifier, buildConfig, baseDirAbs);
    if (!rewrittenSpecifier) {
      return fullMatch;
    }

    return `${prefix}${quote}${rewrittenSpecifier}${quote}`;
  };

  const rewriteDynamicSpecifierMatch = (fullMatch, prefix, quote, specifier, suffix) => {
    const rewrittenSpecifier = rewriteLocalSourceTarget(specifier, buildConfig, baseDirAbs);
    if (!rewrittenSpecifier) {
      return fullMatch;
    }

    return `${prefix}${quote}${rewrittenSpecifier}${quote}${suffix}`;
  };

  let rewrittenSource = source.replace(
    /(\bimport\s*\(\s*)(['"])([^'"]+)\2(\s*\))/g,
    rewriteDynamicSpecifierMatch
  );

  rewrittenSource = rewrittenSource.replace(
    /(\bfrom\s*)(['"])([^'"]+)\2/g,
    rewriteStaticSpecifierMatch
  );

  rewrittenSource = rewrittenSource.replace(
    /(\bimport\s+)(['"])([^'"]+)\2/g,
    rewriteStaticSpecifierMatch
  );

  return rewrittenSource;
}

function rewritePackagedModuleSpecifiers(buildConfig) {
  for (const filePath of walkFiles(buildConfig.packageOutDirAbs)) {
    if (!SCRIPT_REQUEST_SOURCE_EXTENSIONS.has(path.extname(filePath))) {
      continue;
    }

    const source = fs.readFileSync(filePath, 'utf8');
    const rewrittenSource = rewriteInlineModuleSpecifiers(source, buildConfig);
    if (rewrittenSource !== source) {
      fs.writeFileSync(filePath, rewrittenSource);
    }
  }
}

function rewriteHtmlModuleScripts(html, buildConfig, baseDirAbs = buildConfig.projectDir) {
  return html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (fullMatch, attrs, content) => {
    const typeMatch = attrs.match(/\btype=["']([^"']+)["']/i);
    if (!typeMatch || typeMatch[1] !== 'module') {
      return fullMatch;
    }

    const srcMatch = attrs.match(/\bsrc=["']([^"']+)["']/i);
    if (srcMatch) {
      const rewrittenSrc = rewriteLocalSourceTarget(srcMatch[1], buildConfig, baseDirAbs);
      if (!rewrittenSrc) {
        return fullMatch;
      }

      return fullMatch.replace(srcMatch[0], `src="${rewrittenSrc}"`);
    }

    const rewrittenContent = rewriteInlineModuleSpecifiers(content, buildConfig, baseDirAbs);
    if (rewrittenContent === content) {
      return fullMatch;
    }

    return `<script${attrs}>${rewrittenContent}</script>`;
  });
}

function buildHtmlDocument(sourceHtmlPath, importEntries, buildConfig) {
  const source = fs.readFileSync(sourceHtmlPath, 'utf8');
  const { html: htmlWithoutImportMap } = extractImportMap(source);
  const html = rewriteHtmlModuleScripts(htmlWithoutImportMap, buildConfig, path.dirname(sourceHtmlPath));

  return injectHeadContent(html, [
    FOUC_PREVENTION_STYLE,
    renderPreloadScriptTags(buildConfig.sourceDirAbs),
    renderImportMapScript(importEntries),
  ]);
}

function pathsOverlap(leftPath, rightPath) {
  const normalizedLeft = path.resolve(leftPath);
  const normalizedRight = path.resolve(rightPath);

  return normalizedLeft === normalizedRight
    || normalizedLeft.startsWith(`${normalizedRight}${path.sep}`)
    || normalizedRight.startsWith(`${normalizedLeft}${path.sep}`);
}

function copyCompiledOutputTree(buildConfig) {
  if (buildConfig.compileOutDirAbs === buildConfig.packageOutDirAbs) {
    ensureFileExists(buildConfig.packageOutDirAbs, 'compiled output directory');
    return {
      buildConfig,
      cleanup() {},
    };
  }

  ensureFileExists(buildConfig.compileOutDirAbs, 'compiled output directory');
  let snapshotRoot = null;
  let compileOutDirAbs = buildConfig.compileOutDirAbs;

  try {
    if (pathsOverlap(buildConfig.compileOutDirAbs, buildConfig.packageOutDirAbs)) {
      snapshotRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dalila-build-'));
      compileOutDirAbs = path.join(snapshotRoot, 'compiled');
      copyDirectoryContents(buildConfig.compileOutDirAbs, compileOutDirAbs);
    }

    fs.rmSync(buildConfig.packageOutDirAbs, { recursive: true, force: true });
    copyDirectoryContents(compileOutDirAbs, buildConfig.packageOutDirAbs);

    return {
      buildConfig: compileOutDirAbs === buildConfig.compileOutDirAbs
        ? buildConfig
        : { ...buildConfig, compileOutDirAbs },
      cleanup() {
        if (snapshotRoot) {
          fs.rmSync(snapshotRoot, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    if (snapshotRoot) {
      fs.rmSync(snapshotRoot, { recursive: true, force: true });
    }
    throw error;
  }
}

function getTopLevelProjectDirName(projectDir, targetDirAbs) {
  const relativePath = path.relative(projectDir, targetDirAbs);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return null;
  }

  const [topLevelName] = relativePath.split(path.sep);
  return topLevelName || null;
}

function collectTopLevelStaticDirs(projectDir, buildConfig) {
  const excludedNames = new Set(STATIC_DIR_EXCLUDES);
  const sourceTopLevelDir = getTopLevelProjectDirName(projectDir, buildConfig.rootDirAbs);
  const compileTopLevelDir = getTopLevelProjectDirName(projectDir, buildConfig.compileOutDirAbs);
  const packageTopLevelDir = getTopLevelProjectDirName(projectDir, buildConfig.packageOutDirAbs);

  if (sourceTopLevelDir && buildConfig.rootDirAbs !== buildConfig.projectDir) {
    excludedNames.add(sourceTopLevelDir);
  }

  if (compileTopLevelDir) {
    excludedNames.add(compileTopLevelDir);
  }

  if (packageTopLevelDir) {
    excludedNames.add(packageTopLevelDir);
  }

  return fs.readdirSync(projectDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !excludedNames.has(entry.name))
    .map((entry) => entry.name);
}

function copyTopLevelStaticDirs(projectDir, packageOutDirAbs, buildConfig) {
  for (const dirName of collectTopLevelStaticDirs(projectDir, buildConfig)) {
    copyDirectoryContents(path.join(projectDir, dirName), path.join(packageOutDirAbs, dirName));
  }
}

function copyTopLevelStaticFiles(projectDir, packageOutDirAbs) {
  for (const entry of fs.readdirSync(projectDir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name.startsWith('.') || STATIC_FILE_EXCLUDES.has(entry.name)) {
      continue;
    }

    const sourcePath = path.join(projectDir, entry.name);
    const destinationPath = path.join(packageOutDirAbs, entry.name);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);
  }
}

function resolveSourceAssetRoots(projectDir, buildConfig) {
  const sourceRoots = [];
  const srcDir = path.join(projectDir, 'src');

  if (buildConfig.rootDirAbs !== projectDir && fs.existsSync(buildConfig.rootDirAbs)) {
    sourceRoots.push(buildConfig.rootDirAbs);
  }

  if (fs.existsSync(srcDir)) {
    sourceRoots.push(srcDir);
  }

  return [...new Set(sourceRoots)];
}

function copyPackagedSourceAssets(projectDir, buildConfig) {
  for (const sourceDir of resolveSourceAssetRoots(projectDir, buildConfig)) {
    for (const filePath of walkFiles(sourceDir)) {
      if (isScriptSourceFile(filePath) || filePath.endsWith('.d.ts')) {
        continue;
      }

      const destinationPaths = new Set();
      const projectRelativePath = path.relative(projectDir, filePath);
      if (isRelativePathInsideBase(projectRelativePath)) {
        destinationPaths.add(path.join(buildConfig.packageOutDirAbs, projectRelativePath));
      }

      const packagedUrlPath = resolvePackagedProjectUrlPath(filePath, buildConfig);
      if (packagedUrlPath && packagedUrlPath !== '/') {
        destinationPaths.add(path.join(buildConfig.packageOutDirAbs, packagedUrlPath.slice(1)));
      }

      for (const destinationPath of destinationPaths) {
        fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
        fs.copyFileSync(filePath, destinationPath);
      }
    }
  }
}

function walkProjectHtmlFiles(dir, files = []) {
  if (!fs.existsSync(dir)) return files;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue;
    }

    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (HTML_ENTRY_DIR_EXCLUDES.has(entry.name)) {
        continue;
      }
      walkProjectHtmlFiles(entryPath, files);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.html')) {
      files.push(entryPath);
    }
  }

  return files;
}

function packageHtmlEntryPoints(projectDir, vendorDir, buildConfig, copiedPackages) {
  for (const sourceHtmlPath of walkProjectHtmlFiles(projectDir)) {
    const source = fs.readFileSync(sourceHtmlPath, 'utf8');
    if (!shouldPackageHtmlEntry(source)) {
      continue;
    }

    const { importMap: existingImportMap } = extractImportMap(source);
    const existingImports = existingImportMap && typeof existingImportMap.imports === 'object'
      ? existingImportMap.imports
      : {};
    const existingScopes = existingImportMap && typeof existingImportMap.scopes === 'object'
      ? existingImportMap.scopes
      : {};
    const baseDirAbs = path.dirname(sourceHtmlPath);
    const rewrittenImports = packageExistingImportMapImports(
      projectDir,
      vendorDir,
      existingImports,
      buildConfig,
      copiedPackages,
      baseDirAbs
    );
    const rewrittenScopes = packageExistingImportMapScopes(
      projectDir,
      vendorDir,
      existingScopes,
      buildConfig,
      copiedPackages,
      baseDirAbs
    );
    const importMap = {
      ...existingImportMap,
      imports: {
        ...rewrittenImports,
        ...buildUserProjectImportEntries(buildConfig),
        ...buildDalilaImportEntries(projectDir),
      },
      scopes: rewrittenScopes,
    };
    const packagedHtml = buildHtmlDocument(sourceHtmlPath, importMap, buildConfig);
    const packagedHtmlPath = path.join(buildConfig.packageOutDirAbs, path.relative(projectDir, sourceHtmlPath));
    fs.mkdirSync(path.dirname(packagedHtmlPath), { recursive: true });
    fs.writeFileSync(packagedHtmlPath, packagedHtml);
  }
}

export async function buildProject(projectDir = process.cwd()) {
  const rootDir = path.resolve(projectDir);
  const initialBuildConfig = loadTypeScriptBuildConfig(rootDir);
  const distDir = initialBuildConfig.packageOutDirAbs;
  const vendorDir = path.join(distDir, 'vendor');
  const dalilaRoot = resolveDalilaPackageRoot(rootDir);
  const indexHtmlPath = path.join(rootDir, 'index.html');

  ensureFileExists(indexHtmlPath, 'index.html');
  const compiledOutput = copyCompiledOutputTree(initialBuildConfig);
  const buildConfig = compiledOutput.buildConfig;

  try {
    fs.rmSync(vendorDir, { recursive: true, force: true });
    rewritePackagedModuleSpecifiers(buildConfig);
    copyDirectoryContents(path.join(dalilaRoot, 'dist'), path.join(vendorDir, 'dalila'));
    copyPackagedSourceAssets(rootDir, buildConfig);
    copyDirectoryContents(path.join(rootDir, 'public'), path.join(distDir, 'public'));
    copyTopLevelStaticDirs(rootDir, distDir, buildConfig);
    copyTopLevelStaticFiles(rootDir, distDir);

    const copiedPackages = new Set();
    packageHtmlEntryPoints(rootDir, vendorDir, buildConfig, copiedPackages);

    return {
      distDir,
      importEntries: {
        imports: {
          ...buildUserProjectImportEntries(buildConfig),
          ...buildDalilaImportEntries(rootDir),
        },
      },
    };
  } finally {
    compiledOutput.cleanup();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  buildProject().catch((error) => {
    console.error('[Dalila] build packaging failed:', error);
    process.exit(1);
  });
}
