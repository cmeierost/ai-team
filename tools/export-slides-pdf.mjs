import fs from 'node:fs/promises';
import fssync from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const workspaceRoot = process.cwd();
const slidesDir = path.resolve(workspaceRoot, 'slides');
const defaultOutputPath = path.resolve(slidesDir, 'out', 'ai-team-slides.pdf');
const outputArg = process.argv[2];
const outputPath = path.resolve(workspaceRoot, outputArg ?? defaultOutputPath);
const loadPause = Number(process.env.SLIDES_PDF_LOAD_PAUSE ?? 2000);
const chromePath = resolveBrowserPath();
const decktapeRuntime = resolveDecktapeRuntime();
const usePrintPdf =
  String(process.env.SLIDES_PDF_USE_PRINT_PDF ?? 'false').toLowerCase() === 'true';
const forcePuppeteer =
  String(process.env.SLIDES_PDF_FORCE_PUPPETEER ?? '').toLowerCase() === 'true';
const pdfMedia = (process.env.SLIDES_PDF_MEDIA ?? 'screen').toLowerCase();
const pdfScale = Number(process.env.SLIDES_PDF_SCALE ?? 1);
const viewportWidth = Number(process.env.SLIDES_PDF_VIEWPORT_WIDTH ?? 1920);
const viewportHeight = Number(process.env.SLIDES_PDF_VIEWPORT_HEIGHT ?? 1080);
const pdfWidth = process.env.SLIDES_PDF_WIDTH ?? '13.333in';
const pdfHeight = process.env.SLIDES_PDF_HEIGHT ?? '7.5in';

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
  ['.gif', 'image/gif'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
  ['.otf', 'font/otf'],
  ['.eot', 'application/vnd.ms-fontobject'],
]);

function resolveBrowserPath() {
  const envCandidates = [
    process.env.CHROME_PATH,
    process.env.CHROME_BIN,
    process.env.EDGE_PATH,
  ].filter(Boolean);

  const windowsCandidates = [
    String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`,
    String.raw`C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`,
    String.raw`C:\Program Files\Microsoft\Edge\Application\msedge.exe`,
    String.raw`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`,
    String.raw`C:\Program Files\Chromium\Application\chrome.exe`,
  ];

  const unixCandidates = [
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ];

  const candidates = [
    ...envCandidates,
    ...(process.platform === 'win32' ? windowsCandidates : unixCandidates),
  ];

  const found = candidates.find((candidate) => candidate && fssync.existsSync(candidate));
  if (!found) {
    throw new Error(
      'No Chrome/Edge/Chromium executable found. Set CHROME_PATH, CHROME_BIN, or EDGE_PATH.'
    );
  }
  return found;
}

function resolveDecktapeRuntime() {
  const localPackageEntrypoint = path.resolve(
    workspaceRoot,
    'node_modules',
    'decktape',
    'decktape.js'
  );

  if (fssync.existsSync(localPackageEntrypoint)) {
    return {
      command: process.execPath,
      prefixArgs: [localPackageEntrypoint],
    };
  }

  return {
    command: 'decktape',
    prefixArgs: [],
  };
}

function getMimeType(filePath) {
  return mimeTypes.get(path.extname(filePath).toLowerCase()) ?? 'application/octet-stream';
}

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) || rel === '';
}

async function createStaticServer(rootDir) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const requestedPath = path.normalize(path.join(rootDir, pathname));

      if (!isInside(rootDir, requestedPath)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
      }

      let filePath = requestedPath;
      const stat = await fs.stat(filePath).catch(() => null);
      if (stat?.isDirectory()) {
        filePath = path.join(filePath, 'index.html');
      }

      const data = await fs.readFile(filePath);
      res.writeHead(200, { 'Content-Type': getMimeType(filePath), 'Cache-Control': 'no-store' });
      res.end(data);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Could not determine local server port.');
  }

  return {
    server,
    url: `http://127.0.0.1:${address.port}/index.html${usePrintPdf ? '?print-pdf' : ''}`,
  };
}

async function ensureOutputDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function loadPuppeteer() {
  try {
    const mod = await import('puppeteer-core');
    return mod.default ?? mod;
  } catch {
    const bundledPath =
      '/usr/local/lib/node_modules/decktape/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
    if (fssync.existsSync(bundledPath)) {
      const mod = await import(pathToFileURL(bundledPath).href);
      return mod.default ?? mod;
    }

    throw new Error(
      'puppeteer-core not found. Install it locally or use the Docker image with DeckTape bundled dependencies.'
    );
  }
}

