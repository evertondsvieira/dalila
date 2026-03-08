import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const FOUC_PREVENTION_STYLE = `  <style>[d-loading]{visibility:hidden}</style>`;
const SCRIPT_SOURCE_EXTENSIONS = new Set(['.ts', '.mts', '.cts']);
const SCRIPT_REQUEST_SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);
const JAVASCRIPT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);
const TYPE_ARTIFACT_EXTENSIONS = ['.d.ts', '.d.ts.map', '.js.map', '.mjs.map', '.cjs.map'];
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

function replaceHtmlAttributeValue(attributesSource, attributeName, nextValue) {
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

    const valueStart = index;
    if (index >= attributesSource.length) {
      return currentName === name
        ? `${attributesSource.slice(0, valueStart)}"${nextValue}"`
        : null;
    }

    let valueEnd = index;
    const quote = attributesSource[index];
    if (quote === '"' || quote === '\'') {
      index += 1;
      while (index < attributesSource.length && attributesSource[index] !== quote) {
        index += 1;
      }
      valueEnd = index < attributesSource.length ? index + 1 : index;
      if (index < attributesSource.length) {
        index += 1;
      }
    } else {
      while (
        index < attributesSource.length
        && !isHtmlWhitespaceChar(attributesSource[index])
        && attributesSource[index] !== '>'
      ) {
        index += 1;
      }
      valueEnd = index;
    }

    if (currentName === name) {
      return `${attributesSource.slice(0, valueStart)}"${nextValue}"${attributesSource.slice(valueEnd)}`;
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
    const ts = require(resolvePackageModule('typescript', projectDir));
    return {
      projectDir,
      configPath: null,
      configDir: projectDir,
      compileOutDirAbs: packageOutDirAbs,
      packageOutDirAbs,
      rootDirAbs: projectDir,
      sourceDirAbs: defaultSourceDirAbs,
      ts,
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
    ts,
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
  const importMapElement = findFirstHtmlScriptElementByType(html, 'importmap');
  if (!importMapElement) {
    return {
      html,
      importMap: { imports: {} },
    };
  }

  let importMap = { imports: {} };
  try {
    const parsed = JSON.parse(importMapElement.content);
    if (parsed && typeof parsed === 'object') {
      importMap = parsed;
    }
  } catch {
    // Ignore invalid import maps and replace them with the packaged version.
  }

  return {
    html: `${html.slice(0, importMapElement.start)}${html.slice(importMapElement.end)}`.trimEnd() + '\n',
    importMap,
  };
}

export function renderImportMapScript(importMap) {
  const payload = stringifyInlineScriptPayload(importMap, 4);

  return `  <script type="importmap">\n${payload}\n  </script>`;
}

function renderModulePreloadLinks(moduleUrls) {
  return [...new Set(moduleUrls)]
    .sort()
    .map((moduleUrl) => `  <link rel="modulepreload" href="${moduleUrl}">`)
    .join('\n');
}

function collectModuleSpecifierKinds(source, ts) {
  const staticSpecifiers = new Set();
  const dynamicSpecifiers = new Set();
  const runtimeUrlSpecifiers = new Set();
  const bindingExpressions = new Map();
  const resolvedBindings = new Map();
  const serviceWorkerAliases = new Set();
  const navigatorAliases = new Set();
  const serviceWorkerRegisterAliases = new Set();
  const workerConstructorAliases = new Set();
  let hasUnresolvedDalilaDynamicImport = false;
  let hasUnresolvedDynamicImport = false;
  let hasUnresolvedRuntimeUrl = false;
  const sourceFile = ts.createSourceFile(
    'module.js',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );

  const isImportMetaUrl = (node) =>
    ts.isPropertyAccessExpression(node)
    && ts.isMetaProperty(node.expression)
    && node.expression.keywordToken === ts.SyntaxKind.ImportKeyword
    && node.expression.name.text === 'meta'
    && node.name.text === 'url';

  const isImportMetaUrlAlias = (node) =>
    ts.isIdentifier(node)
    && bindingExpressions.get(node.text)?.length === 1
    && isImportMetaUrl(bindingExpressions.get(node.text)[0]);

  const isNavigatorReference = (node) =>
    ts.isIdentifier(node)
    && (node.text === 'navigator' || navigatorAliases.has(node.text));

  const isServiceWorkerReference = (node) =>
    (
      ts.isPropertyAccessExpression(node)
      && ts.isIdentifier(node.name)
      && node.name.text === 'serviceWorker'
      && isNavigatorReference(node.expression)
    )
    || (ts.isIdentifier(node) && serviceWorkerAliases.has(node.text));

  const isScopeBoundaryNode = (node) =>
    node !== sourceFile
    && (
      ts.isBlock(node)
      || ts.isFunctionLike(node)
      || ts.isClassLike(node)
      || ts.isModuleBlock(node)
    );

  const collectScopeDeclaredNames = (scopeNode) => {
    const names = new Set();

    const visitScopeNode = (node) => {
      if (node !== scopeNode && isScopeBoundaryNode(node)) {
        return;
      }

      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        names.add(node.name.text);
      }

      if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name && ts.isIdentifier(node.name)) {
        names.add(node.name.text);
      }

      if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
        names.add(node.name.text);
      }

      ts.forEachChild(node, visitScopeNode);
    };

    visitScopeNode(scopeNode);
    return names;
  };

  const resolveStringExpression = (node, options = {}) => {
    const allowBindings = options.allowBindings !== false;
    if (!node) {
      return { value: null, referencesDalila: false };
    }

    if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      return {
        value: node.text,
        referencesDalila: node.text.includes('dalila'),
      };
    }

    if (ts.isIdentifier(node)) {
      const resolvedLiteral = allowBindings
        ? (resolvedBindings.get(node.text) ?? resolveBinding(node.text))
        : null;
      if (typeof resolvedLiteral === 'string') {
        return {
          value: resolvedLiteral,
          referencesDalila: resolvedLiteral.includes('dalila'),
        };
      }

      return {
        value: null,
        referencesDalila: node.text.toLowerCase().includes('dalila'),
      };
    }

    if (ts.isPropertyAccessExpression(node)) {
      return allowBindings
        ? resolveObjectProperty(node.expression, node.name.text, options)
        : { value: null, referencesDalila: false };
    }

    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = resolveStringExpression(node.left, options);
      const right = resolveStringExpression(node.right, options);
      return {
        value: typeof left.value === 'string' && typeof right.value === 'string'
          ? `${left.value}${right.value}`
          : null,
        referencesDalila: left.referencesDalila || right.referencesDalila,
      };
    }

    if (ts.isTemplateExpression(node)) {
      let value = node.head.text;
      let isFullyResolved = true;
      let referencesDalila = node.head.text.includes('dalila');

      for (const span of node.templateSpans) {
        const expressionResult = resolveStringExpression(span.expression, options);
        if (typeof expressionResult.value !== 'string') {
          isFullyResolved = false;
        } else {
          value += expressionResult.value;
        }
        referencesDalila = referencesDalila || expressionResult.referencesDalila;
        value += span.literal.text;
        referencesDalila = referencesDalila || span.literal.text.includes('dalila');
      }

      return {
        value: isFullyResolved ? value : null,
        referencesDalila,
      };
    }

    return {
      value: null,
      referencesDalila: node.getText(sourceFile).includes('dalila'),
    };
  };

  const resolveObjectProperty = (node, propertyName, options = {}) => {
    if (!node) {
      return { value: null, referencesDalila: false };
    }

    if (ts.isParenthesizedExpression(node)) {
      return resolveObjectProperty(node.expression, propertyName, options);
    }

    if (ts.isIdentifier(node)) {
      const bindingCandidates = options.allowBindings === false ? null : bindingExpressions.get(node.text);
      if (bindingCandidates?.length === 1) {
        return resolveObjectProperty(bindingCandidates[0], propertyName, options);
      }

      return { value: null, referencesDalila: false };
    }

    if (!ts.isObjectLiteralExpression(node)) {
      return { value: null, referencesDalila: false };
    }

    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property) || property.name == null) {
        continue;
      }

      let candidateName = null;
      if (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name) || ts.isNumericLiteral(property.name)) {
        candidateName = property.name.text;
      }

      if (candidateName !== propertyName) {
        continue;
      }

      return resolveStringExpression(property.initializer, options);
    }

    return { value: null, referencesDalila: false };
  };

  const resolveRuntimeUrlExpression = (node, options = {}) => {
    if (!node) {
      return { value: null, isRemote: false };
    }

    if (ts.isIdentifier(node)) {
      const bindingCandidates = options.allowBindings === false ? null : bindingExpressions.get(node.text);
      if (bindingCandidates?.length === 1) {
        return resolveRuntimeUrlExpression(bindingCandidates[0], options);
      }
    }

    if (ts.isPropertyAccessExpression(node)) {
      const propertyValue = resolveObjectProperty(node.expression, node.name.text, options);
      if (typeof propertyValue.value === 'string') {
        return { value: propertyValue.value, isRemote: false };
      }
    }

    const direct = resolveStringExpression(node, options);
    if (typeof direct.value === 'string') {
      return { value: direct.value, isRemote: false };
    }

    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'URL') {
      const [firstArgument, secondArgument] = node.arguments ?? [];
      const importMetaUrlAlias = ts.isIdentifier(secondArgument)
        ? isImportMetaUrlAlias(secondArgument)
        : false;
      if (!secondArgument || isImportMetaUrl(secondArgument) || importMetaUrlAlias) {
        const resolvedArgument = resolveStringExpression(firstArgument, options);
        if (typeof resolvedArgument.value === 'string') {
          return { value: resolvedArgument.value, isRemote: false };
        }
      } else {
        return { value: null, isRemote: true };
      }
    }

    return { value: null, isRemote: false };
  };

  const collectBindings = (node, scopeDepth = 0) => {
    const isScopeBoundary = node !== sourceFile && (
      ts.isBlock(node)
      || ts.isFunctionLike(node)
      || ts.isClassLike(node)
      || ts.isModuleBlock(node)
      || ts.isSourceFile(node)
    );
    const nextScopeDepth = isScopeBoundary ? scopeDepth + 1 : scopeDepth;

    if (scopeDepth === 0) {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const expressions = bindingExpressions.get(node.name.text) ?? [];
        expressions.push(node.initializer);
        bindingExpressions.set(node.name.text, expressions);

        if (ts.isIdentifier(node.initializer) && node.initializer.text === 'navigator') {
          navigatorAliases.add(node.name.text);
        }

        if (isServiceWorkerReference(node.initializer)) {
          serviceWorkerAliases.add(node.name.text);
        }

        if (
          ts.isPropertyAccessExpression(node.initializer)
          && ts.isIdentifier(node.initializer.name)
          && node.initializer.name.text === 'register'
          && isServiceWorkerReference(node.initializer.expression)
        ) {
          serviceWorkerRegisterAliases.add(node.name.text);
        }

        if (
          ts.isPropertyAccessExpression(node.initializer)
          && ts.isIdentifier(node.initializer.expression)
          && ['window', 'globalThis', 'self'].includes(node.initializer.expression.text)
          && ['Worker', 'SharedWorker'].includes(node.initializer.name.text)
        ) {
          workerConstructorAliases.add(node.name.text);
        }
      }

      if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer && ts.isIdentifier(node.initializer) && node.initializer.text === 'navigator') {
        for (const element of node.name.elements) {
          if (!ts.isBindingElement(element)) continue;
          const propertyName = element.propertyName && ts.isIdentifier(element.propertyName)
            ? element.propertyName.text
            : ts.isIdentifier(element.name)
              ? element.name.text
              : null;
          const aliasName = ts.isIdentifier(element.name) ? element.name.text : null;
          if (propertyName === 'serviceWorker' && aliasName) {
            serviceWorkerAliases.add(aliasName);
          }
        }
      }

      if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer && isServiceWorkerReference(node.initializer)) {
        for (const element of node.name.elements) {
          if (!ts.isBindingElement(element)) continue;
          const propertyName = element.propertyName && ts.isIdentifier(element.propertyName)
            ? element.propertyName.text
            : ts.isIdentifier(element.name)
              ? element.name.text
              : null;
          const aliasName = ts.isIdentifier(element.name) ? element.name.text : null;
          if (propertyName === 'register' && aliasName) {
            serviceWorkerRegisterAliases.add(aliasName);
          }
        }
      }

      if (
        ts.isVariableDeclaration(node)
        && ts.isObjectBindingPattern(node.name)
        && node.initializer
        && ts.isIdentifier(node.initializer)
        && navigatorAliases.has(node.initializer.text)
      ) {
        for (const element of node.name.elements) {
          if (!ts.isBindingElement(element)) continue;
          const propertyName = element.propertyName && ts.isIdentifier(element.propertyName)
            ? element.propertyName.text
            : ts.isIdentifier(element.name)
              ? element.name.text
              : null;
          const aliasName = ts.isIdentifier(element.name) ? element.name.text : null;
          if (propertyName === 'serviceWorker' && aliasName) {
            serviceWorkerAliases.add(aliasName);
          }
        }
      }

      if (
        ts.isVariableDeclaration(node)
        && ts.isObjectBindingPattern(node.name)
        && node.initializer
        && ts.isIdentifier(node.initializer)
        && ['window', 'globalThis', 'self'].includes(node.initializer.text)
      ) {
        for (const element of node.name.elements) {
          if (!ts.isBindingElement(element)) continue;
          const propertyName = element.propertyName && ts.isIdentifier(element.propertyName)
            ? element.propertyName.text
            : ts.isIdentifier(element.name)
              ? element.name.text
              : null;
          const aliasName = ts.isIdentifier(element.name) ? element.name.text : null;
          if (aliasName && ['Worker', 'SharedWorker'].includes(propertyName)) {
            workerConstructorAliases.add(aliasName);
          }
        }
      }

      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left)) {
        const expressions = bindingExpressions.get(node.left.text) ?? [];
        expressions.push(node.right);
        bindingExpressions.set(node.left.text, expressions);

        if (ts.isIdentifier(node.right) && node.right.text === 'navigator') {
          navigatorAliases.add(node.left.text);
        }
      }
    }

    ts.forEachChild(node, (child) => collectBindings(child, nextScopeDepth));
  };

  const resolutionStack = new Set();
  const bindingReferencesDalila = (name) => {
    const bindingCandidates = bindingExpressions.get(name);
    if (!bindingCandidates || bindingCandidates.length === 0) {
      return false;
    }

    return bindingCandidates.some((bindingExpression) => resolveStringExpression(bindingExpression).referencesDalila);
  };

  const resolveBinding = (name) => {
    if (resolvedBindings.has(name)) {
      return resolvedBindings.get(name) ?? null;
    }

    if (resolutionStack.has(name)) {
      return null;
    }

    const bindingCandidates = bindingExpressions.get(name);
    if (!bindingCandidates || bindingCandidates.length === 0) {
      return null;
    }

    resolutionStack.add(name);
    const resolvedValues = new Set();
    let hasAmbiguity = false;

    for (const bindingExpression of bindingCandidates) {
      const resolved = resolveStringExpression(bindingExpression);
      if (typeof resolved.value === 'string') {
        resolvedValues.add(resolved.value);
      } else {
        hasAmbiguity = true;
      }
    }
    resolutionStack.delete(name);

    if (!hasAmbiguity && resolvedValues.size === 1) {
      const [resolvedValue] = resolvedValues;
      resolvedBindings.set(name, resolvedValue);
      return resolvedValue;
    }

    return null;
  };

  const visit = (node, scopeDepth = 0, scopeDeclarations = []) => {
    const nestedScope = isScopeBoundaryNode(node);
    const nextScopeDepth = nestedScope ? scopeDepth + 1 : scopeDepth;
    const nextScopeDeclarations = nestedScope
      ? [...scopeDeclarations, collectScopeDeclaredNames(node)]
      : scopeDeclarations;

    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const resolvedLiteral = resolveBinding(node.name.text);
      if (typeof resolvedLiteral === 'string') {
        resolvedBindings.set(node.name.text, resolvedLiteral);
      }
    }

    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      staticSpecifiers.add(node.moduleSpecifier.text);
    }

    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [firstArgument] = node.arguments;
      if (firstArgument) {
        const localShadowed = ts.isIdentifier(firstArgument)
          && nextScopeDeclarations.some((declaredNames) => declaredNames.has(firstArgument.text));
        const importArg = resolveStringExpression(firstArgument, {
          allowBindings: scopeDepth === 0 && !localShadowed,
        });
        if (typeof importArg.value === 'string') {
          dynamicSpecifiers.add(importArg.value);
        } else if (importArg.referencesDalila) {
          hasUnresolvedDalilaDynamicImport = true;
          hasUnresolvedDynamicImport = true;
        } else {
          if (!localShadowed && ts.isIdentifier(firstArgument)) {
            const resolvedTopLevel = resolveBinding(firstArgument.text);
            if (typeof resolvedTopLevel === 'string' && resolvedTopLevel.startsWith('dalila')) {
              hasUnresolvedDalilaDynamicImport = true;
            } else if (bindingReferencesDalila(firstArgument.text)) {
              hasUnresolvedDalilaDynamicImport = true;
            }
          }
          hasUnresolvedDynamicImport = true;
        }
      }
    }

    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'register'
      && (
        (
          ts.isPropertyAccessExpression(node.expression.expression)
          && ts.isIdentifier(node.expression.expression.name)
          && node.expression.expression.name.text === 'serviceWorker'
          && ts.isIdentifier(node.expression.expression.expression)
          && (
            node.expression.expression.expression.text === 'navigator'
            || navigatorAliases.has(node.expression.expression.expression.text)
          )
        )
        || (ts.isIdentifier(node.expression.expression) && serviceWorkerAliases.has(node.expression.expression.text))
      )
    ) {
      const localShadowed = ts.isIdentifier(node.arguments[0])
        && nextScopeDeclarations.some((declaredNames) => declaredNames.has(node.arguments[0].text));
      const runtimeUrl = resolveRuntimeUrlExpression(node.arguments[0], {
        allowBindings: scopeDepth === 0 && !localShadowed,
      });
      if (runtimeUrl.value) {
        runtimeUrlSpecifiers.add(runtimeUrl.value);
      } else if (node.arguments[0] && !runtimeUrl.isRemote) {
        hasUnresolvedRuntimeUrl = true;
      }
    }

    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && serviceWorkerRegisterAliases.has(node.expression.text)
    ) {
      const localShadowed = ts.isIdentifier(node.arguments[0])
        && nextScopeDeclarations.some((declaredNames) => declaredNames.has(node.arguments[0].text));
      const runtimeUrl = resolveRuntimeUrlExpression(node.arguments[0], {
        allowBindings: scopeDepth === 0 && !localShadowed,
      });
      if (runtimeUrl.value) {
        runtimeUrlSpecifiers.add(runtimeUrl.value);
      } else if (node.arguments[0] && !runtimeUrl.isRemote) {
        hasUnresolvedRuntimeUrl = true;
      }
    }

    if (
      ts.isCallExpression(node)
      && (
        (ts.isIdentifier(node.expression) && node.expression.text === 'importScripts')
        || (
          ts.isPropertyAccessExpression(node.expression)
          && ts.isIdentifier(node.expression.expression)
          && node.expression.expression.text === 'self'
          && node.expression.name.text === 'importScripts'
        )
      )
    ) {
      for (const argument of node.arguments) {
        const localShadowed = ts.isIdentifier(argument)
          && nextScopeDeclarations.some((declaredNames) => declaredNames.has(argument.text));
        const runtimeUrl = resolveRuntimeUrlExpression(argument, {
          allowBindings: scopeDepth === 0 && !localShadowed,
        });
        if (runtimeUrl.value) {
          runtimeUrlSpecifiers.add(runtimeUrl.value);
        } else if (!runtimeUrl.isRemote) {
          hasUnresolvedRuntimeUrl = true;
        }
      }
    }

    const isWorkerConstructor = ts.isNewExpression(node) && (
      (ts.isIdentifier(node.expression) && ['Worker', 'SharedWorker'].includes(node.expression.text))
      || (ts.isIdentifier(node.expression) && workerConstructorAliases.has(node.expression.text))
      || (
        ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression)
        && ['window', 'globalThis', 'self'].includes(node.expression.expression.text)
        && ['Worker', 'SharedWorker'].includes(node.expression.name.text)
      )
    );

    if (isWorkerConstructor) {
      const localShadowed = ts.isIdentifier(node.arguments?.[0])
        && nextScopeDeclarations.some((declaredNames) => declaredNames.has(node.arguments[0].text));
      const runtimeUrl = resolveRuntimeUrlExpression(node.arguments?.[0], {
        allowBindings: scopeDepth === 0 && !localShadowed,
      });
      if (runtimeUrl.value) {
        runtimeUrlSpecifiers.add(runtimeUrl.value);
      } else if (node.arguments?.[0] && !runtimeUrl.isRemote) {
        hasUnresolvedRuntimeUrl = true;
      }
    }

    ts.forEachChild(node, (child) => visit(child, nextScopeDepth, nextScopeDeclarations));
  };

  ts.forEachChild(sourceFile, (child) => collectBindings(child, 0));
  ts.forEachChild(sourceFile, (child) => visit(child, 0, []));
  return {
    staticSpecifiers: [...staticSpecifiers],
    dynamicSpecifiers: [...dynamicSpecifiers],
    runtimeUrlSpecifiers: [...runtimeUrlSpecifiers],
    allSpecifiers: [...new Set([...staticSpecifiers, ...dynamicSpecifiers])],
    hasUnresolvedDalilaDynamicImport,
    hasUnresolvedDynamicImport,
    hasUnresolvedRuntimeUrl,
  };
}

