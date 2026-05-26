const esbuild = require('esbuild');
const fs = require('node:fs');

const isWatch = process.argv.includes('--watch');

function cleanDist() {
  if (fs.existsSync('dist')) {
    fs.rmSync('dist', { recursive: true, force: true });
  }
}

const buildOptions = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'], // provided by VS Code host at runtime
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  minify: false,
  logLevel: 'info',
};

async function main() {
  cleanDist();

  if (!isWatch) {
    await esbuild.build(buildOptions);
    return;
  }

  console.log('[ai-team/vscode] Extension watch starting');
  const context = await esbuild.context(buildOptions);
  await context.watch();
  console.log('[ai-team/vscode] Extension watch ready');

  const disposeAsync = async () => {
    await context.dispose();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void disposeAsync();
  });

  process.on('SIGTERM', () => {
    void disposeAsync();
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
