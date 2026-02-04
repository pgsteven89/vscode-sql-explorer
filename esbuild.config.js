const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const isWatch = process.argv.includes('--watch');

// Ensure directories exist
const mediaDir = path.join(__dirname, 'media');
const assetsDir = path.join(__dirname, 'assets');
const monacoDir = path.join(assetsDir, 'monaco');

[mediaDir, assetsDir, monacoDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Extension build configuration
const extensionConfig = {
    entryPoints: ['./src/extension.ts'],
    bundle: true,
    outfile: './dist/extension.js',
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    sourcemap: true,
    minify: !isWatch,
};

// Webview build configuration
const webviewConfig = {
    entryPoints: ['./media/webview/main.ts'],
    bundle: true,
    outfile: './media/webview.js',
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    sourcemap: true,
    minify: !isWatch,
    loader: {
        '.wasm': 'file',
        '.ttf': 'file',
    },
    define: {
        'process.env.NODE_ENV': isWatch ? '"development"' : '"production"',
    },
};

// Copy DuckDB WASM assets
function copyDuckDBAssets() {
    const duckdbModulePath = require.resolve('@duckdb/duckdb-wasm');
    const duckdbPath = path.dirname(duckdbModulePath);
    // require.resolve returns the main file (dist/index.js), we need the dist folder
    const distPath = path.join(duckdbPath);

    // Actually, sometimes require.resolve('@duckdb/duckdb-wasm') returns .../dist/index.js
    // We want the dist folder which is the parent or same depending on entry point
    const actualDistPath = fs.statSync(distPath).isDirectory() ? distPath : path.dirname(distPath);

    const filesToCopy = [
        'duckdb-mvp.wasm',
        'duckdb-eh.wasm',
        'duckdb-browser-mvp.worker.js',
        'duckdb-browser-eh.worker.js',
    ];

    filesToCopy.forEach(file => {
        const src = path.join(actualDistPath, file);
        const dest = path.join(assetsDir, file);
        if (fs.existsSync(src)) {
            fs.copyFileSync(src, dest);
            console.log(`Copied: ${file}`);
        } else {
            console.warn(`Warning: ${file} not found at ${src}`);
        }
    });
}

// Copy Monaco Editor assets
function copyMonacoAssets() {
    const monacoPath = path.dirname(require.resolve('monaco-editor/package.json'));
    const minPath = path.join(monacoPath, 'min');

    // Copy the min/vs directory which contains the Monaco workers
    const vsDir = path.join(minPath, 'vs');
    const destVsDir = path.join(monacoDir, 'vs');

    if (fs.existsSync(vsDir)) {
        copyFolderRecursiveSync(vsDir, monacoDir);
        console.log('Copied: Monaco Editor assets');
    } else {
        console.warn('Warning: Monaco Editor min/vs directory not found');
    }
}

function copyFolderRecursiveSync(source, target) {
    const targetFolder = path.join(target, path.basename(source));

    if (!fs.existsSync(targetFolder)) {
        fs.mkdirSync(targetFolder, { recursive: true });
    }

    if (fs.lstatSync(source).isDirectory()) {
        const files = fs.readdirSync(source);
        files.forEach(file => {
            const curSource = path.join(source, file);
            if (fs.lstatSync(curSource).isDirectory()) {
                copyFolderRecursiveSync(curSource, targetFolder);
            } else {
                fs.copyFileSync(curSource, path.join(targetFolder, file));
            }
        });
    }
}

async function build() {
    try {
        // Copy assets
        try {
            copyDuckDBAssets();
        } catch (e) {
            console.warn('DuckDB assets not copied (install dependencies first):', e.message);
        }

        try {
            copyMonacoAssets();
        } catch (e) {
            console.warn('Monaco assets not copied (install dependencies first):', e.message);
        }

        if (isWatch) {
            // Watch mode
            const extCtx = await esbuild.context(extensionConfig);
            const webCtx = await esbuild.context(webviewConfig);

            await Promise.all([
                extCtx.watch(),
                webCtx.watch(),
            ]);

            console.log('Watching for changes...');
        } else {
            // Single build
            await Promise.all([
                esbuild.build(extensionConfig),
                esbuild.build(webviewConfig),
            ]);

            console.log('Build complete!');
        }
    } catch (error) {
        console.error('Build failed:', error);
        process.exit(1);
    }
}

build();