async function loadPdfLib() {
  try {
    const mod = await import('pdf-lib');
    return mod;
  } catch {
    const bundledPath = '/usr/local/lib/node_modules/decktape/node_modules/pdf-lib/cjs/index.js';
    if (fssync.existsSync(bundledPath)) {
      const mod = await import(pathToFileURL(bundledPath).href);
      return mod;
    }

    throw new Error('pdf-lib not found. Install it locally to build screenshot PDFs.');
  }
}

async function waitForReveal(page) {
  try {
    await page.waitForFunction(
      () => {
        const reveal = globalThis.Reveal;
        return reveal !== undefined && typeof reveal.getSlides === 'function';
      },
      { timeout: 60000 },
    );
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          const reveal = globalThis.Reveal;
          if (!reveal || typeof reveal.isReady !== 'function') {
            resolve(false);
            return;
          }
          if (reveal.isReady()) {
            resolve(true);
            return;
          }
          const timer = setTimeout(() => resolve(false), 15000);
          try {
            reveal.on('ready', () => {
              clearTimeout(timer);
              resolve(true);
            });
          } catch {
            clearTimeout(timer);
            resolve(false);
          }
        }),
    );
    return true;
  } catch {
    return false;
  }
}

async function getSlideIndices(page) {
  return page.evaluate(() => {
    const reveal = globalThis.Reveal;
    if (reveal && typeof reveal.getSlides === 'function') {
      return reveal.getSlides().map((slide) => reveal.getIndices(slide));
    }

    const slides = Array.from(document.querySelectorAll('.slides > section'));
    return slides.map((_, index) => ({ h: index, v: 0, f: 0 }));
  });
}

async function showSlide(page, idx, revealAvailable) {
  if (revealAvailable) {
    await page.evaluate((target) => {
      const reveal = globalThis.Reveal;
      if (!reveal || typeof reveal.slide !== 'function') return;
      reveal.slide(target.h, target.v, target.f ?? 0);
    }, idx);
    return;
  }

  await page.evaluate((target) => {
    const slides = Array.from(document.querySelectorAll('.slides > section'));
    slides.forEach((slide, index) => {
      slide.style.display = index === target.h ? 'block' : 'none';
    });
  }, idx);
}

function parseLengthToPoints(value) {
  if (!value) return null;
  const match = /^([0-9.]+)(in|mm|cm|px)?$/i.exec(String(value).trim());
  if (!match) return null;
  const num = Number(match[1]);
  const unit = (match[2] ?? 'px').toLowerCase();
  if (!Number.isFinite(num)) return null;
  if (unit === 'in') return num * 72;
  if (unit === 'cm') return (num / 2.54) * 72;
  if (unit === 'mm') return (num / 25.4) * 72;
  return num * 0.75; // px -> pt approx (96dpi)
}

function runDecktape(url, pdfPath) {
  const args = [
    ...decktapeRuntime.prefixArgs,
    'reveal',
    '--no-fragments',
    '--chrome-path',
    chromePath,
    '--chrome-arg=--no-sandbox',
    '--chrome-arg=--disable-setuid-sandbox',
    '--chrome-arg=--disable-gpu',
    '--chrome-arg=--allow-file-access-from-files',
    '--chrome-arg=--disable-dev-shm-usage',
    '--load-pause',
    String(loadPause),
    url,
    pdfPath,
  ];

  console.log(`[slides:pdf] URL: ${url}`);
  console.log(`[slides:pdf] Output: ${pdfPath}`);
  console.log(`[slides:pdf] Browser: ${chromePath}`);
  console.log(`[slides:pdf] Command: ${decktapeRuntime.command} ${args.join(' ')}`);

  return new Promise((resolve, reject) => {
    const child = spawn(decktapeRuntime.command, args, {
      cwd: workspaceRoot,
      stdio: 'inherit',
      shell: false,
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`DeckTape exited with code ${code}`));
    });
  });
}