function resolveRelativeUrl(specifier, referrerUrl) {
  const resolvedUrl = new URL(specifier, new URL(referrerUrl, 'https://dalila.local'));
  return `${resolvedUrl.pathname}${resolvedUrl.search}${resolvedUrl.hash}`;
}

function resolveImportMapMatch(specifier, imports = {}) {
  if (typeof imports[specifier] === 'string') {
    return imports[specifier];
  }

  let bestPrefix = null;
  for (const [prefix, target] of Object.entries(imports)) {
    if (typeof target !== 'string' || !prefix.endsWith('/')) {
      continue;
    }

    if (!specifier.startsWith(prefix)) {
      continue;
    }

    if (!bestPrefix || prefix.length > bestPrefix.length) {
      bestPrefix = prefix;
    }
  }

  if (!bestPrefix) {
    return null;
  }

  const target = imports[bestPrefix];
  if (typeof target !== 'string') {
    return null;
  }

  return `${target}${specifier.slice(bestPrefix.length)}`;
}

function resolveImportMapSpecifier(specifier, importMap, referrerUrl) {
  const scopes = importMap?.scopes ?? {};
  let bestScope = null;

  for (const scopeName of Object.keys(scopes)) {
    if (!referrerUrl.startsWith(scopeName)) {
      continue;
    }

    if (!bestScope || scopeName.length > bestScope.length) {
      bestScope = scopeName;
    }
  }

  if (bestScope) {
    const scopedMatch = resolveImportMapMatch(specifier, scopes[bestScope]);
    if (scopedMatch) {
      return scopedMatch;
    }
  }

  return resolveImportMapMatch(specifier, importMap?.imports ?? {});
}

