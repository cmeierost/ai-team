import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { marked } from 'marked';
import hljs from 'highlight.js';
import puppeteer from 'puppeteer-core';

const workspaceRoot = process.cwd();

const inputArg = process.argv[2] ?? 'docs/architecture/orchestrator-overview.md';
const outputArg = process.argv[3] ?? inputArg.replace(/\.md$/i, '.pdf');

const inputPath = path.resolve(workspaceRoot, inputArg);
const outputPath = path.resolve(workspaceRoot, outputArg);

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function withMermaidBlocks(markdown) {
  const sources = [];
  const mermaidBlockRegex = /```mermaid\r?\n([\s\S]*?)```/g;

  const rewritten = markdown.replace(mermaidBlockRegex, (_full, body) => {
    const idx = sources.length;
    sources.push(body.trim());
    return `<div class="mermaid-block" id="mermaid-${idx}"></div>`;
  });

  return { rewritten, mermaidSources: sources, mermaidCount: sources.length };
}

function sanitizeInlineScript(source) {
  return source.replaceAll('</script', String.raw`<\/script`);
}

async function readFirstExisting(paths, label) {
  for (const p of paths) {
    try {
      return await fs.readFile(p, 'utf8');
    } catch {
      // try next
    }
  }

  throw new Error(`Could not locate ${label}. Tried: ${paths.join(', ')}`);
}

async function loadRenderAssets() {
  const mermaidPaths = [
    path.resolve(workspaceRoot, 'node_modules/mermaid/dist/mermaid.min.js'),
    path.resolve(workspaceRoot, 'node_modules/mermaid/dist/mermaid.js'),
  ];
  const highlightCssPaths = [
    path.resolve(workspaceRoot, 'node_modules/highlight.js/styles/github.min.css'),
    path.resolve(workspaceRoot, 'node_modules/highlight.js/styles/github.css'),
  ];

  const [mermaidJs, hlCss] = await Promise.all([
    readFirstExisting(mermaidPaths, 'mermaid runtime'),
    readFirstExisting(highlightCssPaths, 'highlight.js stylesheet'),
  ]);

  return {
    mermaidJs: sanitizeInlineScript(mermaidJs),
    highlightCss: hlCss,
  };
}

function renderMarkdownWithHighlight(markdown) {
  const renderer = new marked.Renderer();
  renderer.code = ({ text, lang }) => {
    const language = typeof lang === 'string' ? lang.trim() : '';
    let highlighted;

    if (language && hljs.getLanguage(language)) {
      highlighted = hljs.highlight(text, { language, ignoreIllegals: true }).value;
    } else {
      highlighted = hljs.highlightAuto(text).value;
    }

    const languageClass = language ? ` language-${language}` : '';
    return `<pre><code class="hljs${languageClass}">${highlighted}</code></pre>`;
  };

  const rendered = marked.parse(markdown, { breaks: false, gfm: true, renderer });
  if (typeof rendered !== 'string') {
    throw new TypeError('Markdown renderer returned a non-string result.');
  }
  return rendered;
}

