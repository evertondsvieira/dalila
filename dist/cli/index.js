#!/usr/bin/env node
import * as path from 'path';
import * as fs from 'fs';
import { collectHtmlPathDependencyDirs, generateRoutesFile } from './routes-generator.js';
const args = process.argv.slice(2);
const command = args[0];
const subcommand = args[1];
const routeArgs = args.slice(2);
const WATCH_DEBOUNCE_MS = 120;
function showHelp() {
    console.log(`
Dalila CLI

Usage:
  dalila routes generate [options]    Generate routes + manifest from app file structure
  dalila routes init                  Initialize app and generate routes outputs
  dalila routes watch [options]       Watch routes and regenerate outputs on changes
  dalila routes --help                Show routes command help
  dalila help                         Show this help message

Options:
  --output <path>     Output file (default: ./routes.generated.ts)

Examples:
  dalila routes generate
  dalila routes generate --output src/routes.generated.ts
  dalila routes init
`);
}
function showRoutesHelp() {
    console.log(`
Dalila CLI - Routes

Usage:
  dalila routes generate [options]    Generate routes + manifest from app file structure
  dalila routes init                  Initialize app and generate routes outputs
  dalila routes watch [options]       Watch routes and regenerate outputs on changes
  dalila routes --help                Show this help message

Options:
  --output <path>     Output file (default: ./routes.generated.ts)

Examples:
  dalila routes generate
  dalila routes generate --output src/routes.generated.ts
  dalila routes watch
  dalila routes init
`);
}
function hasHelpFlag(list) {
    return list.includes('--help') || list.includes('-h') || list.includes('help');
}
function findProjectRoot(startDir) {
    let current = path.resolve(startDir);
    while (true) {
        if (fs.existsSync(path.join(current, 'package.json'))) {
            return current;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            return null;
        }
        current = parent;
    }
}
async function initRoutes() {
    const appDir = resolveDefaultAppDir(process.cwd());
    if (fs.existsSync(appDir)) {
        console.log('⚠️  App directory already exists');
        return;
    }
    console.log('📁 Creating app directory...');
    fs.mkdirSync(appDir, { recursive: true });
    const starterFiles = {
        'layout.html': `<div class="app">
  <header>
    <h1>My App</h1>
    <nav>
      <a d-link="/">Home</a>
    </nav>
  </header>
  <main data-slot="children"></main>
</div>
`,
        'page.html': `<div>
  <h2>Home</h2>
  <p>Welcome to your Dalila app!</p>
</div>
`
    };
    for (const [filename, content] of Object.entries(starterFiles)) {
        fs.writeFileSync(path.join(appDir, filename), content);
    }
    const appDirLabel = path.relative(process.cwd(), appDir) || appDir;
    const appDirPosix = appDirLabel.replace(/\\/g, '/');
    console.log(`✅ Created app directory with starter files (${appDirLabel}):`);
    for (const filename of Object.keys(starterFiles)) {
        console.log(`   ${path.join(appDirLabel, filename).replace(/\\/g, '/')}`);
    }
    const outputPath = path.join(process.cwd(), 'routes.generated.ts');
    console.log('🧩 Generating routes outputs...');
    try {
        await generateRoutesFile(appDir, outputPath);
    }
    catch (error) {
        console.error('❌ Error generating routes:', error);
        process.exit(1);
    }
    console.log('');
    console.log('Next steps:');
    console.log('  1. Customize your app routes');
    console.log(`  2. Add segments with page.html (e.g. ${appDirPosix}/about/page.html)`);
    console.log(`  3. Add dynamic slugs with folders like ${appDirPosix}/blog/[slug]/page.html`);
    console.log('  4. Optional: add page.ts/layout.ts/middleware.ts for logic/guards');
    console.log('  5. Run: dalila routes generate (after changing app files)');
    console.log('');
}
function resolveDefaultAppDir(cwd) {
    const resolvedCwd = path.resolve(cwd);
    const projectRoot = findProjectRoot(resolvedCwd);
    if (!projectRoot) {
        return path.join(resolvedCwd, 'src', 'app');
    }
    const appRoot = path.join(projectRoot, 'src', 'app');
    if (resolvedCwd === appRoot || resolvedCwd.startsWith(appRoot + path.sep)) {
        return resolvedCwd;
    }
    const relToRoot = path.relative(projectRoot, resolvedCwd);
    if (!relToRoot || relToRoot.startsWith('..')) {
        return appRoot;
    }
    if (relToRoot === 'src' || relToRoot.startsWith('src' + path.sep)) {
        return appRoot;
    }
    return path.join(appRoot, relToRoot);
}
function resolveGenerateConfig(cliArgs, cwd = process.cwd()) {
    const dirIndex = cliArgs.indexOf('--dir');
    const outputIndex = cliArgs.indexOf('--output');
    if (dirIndex !== -1) {
        console.error('❌ --dir is no longer supported. Dalila now resolves app dir automatically from src/app.');
        process.exit(1);
    }
    if (outputIndex !== -1 && !cliArgs[outputIndex + 1]) {
        console.error('❌ Missing value for --output');
        process.exit(1);
    }
    const appDir = dirIndex !== -1
        ? path.resolve(cwd, cliArgs[dirIndex + 1])
        : resolveDefaultAppDir(cwd);
    const outputPath = outputIndex !== -1
        ? path.resolve(cwd, cliArgs[outputIndex + 1])
        : path.join(cwd, 'routes.generated.ts');
    return { appDir, outputPath };
}
async function generateRoutes(cliArgs) {
    const { appDir, outputPath } = resolveGenerateConfig(cliArgs);
    console.log('');
    console.log('🚀 Dalila Routes Generator');
    console.log('');
    try {
        await generateRoutesFile(appDir, outputPath);
    }
    catch (error) {
        console.error('❌ Error generating routes:', error);
        process.exit(1);
    }
}
function collectRouteDirs(rootDir) {
    const dirs = [];
    function visit(dir) {
        dirs.push(dir);
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory())
                continue;
            if (entry.name.startsWith('.'))
                continue;
            visit(path.join(dir, entry.name));
        }
    }
    visit(rootDir);
    return dirs;
}
function resolveExistingWatchDir(targetDir) {
    let current = path.resolve(targetDir);
    while (true) {
        if (fs.existsSync(current)) {
            try {
                if (fs.statSync(current).isDirectory()) {
                    return current;
                }
            }
            catch {
                // Ignore FS races while files are being created/deleted.
            }
        }
        const parent = path.dirname(current);
        if (parent === current)
            return null;
        current = parent;
    }
}
function watchRoutes(cliArgs) {
    const { appDir, outputPath } = resolveGenerateConfig(cliArgs);
    const watchedDirs = new Map();
    const outputAbsPath = path.resolve(outputPath);
    const outputBasePath = outputAbsPath.endsWith('.ts') ? outputAbsPath.slice(0, -3) : outputAbsPath;
    const generatedOutputPaths = new Set([
        outputAbsPath,
        `${outputBasePath}.manifest.ts`,
        `${outputBasePath}.types.ts`
    ]);
    let regenerateTimer = null;
    if (!fs.existsSync(appDir)) {
        console.error('❌ App directory not found:', appDir);
        process.exit(1);
    }
    console.log('');
    console.log('👀 Dalila Routes Watch');
    console.log(`   app: ${appDir}`);
    console.log(`   output: ${outputPath}`);
    console.log('');
    const runGenerate = async () => {
        try {
            await generateRoutesFile(appDir, outputPath);
        }
        catch (error) {
            console.error('❌ Error generating routes:', error);
        }
    };
    const refreshWatchers = () => {
        const nextDirs = new Set(collectRouteDirs(appDir).map(d => path.resolve(d)));
        for (const dependencyDir of collectHtmlPathDependencyDirs(appDir)) {
            const resolvedWatchDir = resolveExistingWatchDir(dependencyDir);
            if (resolvedWatchDir) {
                nextDirs.add(resolvedWatchDir);
            }
        }
        for (const [dir, watcher] of watchedDirs.entries()) {
            if (!nextDirs.has(dir)) {
                watcher.close();
                watchedDirs.delete(dir);
            }
        }
        for (const dir of nextDirs) {
            if (watchedDirs.has(dir))
                continue;
            try {
                const watcher = fs.watch(dir, (_eventType, filename) => {
                    if (filename) {
                        const changedAbsPath = path.resolve(dir, filename.toString());
                        if (generatedOutputPaths.has(changedAbsPath)) {
                            return;
                        }
                    }
                    if (regenerateTimer)
                        clearTimeout(regenerateTimer);
                    regenerateTimer = setTimeout(() => {
                        refreshWatchers();
                        console.log('♻️  Route change detected, regenerating...');
                        runGenerate();
                    }, WATCH_DEBOUNCE_MS);
                });
                watcher.on('error', err => {
                    console.error(`❌ Watch error in ${dir}:`, err);
                });
                watchedDirs.set(dir, watcher);
            }
            catch (error) {
                console.error(`❌ Failed to watch directory ${dir}:`, error);
            }
        }
    };
    const stop = () => {
        if (regenerateTimer)
            clearTimeout(regenerateTimer);
        for (const watcher of watchedDirs.values()) {
            watcher.close();
        }
        watchedDirs.clear();
        console.log('\n🛑 Stopped routes watch');
    };
    runGenerate();
    refreshWatchers();
    process.on('SIGINT', () => {
        stop();
        process.exit(0);
    });
    process.on('SIGTERM', () => {
        stop();
        process.exit(0);
    });
}
// Main
async function main() {
    if (command === 'help' || !command) {
        showHelp();
    }
    else if (command === 'routes') {
        if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
            showRoutesHelp();
        }
        else if (subcommand === 'generate') {
            if (hasHelpFlag(routeArgs)) {
                showRoutesHelp();
            }
            else {
                await generateRoutes(routeArgs);
            }
        }
        else if (subcommand === 'watch') {
            if (hasHelpFlag(routeArgs)) {
                showRoutesHelp();
            }
            else {
                watchRoutes(routeArgs);
            }
        }
        else if (subcommand === 'init') {
            if (hasHelpFlag(routeArgs)) {
                showRoutesHelp();
            }
            else {
                await initRoutes();
            }
        }
        else {
            console.error('Unknown subcommand:', subcommand);
            showRoutesHelp();
            process.exit(1);
        }
    }
    else if (command === '--help' || command === '-h') {
        showHelp();
    }
    else {
        console.error('Unknown command:', command);
        showHelp();
        process.exit(1);
    }
}
main().catch((error) => {
    console.error('❌ Unexpected error:', error);
    process.exit(1);
});