function resolveSpecifierToPackagedUrl(specifier, referrerUrl, importMap, importMapBaseUrl = referrerUrl) {
  if (isUrlWithScheme(specifier) || specifier.startsWith('//')) {
    return null;
  }

  if (specifier.startsWith('/') || specifier.startsWith('./') || specifier.startsWith('../')) {
    return resolveRelativeUrl(specifier, referrerUrl);
  }

  const mappedTarget = resolveImportMapSpecifier(specifier, importMap, referrerUrl);
  if (!mappedTarget) {
    return null;
  }

  if (isUrlWithScheme(mappedTarget) || mappedTarget.startsWith('//')) {
    return null;
  }

  if (mappedTarget.startsWith('/') || mappedTarget.startsWith('./') || mappedTarget.startsWith('../')) {
    return resolveRelativeUrl(mappedTarget, importMapBaseUrl);
  }

  return mappedTarget;
}

function isJavaScriptModuleUrl(moduleUrl) {
  return JAVASCRIPT_EXTENSIONS.has(path.extname(splitUrlTarget(moduleUrl).pathname));
}

function collectHtmlModuleEntries(html, htmlUrl, ts) {
  const entryModuleUrls = new Set();
  const classicScriptUrls = new Set();
  const inlineModuleSpecifiers = new Set();
  const inlineStaticModuleSpecifiers = new Set();
  const inlineRuntimeUrlSpecifiers = new Set();
  let requiresFullDalilaImportMap = false;
  let hasUnresolvedDynamicImport = false;
  let hasUnresolvedRuntimeUrl = false;

  forEachHtmlScriptElement(html, ({ attributesSource, content }) => {
    const type = getHtmlAttributeValue(attributesSource, 'type');
    const src = getHtmlAttributeValue(attributesSource, 'src');
    if ((type ?? '').toLowerCase() !== 'module') {
      if (src) {
        const classicScriptUrl = resolveSpecifierToPackagedUrl(src, htmlUrl, { imports: {}, scopes: {} });
        if (classicScriptUrl && isJavaScriptModuleUrl(classicScriptUrl)) {
          classicScriptUrls.add(classicScriptUrl);
        }
      } else if (content.trim()) {
        const collectedClassicSpecifiers = collectModuleSpecifierKinds(content, ts);
        for (const specifier of collectedClassicSpecifiers.allSpecifiers) {
          inlineModuleSpecifiers.add(specifier);
        }
        for (const runtimeUrlSpecifier of collectedClassicSpecifiers.runtimeUrlSpecifiers ?? []) {
          inlineRuntimeUrlSpecifiers.add(runtimeUrlSpecifier);
        }
        if (collectedClassicSpecifiers.hasUnresolvedDalilaDynamicImport) {
          requiresFullDalilaImportMap = true;
        }
        if (collectedClassicSpecifiers.hasUnresolvedDynamicImport) {
          hasUnresolvedDynamicImport = true;
        }
        if (collectedClassicSpecifiers.hasUnresolvedRuntimeUrl) {
          hasUnresolvedRuntimeUrl = true;
        }
      }
      return;
    }

    if (src) {
      const entryModuleUrl = resolveSpecifierToPackagedUrl(src, htmlUrl, { imports: {}, scopes: {} });
      if (entryModuleUrl) {
        entryModuleUrls.add(entryModuleUrl);
      }
      return;
    }

    const collectedSpecifiers = collectModuleSpecifierKinds(content, ts);
    for (const specifier of collectedSpecifiers.allSpecifiers) {
      inlineModuleSpecifiers.add(specifier);
    }
    for (const specifier of collectedSpecifiers.staticSpecifiers) {
      inlineStaticModuleSpecifiers.add(specifier);
    }
    for (const runtimeUrlSpecifier of collectedSpecifiers.runtimeUrlSpecifiers ?? []) {
      inlineRuntimeUrlSpecifiers.add(runtimeUrlSpecifier);
    }
    if (collectedSpecifiers.hasUnresolvedDalilaDynamicImport) {
      requiresFullDalilaImportMap = true;
    }
    if (collectedSpecifiers.hasUnresolvedDynamicImport) {
      hasUnresolvedDynamicImport = true;
    }
    if (collectedSpecifiers.hasUnresolvedRuntimeUrl) {
      hasUnresolvedRuntimeUrl = true;
    }
  });

  return {
    classicScriptUrls: [...classicScriptUrls],
    entryModuleUrls: [...entryModuleUrls],
    inlineModuleSpecifiers: [...inlineModuleSpecifiers],
    inlineStaticModuleSpecifiers: [...inlineStaticModuleSpecifiers],
    inlineRuntimeUrlSpecifiers: [...inlineRuntimeUrlSpecifiers],
    requiresFullDalilaImportMap,
    hasUnresolvedDynamicImport,
    hasUnresolvedRuntimeUrl,
  };
}