function buildHtml(title, bodyHtml, assets, mermaidSources) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <style>
      body {
        font-family: Segoe UI, system-ui, -apple-system, sans-serif;
        margin: 24px;
        color: #111827;
        line-height: 1.45;
      }
      h1, h2, h3 { margin-top: 1.2em; margin-bottom: 0.5em; }
      pre {
        background: #f6f8fa;
        border-radius: 8px;
        padding: 12px;
        overflow-x: hidden;
        border: 1px solid #e5e7eb;
      }
      code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      pre code {
        display: block;
        white-space: pre-wrap;
        word-break: break-all;
        overflow-wrap: break-word;
      }
      table { border-collapse: collapse; width: 100%; }
      table, th, td { border: 1px solid #e5e7eb; }
      th, td { padding: 6px 8px; text-align: left; }
      .mermaid { margin: 12px 0; }
    </style>
    <style>
      ${assets.highlightCss}
    </style>
    <script>
      ${assets.mermaidJs}
    </script>
    <script>
      window.__MERMAID_SOURCES__ = ${sanitizeInlineScript(JSON.stringify(mermaidSources))};
    </script>
    <script>
      window.addEventListener('DOMContentLoaded', () => {
        const mermaidRuntime = window.mermaid || (window.__esbuild_esm_mermaid_nm && window.__esbuild_esm_mermaid_nm.mermaid);
        const sources = window.__MERMAID_SOURCES__ || [];

        if (mermaidRuntime && sources.length > 0) {
          mermaidRuntime.initialize({ startOnLoad: false, securityLevel: 'loose', theme: 'default' });

          const parseErrors = [];

          (async () => {
            for (let i = 0; i < sources.length; i += 1) {
              const src = sources[i];
              try {
                await mermaidRuntime.parse(src);
              } catch (error) {
                parseErrors.push({ index: i + 1, error: String(error) });
              }
            }
            window.__MERMAID_PARSE_ERRORS__ = parseErrors;

            for (let i = 0; i < sources.length; i += 1) {
              const el = document.getElementById('mermaid-' + i);
              if (!el) continue;
              const src = sources[i];
              try {
                const { svg } = await mermaidRuntime.render('mermaid-render-' + i, src);
                el.innerHTML = svg;
              } catch (error) {
                el.innerHTML = '<p style="color:red;font-family:monospace">Mermaid error #' + (i + 1) + ': ' + String(error).replace(/</g, '&lt;') + '</p>';
              }
            }

            window.__MERMAID_DONE__ = true;
          })();
        } else {
          window.__MERMAID_DONE__ = true;
        }
      });
    </script>
  </head>
  <body>
    <article class="markdown-body">
      ${bodyHtml}
    </article>
  </body>
</html>`;
}

function resolveEdgePath() {
  const edgePathFromEnv = process.env.EDGE_PATH;
  const candidates = [
    edgePathFromEnv,
    String.raw`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`,
    String.raw`C:\Program Files\Microsoft\Edge\Application\msedge.exe`,
  ];

  for (const candidate of candidates) {
    if (candidate) return candidate;
  }

  return undefined;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function renderPdfWithBrowser(htmlPath, pdfPath, mermaidCount) {
  const edgePath = resolveEdgePath();
  if (!edgePath || !(await fileExists(edgePath))) {
    throw new Error(
      'Microsoft Edge not found. Set EDGE_PATH env var to your msedge executable path.',
    );
  }

  await fs.mkdir(path.dirname(pdfPath), { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: edgePath,
    headless: true,
    args: ['--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.goto(`file://${htmlPath.replaceAll('\\', '/')}`, { waitUntil: 'networkidle0' });

    if (mermaidCount > 0) {
      await page.waitForFunction(
        () => window.__MERMAID_DONE__ === true,
        { timeout: 20000 },
      );
    }

    const renderStats = await page.evaluate(() => {
      const mermaidSvgCount = document.querySelectorAll('.mermaid-block svg').length;
      const codeBlockCount = document.querySelectorAll('pre code').length;
      const highlightedCount = document.querySelectorAll('pre code.hljs').length;
      const mermaidError = globalThis.__MERMAID_ERROR__;
      const mermaidParseErrors = globalThis.__MERMAID_PARSE_ERRORS__ || [];

      return { mermaidSvgCount, codeBlockCount, highlightedCount, mermaidError, mermaidParseErrors };
    });

    process.stdout.write(
      `Render check: mermaidSvg=${renderStats.mermaidSvgCount}, codeBlocks=${renderStats.codeBlockCount}, highlighted=${renderStats.highlightedCount}\n`,
    );

    if (mermaidCount > 0 && renderStats.mermaidSvgCount < mermaidCount) {
      throw new Error(
        `Mermaid render incomplete (${renderStats.mermaidSvgCount}/${mermaidCount}). ${renderStats.mermaidError ?? ''}`.trim(),
      );
    }

    if (renderStats.mermaidParseErrors.length > 0) {
      const details = renderStats.mermaidParseErrors
        .map((item) => `#${item.index}: ${String(item.error).slice(0, 200).replaceAll(/\s+/g, ' ')}`)
        .join(' | ');
      throw new Error(`Mermaid parse failed: ${details}`);
    }

    if (renderStats.codeBlockCount > 0 && renderStats.highlightedCount === 0) {
      throw new Error('Syntax highlighting did not apply to code blocks.');
    }

    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', right: '10mm', bottom: '12mm', left: '10mm' },
    });
  } finally {
    await browser.close();
  }
}

