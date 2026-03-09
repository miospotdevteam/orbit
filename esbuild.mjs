import * as esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');

// Extension host bundle (Node.js)
const extensionConfig = {
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'out/extension.js',
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    external: ['vscode'],
    sourcemap: true,
};

// Webview bundle (browser, React)
const webviewConfig = {
    entryPoints: ['src/webview/app.tsx'],
    bundle: true,
    outfile: 'out/webview.js',
    platform: 'browser',
    target: 'es2021',
    format: 'iife',
    sourcemap: true,
    define: {
        'process.env.NODE_ENV': '"production"',
    },
};

// MCP server bundle (Node.js, standalone)
const mcpServerConfig = {
    entryPoints: ['src/mcp/server.ts'],
    bundle: true,
    outfile: 'out/mcp-server.js',
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    external: ['vscode'],
    sourcemap: true,
    banner: { js: '#!/usr/bin/env node' },
};

async function build() {
    if (isWatch) {
        const extCtx = await esbuild.context(extensionConfig);
        const webCtx = await esbuild.context(webviewConfig);
        const mcpCtx = await esbuild.context(mcpServerConfig);
        await Promise.all([extCtx.watch(), webCtx.watch(), mcpCtx.watch()]);
        console.log('Watching for changes...');
    } else {
        await Promise.all([
            esbuild.build(extensionConfig),
            esbuild.build(webviewConfig),
            esbuild.build(mcpServerConfig),
        ]);
        console.log('Build complete: out/extension.js, out/webview.js, out/mcp-server.js');
    }
}

build().catch((err) => {
    console.error(err);
    process.exit(1);
});