function collectImportMapModuleUrls(importMap, htmlUrl) {
  const moduleUrls = new Set();

  const addTarget = (target) => {
    if (typeof target !== 'string') {
      return;
    }

    const moduleUrl = resolveSpecifierToPackagedUrl(target, htmlUrl, { imports: {}, scopes: {} });
    if (moduleUrl && isJavaScriptModuleUrl(moduleUrl)) {
      moduleUrls.add(moduleUrl);
    }
  };

  for (const target of Object.values(importMap?.imports ?? {})) {
    addTarget(target);
  }

  for (const scopeImports of Object.values(importMap?.scopes ?? {})) {
    if (!scopeImports || typeof scopeImports !== 'object' || Array.isArray(scopeImports)) {
      continue;
    }

    for (const target of Object.values(scopeImports)) {
      addTarget(target);
    }
  }

  return [...moduleUrls];
}

function resolvePackagedModuleSourcePath(moduleUrl, buildConfig, dalilaRoot) {
  const { pathname } = splitUrlTarget(moduleUrl);

  if (pathname.startsWith('/vendor/dalila/')) {
    return path.join(dalilaRoot, 'dist', pathname.slice('/vendor/dalila/'.length));
  }

  if (pathname.startsWith('/vendor/node_modules/')) {
    return path.join(buildConfig.projectDir, 'node_modules', pathname.slice('/vendor/node_modules/'.length));
  }

  const packagedPath = path.join(buildConfig.packageOutDirAbs, pathname.slice(1));
  if (fs.existsSync(packagedPath)) {
    return packagedPath;
  }

  return path.join(buildConfig.projectDir, pathname.slice(1));
}

