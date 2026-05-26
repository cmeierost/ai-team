import path from 'node:path';
import { spawn } from 'node:child_process';

const workspaceRoot = process.cwd();
const imageName = process.env.SLIDES_PDF_IMAGE ?? 'ai-team-slides-pdf';
const outputArg = process.argv[2];
const dockerExe = process.env.DOCKER_BIN ?? 'docker';

function run(command, args, label) {
  console.log(`[slides:pdf:docker] ${label}: ${command} ${args.join(' ')}`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: workspaceRoot,
      stdio: 'inherit',
      shell: false,
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} failed with exit code ${code}`));
    });
  });
}

async function main() {
  const buildArgs = ['build', '-f', 'Dockerfile.slides-pdf', '-t', imageName, '.'];
  await run(dockerExe, buildArgs, 'docker build');

  const mountArg = `${workspaceRoot}:/workspace`;
  const runArgs = [
    'run',
    '--rm',
    '-v',
    mountArg,
    '-w',
    '/workspace',
    '-e',
    `SLIDES_PDF_LOAD_PAUSE=${process.env.SLIDES_PDF_LOAD_PAUSE ?? '2000'}`,
    '-e',
    `SLIDES_PDF_FORCE_PUPPETEER=${process.env.SLIDES_PDF_FORCE_PUPPETEER ?? 'true'}`,
    '-e',
    `SLIDES_PDF_MEDIA=${process.env.SLIDES_PDF_MEDIA ?? 'screen'}`,
    '-e',
    `SLIDES_PDF_WIDTH=${process.env.SLIDES_PDF_WIDTH ?? '13.333in'}`,
    '-e',
    `SLIDES_PDF_HEIGHT=${process.env.SLIDES_PDF_HEIGHT ?? '7.5in'}`,
    '-e',
    `SLIDES_PDF_VIEWPORT_WIDTH=${process.env.SLIDES_PDF_VIEWPORT_WIDTH ?? '1920'}`,
    '-e',
    `SLIDES_PDF_VIEWPORT_HEIGHT=${process.env.SLIDES_PDF_VIEWPORT_HEIGHT ?? '1080'}`,
    '-e',
    `SLIDES_PDF_SCALE=${process.env.SLIDES_PDF_SCALE ?? '1'}`,
    '-e',
    'CHROME_BIN=/usr/bin/chromium',
    '-e',
    'CHROME_PATH=/usr/bin/chromium',
    imageName,
    'node',
    'tools/export-slides-pdf.mjs',
  ];

  if (outputArg) {
    runArgs.push(outputArg);
  }

  await run(dockerExe, runArgs, 'docker run');
}

try {
  await main();
} catch (error) {
  console.error(
    `[slides:pdf:docker] Failed: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(1);
}