function langFromExt(ext) {
  const map = {
    '.ts': 'typescript', '.tsx': 'typescript',
    '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
    '.json': 'json', '.md': 'markdown', '.css': 'css',
    '.html': 'html', '.sh': 'bash', '.yml': 'yaml', '.yaml': 'yaml',
    '.sql': 'sql',
  };
  return map[ext] ?? 'plaintext';
}

/**
 * Reads the "## Source files" section of a markdown document, finds every
 * markdown link `[text](rel/path)`, reads each file, and returns a markdown
 * string that can be appended as an appendix with syntax-highlighted listings.
 */
async function buildSourceFilesAppendix(markdown, docPath) {
  const sectionMatch = markdown.match(/^## Source files\s*\n([\s\S]*?)(?=\n## |\n# |$)/m);
  if (!sectionMatch) return null;

  const sectionText = sectionMatch[1];
  const linkRegex = /\]\(([^)#]+)\)/g;
  const docDir = path.dirname(docPath);
  const blocks = [];

  let m;
  while ((m = linkRegex.exec(sectionText)) !== null) {
    const href = m[1].trim();
    const absPath = path.resolve(docDir, href);
    const relPath = path.relative(workspaceRoot, absPath).replaceAll('\\', '/');
    const ext = path.extname(absPath);
    const lang = langFromExt(ext);

    let content;
    try {
      content = await fs.readFile(absPath, 'utf8');
    } catch {
      process.stderr.write(`[appendix] Could not read ${relPath}, skipping.\n`);
      continue;
    }

    blocks.push(
      `<div style="page-break-before: always"></div>\n\n` +
      `## \`${relPath}\`\n\n` +
      `\`\`\`${lang}\n${content}\n\`\`\``,
    );
  }

  if (blocks.length === 0) return null;

  return `---\n\n# Appendix: Source Files\n\n${blocks.join('\n\n')}`;
}

async function main() {
  const markdown = await fs.readFile(inputPath, 'utf8');
  const appendix = await buildSourceFilesAppendix(markdown, inputPath);
  const combined = appendix ? `${markdown}\n\n${appendix}` : markdown;
  const { rewritten, mermaidSources, mermaidCount } = withMermaidBlocks(combined);
  const bodyHtml = renderMarkdownWithHighlight(rewritten);
  const assets = await loadRenderAssets();
  const html = buildHtml(path.basename(inputPath), bodyHtml, assets, mermaidSources);

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-team-md-pdf-'));
  const htmlPath = path.join(tempDir, 'doc.html');

  await fs.writeFile(htmlPath, html, 'utf8');

  let finalOutputPath = outputPath;
  try {
    await renderPdfWithBrowser(htmlPath, finalOutputPath, mermaidCount);
  } catch (error) {
    const isBusy = error && typeof error === 'object' && 'message' in error
      && String(error.message).includes('EBUSY');

    if (!isBusy) throw error;

    const ext = path.extname(outputPath) || '.pdf';
    const base = outputPath.slice(0, -ext.length);
    finalOutputPath = `${base}.${Date.now()}${ext}`;
    process.stderr.write(
      `Target PDF is locked. Writing to fallback file: ${path.relative(workspaceRoot, finalOutputPath)}\n`,
    );
    await renderPdfWithBrowser(htmlPath, finalOutputPath, mermaidCount);
  }

  // Best effort cleanup
  await fs.rm(tempDir, { recursive: true, force: true });

  process.stdout.write(`PDF created: ${path.relative(workspaceRoot, finalOutputPath)}\n`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`Failed to export PDF: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