function traceReachableModules(page, importMap, buildConfig, dalilaRoot) {
  const reachableModuleUrls = new Set();
  const staticReachableModuleUrls = new Set();
  const usedDalilaSpecifiers = new Set();
  const classicScriptUrlSet = new Set(page.classicScriptUrls ?? []);
  const pendingUrls = [];
  const pendingKeys = new Set();
  const processedKeys = new Set();
  let requiresFullDalilaImportMap = page.requiresFullDalilaImportMap === true;
  let hasUnresolvedDynamicImport = page.hasUnresolvedDynamicImport === true;
  let hasUnresolvedRuntimeUrl = page.hasUnresolvedRuntimeUrl === true;

  const enqueueResolvedUrl = (moduleUrl, isStatic = false) => {
    if (!moduleUrl || !isJavaScriptModuleUrl(moduleUrl)) {
      return;
    }

    const queueKey = `${moduleUrl}::${isStatic ? 'static' : 'dynamic'}`;
    if (processedKeys.has(queueKey) || pendingKeys.has(queueKey)) {
      return;
    }

    if (reachableModuleUrls.has(moduleUrl) && isStatic) {
      staticReachableModuleUrls.add(moduleUrl);
    }

    pendingUrls.push({ moduleUrl, isStatic });
    pendingKeys.add(queueKey);
  };

  for (const entryModuleUrl of page.entryModuleUrls) {
    enqueueResolvedUrl(entryModuleUrl, true);
  }

  for (const classicScriptUrl of page.classicScriptUrls ?? []) {
    enqueueResolvedUrl(classicScriptUrl, false);
  }

  for (const specifier of page.inlineModuleSpecifiers) {
    if (specifier === 'dalila' || specifier.startsWith('dalila/')) {
      usedDalilaSpecifiers.add(specifier);
    }

    const isStatic = page.inlineStaticModuleSpecifiers?.includes(specifier) ?? false;
    enqueueResolvedUrl(resolveSpecifierToPackagedUrl(specifier, page.htmlUrl, importMap, page.htmlUrl), isStatic);
  }

  for (const runtimeUrlSpecifier of page.inlineRuntimeUrlSpecifiers ?? []) {
    enqueueResolvedUrl(resolveSpecifierToPackagedUrl(runtimeUrlSpecifier, page.htmlUrl, importMap, page.htmlUrl), false);
  }

  while (pendingUrls.length > 0) {
    const pending = pendingUrls.pop();
    const moduleUrl = pending?.moduleUrl;
    const isStaticRoot = pending?.isStatic === true;
    const queueKey = moduleUrl ? `${moduleUrl}::${isStaticRoot ? 'static' : 'dynamic'}` : null;
    if (queueKey) {
      pendingKeys.delete(queueKey);
    }
    if (!moduleUrl) {
      continue;
    }
    if (queueKey && processedKeys.has(queueKey)) {
      continue;
    }
    if (queueKey) {
      processedKeys.add(queueKey);
    }

    const sourcePath = resolvePackagedModuleSourcePath(moduleUrl, buildConfig, dalilaRoot);
    ensureFileExists(sourcePath, `module dependency "${moduleUrl}"`);
    reachableModuleUrls.add(moduleUrl);
    if (isStaticRoot) {
      staticReachableModuleUrls.add(moduleUrl);
    }

    const source = fs.readFileSync(sourcePath, 'utf8');
    const collectedSpecifiers = collectModuleSpecifierKinds(source, buildConfig.ts);
    if (collectedSpecifiers.hasUnresolvedDalilaDynamicImport) {
      requiresFullDalilaImportMap = true;
    }
    if (collectedSpecifiers.hasUnresolvedDynamicImport) {
      hasUnresolvedDynamicImport = true;
    }
    if (collectedSpecifiers.hasUnresolvedRuntimeUrl) {
      hasUnresolvedRuntimeUrl = true;
    }
    for (const specifier of collectedSpecifiers.allSpecifiers) {
      if (specifier === 'dalila' || specifier.startsWith('dalila/')) {
        usedDalilaSpecifiers.add(specifier);
      }

      const isStaticDependency = isStaticRoot && collectedSpecifiers.staticSpecifiers.includes(specifier);
      enqueueResolvedUrl(resolveSpecifierToPackagedUrl(specifier, moduleUrl, importMap, page.htmlUrl), isStaticDependency);
    }

    const runtimeSpecifierBaseUrl = classicScriptUrlSet.has(moduleUrl) ? page.htmlUrl : moduleUrl;
    for (const runtimeUrlSpecifier of collectedSpecifiers.runtimeUrlSpecifiers ?? []) {
      enqueueResolvedUrl(resolveSpecifierToPackagedUrl(runtimeUrlSpecifier, runtimeSpecifierBaseUrl, importMap, page.htmlUrl), false);
    }
  }

  return {
    reachableModuleUrls,
    staticReachableModuleUrls,
    usedDalilaSpecifiers,
    requiresFullDalilaImportMap,
    hasUnresolvedDynamicImport,
    hasUnresolvedRuntimeUrl,
  };
}

