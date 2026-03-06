const esbuild = require('esbuild');
const fs = require('fs');

// Clean dist before bundling
if (fs.existsSync('dist')) {
  fs.rmSync('dist', { recursive: true, force: true });
}

esbuild.build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],        // provided by VS Code host at runtime
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  minify: false,
}).catch(() => process.exit(1));