async function renderWithPuppeteer(url, pdfPath) {
  console.log('[slides:pdf] Falling back to Puppeteer print-pdf rendering...');

  const puppeteer = await loadPuppeteer();

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--allow-file-access-from-files',
      '--disable-dev-shm-usage',
    ],
  });

  try {
    const page = await browser.newPage();
      page.on('console', (msg) => {
        const type = msg.type();
        const text = msg.text();
        if (type === 'error' || type === 'warning') {
          console.log(`[slides:pdf][browser:${type}] ${text}`);
        }
      });
      page.on('pageerror', (error) => {
        console.log(`[slides:pdf][pageerror] ${String(error)}`);
      });
      page.on('requestfailed', (request) => {
        const url = request.url();
        const failure = request.failure();
        if (url.includes('reveal') || url.includes('unpkg')) {
          console.log(`[slides:pdf][requestfailed] ${url} ${failure?.errorText ?? ''}`);
        }
      });
    await page.setRequestInterception(true);
    page.on('request', async (request) => {
      const requestUrl = request.url();
      const revealPrefix = 'https://unpkg.com/reveal.js@5/';

      if (requestUrl.startsWith(revealPrefix)) {
        const relativePath = requestUrl.slice(revealPrefix.length).split('?')[0];
        const localPath = path.resolve(workspaceRoot, 'node_modules', 'reveal.js', relativePath);
        if (fssync.existsSync(localPath)) {
          console.log(`[slides:pdf][asset] ${relativePath} -> local`);
          const body = await fs.readFile(localPath);
          await request.respond({
            status: 200,
            contentType: getMimeType(localPath),
            body,
          });
          return;
        }

        console.log(`[slides:pdf][asset-miss] ${relativePath} not found locally`);
      }

      await request.continue();
    });
    await page.setViewport({ width: viewportWidth, height: viewportHeight, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const revealState = await page.evaluate(() => typeof globalThis.Reveal);
    console.log(`[slides:pdf] Reveal global after DOMContentLoaded: ${revealState}`);

    await page.evaluate(async () => {
      if (document.fonts !== undefined) {
        await document.fonts.ready;
      }
    });
    const revealAvailable = await waitForReveal(page);
    if (!revealAvailable) {
      throw new Error('Reveal did not initialize in time. Export requires Reveal to update slide backgrounds.');
    }
    await new Promise((resolve) => setTimeout(resolve, Math.max(2500, loadPause)));

    if (usePrintPdf) {
      await page.emulateMediaType(pdfMedia === 'screen' ? 'screen' : 'print');
      await page.pdf({
        path: pdfPath,
        printBackground: true,
        preferCSSPageSize: !pdfWidth && !pdfHeight,
        ...(pdfWidth ? { width: pdfWidth } : {}),
        ...(pdfHeight ? { height: pdfHeight } : {}),
        scale: Number.isFinite(pdfScale) ? pdfScale : 1,
      });
      return;
    }

    await page.emulateMediaType('screen');
    const { PDFDocument } = await loadPdfLib();
    const pdfDoc = await PDFDocument.create();
    const pageWidth = parseLengthToPoints(pdfWidth) ?? viewportWidth * 0.75;
    const pageHeight = parseLengthToPoints(pdfHeight) ?? viewportHeight * 0.75;

    const indices = await getSlideIndices(page);

    const slideIndices =
      Array.isArray(indices) && indices.length > 0 ? indices : [{ h: 0, v: 0, f: 0 }];

    for (const idx of slideIndices) {
      await showSlide(page, idx, revealAvailable);

      await new Promise((resolve) => setTimeout(resolve, 400));

      const buffer = await page.screenshot({
        type: 'png',
        clip: { x: 0, y: 0, width: viewportWidth, height: viewportHeight },
      });

      const image = await pdfDoc.embedPng(buffer);
      const pageRef = pdfDoc.addPage([pageWidth, pageHeight]);
      pageRef.drawImage(image, {
        x: 0,
        y: 0,
        width: pageWidth,
        height: pageHeight,
      });
    }

    const pdfBytes = await pdfDoc.save();
    await fs.writeFile(pdfPath, pdfBytes);
  } finally {
    await browser.close();
  }
}

async function main() {
  await ensureOutputDir(outputPath);
  const { server, url } = await createStaticServer(slidesDir);

  try {
    if (forcePuppeteer) {
      await renderWithPuppeteer(url, outputPath);
    } else {
      try {
        await runDecktape(url, outputPath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (
          /Unable to activate the Reveal JS DeckTape plugin/i.test(message) ||
          /DeckTape exited with code 1/i.test(message)
        ) {
          await renderWithPuppeteer(url, outputPath);
        } else {
          throw error;
        }
      }
    }
    console.log(`[slides:pdf] PDF created: ${path.relative(workspaceRoot, outputPath)}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

try {
  await main();
} catch (error) {
  console.error(`[slides:pdf] Failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