function copyReachableDalilaModules(reachableModuleUrls, packageOutDirAbs, dalilaRoot) {
  for (const moduleUrl of reachableModuleUrls) {
    const { pathname } = splitUrlTarget(moduleUrl);
    if (!pathname.startsWith('/vendor/dalila/')) {
      continue;
    }

    const sourcePath = path.join(dalilaRoot, 'dist', pathname.slice('/vendor/dalila/'.length));
    const destinationPath = path.join(packageOutDirAbs, pathname.slice(1));
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);
  }
}

function copyDalilaModuleClosure(moduleUrls, packageOutDirAbs, dalilaRoot, ts) {
  const pendingUrls = [...moduleUrls];
  const copiedUrls = new Set();

  while (pendingUrls.length > 0) {
    const moduleUrl = pendingUrls.pop();
    const { pathname } = splitUrlTarget(moduleUrl);
    if (!pathname.startsWith('/vendor/dalila/') || copiedUrls.has(moduleUrl)) {
      continue;
    }

    copiedUrls.add(moduleUrl);
    const sourcePath = path.join(dalilaRoot, 'dist', pathname.slice('/vendor/dalila/'.length));
    ensureFileExists(sourcePath, `dalila module "${moduleUrl}"`);
    const destinationPath = path.join(packageOutDirAbs, pathname.slice(1));
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);

    const source = fs.readFileSync(sourcePath, 'utf8');
    const collectedSpecifiers = collectModuleSpecifierKinds(source, ts);
    for (const specifier of collectedSpecifiers.allSpecifiers) {
      const resolvedUrl = resolveSpecifierToPackagedUrl(specifier, moduleUrl, { imports: {}, scopes: {} });
      if (resolvedUrl?.startsWith('/vendor/dalila/')) {
        pendingUrls.push(resolvedUrl);
      }
    }
  }
}

function prunePackagedCompiledArtifacts(
  buildConfig,
  _reachableModuleUrls,
  copiedSourceAssetPaths = new Set(),
  _preserveCompiledJavaScript = false
) {
  for (const filePath of walkFiles(buildConfig.packageOutDirAbs)) {
    const relativePath = path.relative(buildConfig.packageOutDirAbs, filePath);
    if (!isRelativePathInsideBase(relativePath)) {
      continue;
    }

    if (relativePath.startsWith(`vendor${path.sep}`) || relativePath === 'vendor') {
      continue;
    }

    if (copiedSourceAssetPaths.has(filePath)) {
      continue;
    }

    if (TYPE_ARTIFACT_EXTENSIONS.some((extension) => filePath.endsWith(extension))) {
      fs.rmSync(filePath, { force: true });
      continue;
    }
  }
}

function pickDalilaImportEntries(dalilaImportEntries, usedDalilaSpecifiers, requiresFullDalilaImportMap = false) {
  if (requiresFullDalilaImportMap) {
    return { ...dalilaImportEntries };
  }

  if (usedDalilaSpecifiers.size === 0) {
    return {};
  }

  const selectedEntries = {};
  for (const specifier of usedDalilaSpecifiers) {
    if (dalilaImportEntries[specifier]) {
      selectedEntries[specifier] = dalilaImportEntries[specifier];
    }
  }

  return selectedEntries;
}

function copyDalilaImportEntryTargets(importEntries, packageOutDirAbs, dalilaRoot, ts) {
  const dalilaModuleUrls = Object.values(importEntries)
    .filter((target) => typeof target === 'string' && target.startsWith('/vendor/dalila/'));
  copyDalilaModuleClosure(dalilaModuleUrls, packageOutDirAbs, dalilaRoot, ts);
}

function shouldPackageHtmlEntry(source) {
  return /<script[^>]*type=["']module["'][^>]*>/i.test(source)
    || /<script[^>]*\bsrc=["'][^"']+\.(?:js|mjs|cjs)(?:[?#][^"']*)?["'][^>]*>/i.test(source)
    || /<script\b(?![^>]*type=["'](?:module|importmap)["'])[^>]*>[\s\S]*?\bimport\s*\(/i.test(source)
    || /<script\b(?![^>]*type=["']importmap["'])[^>]*>[\s\S]*?(?:\bimportScripts\s*\(|\bnew\s+(?:SharedWorker|Worker)\s*\(|\.serviceWorker\s*\.\s*register\s*\()/i.test(source)
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
  const anyScriptMatch = headContent.match(/<script\b[^>]*>/i);
  const moduleScriptMatch = headContent.match(/<script\b[^>]*\btype=["']module["'][^>]*>/i);
  const stylesheetMatch = headContent.match(/<link\b[^>]*\brel=["']stylesheet["'][^>]*>/i);
  const insertionOffset = anyScriptMatch?.index
    ?? moduleScriptMatch?.index
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
  let rewrittenHtml = '';
  let lastIndex = 0;

  forEachHtmlScriptElement(html, (element) => {
    rewrittenHtml += html.slice(lastIndex, element.start);
    lastIndex = element.end;

    const type = getHtmlAttributeValue(element.attributesSource, 'type');
    if ((type ?? '').toLowerCase() !== 'module') {
      rewrittenHtml += element.fullMatch;
      return;
    }

    const src = getHtmlAttributeValue(element.attributesSource, 'src');
    if (src) {
      const rewrittenSrc = rewriteLocalSourceTarget(src, buildConfig, baseDirAbs);
      if (!rewrittenSrc) {
        rewrittenHtml += element.fullMatch;
        return;
      }

      const rewrittenAttributesSource = replaceHtmlAttributeValue(element.attributesSource, 'src', rewrittenSrc);
      if (rewrittenAttributesSource != null) {
        rewrittenHtml += `<script${rewrittenAttributesSource}>${element.content}</script>`;
        return;
      }

      rewrittenHtml += element.fullMatch;
      return;
    }

    const rewrittenContent = rewriteInlineModuleSpecifiers(element.content, buildConfig, baseDirAbs);
    if (rewrittenContent === element.content) {
      rewrittenHtml += element.fullMatch;
      return;
    }

    rewrittenHtml += `<script${element.attributesSource}>${rewrittenContent}</script>`;
  });

  if (lastIndex === 0) {
    return html;
  }

  return `${rewrittenHtml}${html.slice(lastIndex)}`;
}

function buildHtmlDocument(html, importEntries, buildConfig, modulePreloadUrls = []) {
  return injectHeadContent(html, [
    FOUC_PREVENTION_STYLE,
    renderPreloadScriptTags(buildConfig.sourceDirAbs),
    renderModulePreloadLinks(modulePreloadUrls),
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

function copyTopLevelStaticDirs(projectDir, packageOutDirAbs, buildConfig, copiedAssetPaths = new Set()) {
  for (const dirName of collectTopLevelStaticDirs(projectDir, buildConfig)) {
    const sourceDir = path.join(projectDir, dirName);
    const destinationDir = path.join(packageOutDirAbs, dirName);
    copyDirectoryContents(sourceDir, destinationDir);
    for (const copiedPath of walkFiles(destinationDir)) {
      copiedAssetPaths.add(copiedPath);
    }
  }
}

function copyTopLevelStaticFiles(projectDir, packageOutDirAbs, copiedAssetPaths = new Set()) {
  for (const entry of fs.readdirSync(projectDir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name.startsWith('.') || STATIC_FILE_EXCLUDES.has(entry.name)) {
      continue;
    }

    const sourcePath = path.join(projectDir, entry.name);
    const destinationPath = path.join(packageOutDirAbs, entry.name);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);
    copiedAssetPaths.add(destinationPath);
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
  const copiedAssetPaths = new Set();
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
        copiedAssetPaths.add(destinationPath);
      }
    }
  }

  const publicDir = path.join(projectDir, 'public');
  if (fs.existsSync(publicDir)) {
    const publicOutDir = path.join(buildConfig.packageOutDirAbs, 'public');
    copyDirectoryContents(publicDir, publicOutDir);
    for (const copiedPath of walkFiles(publicOutDir)) {
      const relativePath = path.relative(publicOutDir, copiedPath);
      const sourcePath = path.join(publicDir, relativePath);
      if (fs.existsSync(sourcePath) && fs.statSync(sourcePath).isFile()) {
        copiedAssetPaths.add(copiedPath);
      }
    }
  }

  copyTopLevelStaticDirs(projectDir, buildConfig.packageOutDirAbs, buildConfig, copiedAssetPaths);
  copyTopLevelStaticFiles(projectDir, buildConfig.packageOutDirAbs, copiedAssetPaths);

  return copiedAssetPaths;
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

function collectHtmlEntryPoints(projectDir, vendorDir, buildConfig, copiedPackages, dalilaImportEntries, dalilaRoot) {
  const pages = [];

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

    const { html: htmlWithoutImportMap } = extractImportMap(source);
    const rewrittenHtml = rewriteHtmlModuleScripts(htmlWithoutImportMap, buildConfig, baseDirAbs);
    const packagedHtmlPath = path.join(buildConfig.packageOutDirAbs, path.relative(projectDir, sourceHtmlPath));
    const htmlUrl = `/${toPosixPath(path.relative(projectDir, sourceHtmlPath))}`;
    const htmlModuleEntries = collectHtmlModuleEntries(rewrittenHtml, htmlUrl, buildConfig.ts);
    const publicImportMapModuleUrls = collectImportMapModuleUrls(
      {
        imports: rewrittenImports,
        scopes: rewrittenScopes,
      },
      htmlUrl
    );
    const traceImportMap = {
      ...existingImportMap,
      imports: {
        ...rewrittenImports,
        ...buildUserProjectImportEntries(buildConfig),
        ...dalilaImportEntries,
      },
      scopes: rewrittenScopes,
    };
    const {
      reachableModuleUrls,
      staticReachableModuleUrls,
      usedDalilaSpecifiers,
      requiresFullDalilaImportMap,
      hasUnresolvedDynamicImport,
      hasUnresolvedRuntimeUrl,
    } = traceReachableModules(
      {
        htmlUrl,
        ...htmlModuleEntries,
      },
      traceImportMap,
      buildConfig,
      dalilaRoot
    );
    const publicImportMapTrace = traceReachableModules(
      {
        htmlUrl,
        entryModuleUrls: publicImportMapModuleUrls,
        inlineModuleSpecifiers: [],
      },
      traceImportMap,
      buildConfig,
      dalilaRoot
    );

    pages.push({
      htmlUrl,
      packagedHtmlPath,
      rewrittenHtml,
      rewrittenImports,
      rewrittenScopes,
      existingImportMap,
      entryModuleUrls: htmlModuleEntries.entryModuleUrls,
      reachableModuleUrls,
      staticReachableModuleUrls,
      preservedModuleUrls: publicImportMapTrace.reachableModuleUrls,
      usedDalilaSpecifiers: new Set([
        ...usedDalilaSpecifiers,
        ...publicImportMapTrace.usedDalilaSpecifiers,
      ]),
      requiresFullDalilaImportMap: requiresFullDalilaImportMap || publicImportMapTrace.requiresFullDalilaImportMap,
      hasUnresolvedDynamicImport: hasUnresolvedDynamicImport || publicImportMapTrace.hasUnresolvedDynamicImport,
      hasUnresolvedRuntimeUrl: hasUnresolvedRuntimeUrl || publicImportMapTrace.hasUnresolvedRuntimeUrl,
    });
  }

  return pages;
}

function writePackagedHtmlEntryPoints(pages, buildConfig, dalilaImportEntries) {
  for (const page of pages) {
    const importMap = {
      ...page.existingImportMap,
      imports: {
        ...page.rewrittenImports,
        ...buildUserProjectImportEntries(buildConfig),
        ...pickDalilaImportEntries(dalilaImportEntries, page.usedDalilaSpecifiers, page.requiresFullDalilaImportMap),
      },
      scopes: page.rewrittenScopes,
    };
    const modulePreloadUrls = [...page.staticReachableModuleUrls]
      .filter((moduleUrl) => !page.entryModuleUrls.includes(moduleUrl));
    const packagedHtml = buildHtmlDocument(page.rewrittenHtml, importMap, buildConfig, modulePreloadUrls);
    fs.mkdirSync(path.dirname(page.packagedHtmlPath), { recursive: true });
    fs.writeFileSync(page.packagedHtmlPath, packagedHtml);
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
    const copiedSourceAssetPaths = copyPackagedSourceAssets(rootDir, buildConfig);
    const dalilaImportEntries = buildDalilaImportEntries(rootDir);
    const copiedPackages = new Set();
    const pages = collectHtmlEntryPoints(
      rootDir,
      vendorDir,
      buildConfig,
      copiedPackages,
      dalilaImportEntries,
      dalilaRoot
    );
    const reachableModuleUrls = new Set(
      pages.flatMap((page) => [...page.reachableModuleUrls, ...page.preservedModuleUrls])
    );
    const preserveCompiledJavaScript = pages.some(
      (page) => page.hasUnresolvedDynamicImport === true || page.hasUnresolvedRuntimeUrl === true
    );
    prunePackagedCompiledArtifacts(
      buildConfig,
      reachableModuleUrls,
      copiedSourceAssetPaths,
      preserveCompiledJavaScript
    );
    copyReachableDalilaModules(reachableModuleUrls, distDir, dalilaRoot);
    for (const page of pages) {
      const selectedDalilaEntries = pickDalilaImportEntries(
        dalilaImportEntries,
        page.usedDalilaSpecifiers,
        page.requiresFullDalilaImportMap
      );
      copyDalilaImportEntryTargets(selectedDalilaEntries, distDir, dalilaRoot, buildConfig.ts);
    }
    copyDirectoryContents(path.join(rootDir, 'public'), path.join(distDir, 'public'));
    copyTopLevelStaticDirs(rootDir, distDir, buildConfig);
    copyTopLevelStaticFiles(rootDir, distDir);
    writePackagedHtmlEntryPoints(pages, buildConfig, dalilaImportEntries);

    return {
      distDir,
      importEntries: {
        imports: {
          ...buildUserProjectImportEntries(buildConfig),
          ...dalilaImportEntries,
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
