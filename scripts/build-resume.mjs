#!/usr/bin/env node
// Builds the one ATS-safe resume from cv.md: a small markdown subset into templates/resume/resume.template.html, then a
// one-page PDF through upstream generate-pdf.mjs as a child process (the pack never imports upstream code).
// cv.md subset: "# Name", one contact line, "## Section", "### Title | Dates", "- bullet", plain paragraphs.
// Usage: build-resume.mjs [--cv FILE] [--out DIR] [--order "Education,Experience,Projects,Skills"] [--html-only] [--root R]
// The PDF render launches a headless browser, so the configured browser-slot command (BROWSER_SLOT_CMD, else
// config browser.slot_cmd) runs first; any non-zero exit means no render is spawned this time.
// Exit 0 ok, 1 render failed, 2 usage, 4 waiting for a browser slot.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError, isMain, parseArgs, runCli } from '../lib/args.mjs';
import { loadStudentConfig } from '../lib/config.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { runResult } from '../lib/run.mjs';
import { resolveSlotCommand, runSlotCommand } from './chrome.mjs';

const PACK_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const DEFAULT_ORDER = Object.freeze(['Education', 'Experience', 'Projects', 'Skills']);
const TEMPLATE = join(PACK_ROOT, 'templates', 'resume', 'resume.template.html');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Hyphenated tokens and date ranges stay on one line, so a parser never reads "2023-" and "2027" as two tokens.
const keepWhole = (s) => esc(s).replace(/\b[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+\b/g, (t) => `<span class="nowrap">${t}</span>`);

// Parses cv.md into name, contact line and sections; HTML comments are dropped.
export function parseCv(text) {
  const lines = String(text).replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/);
  const cv = { name: '', contact: '', sections: [] };
  let section = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line === 'SYNTHETIC FIXTURE') continue;
    if (line.startsWith('# ')) cv.name = line.slice(2).trim();
    else if (line.startsWith('## ')) cv.sections.push((section = { title: line.slice(3).trim(), items: [] }));
    else if (!section && !cv.contact) cv.contact = line;
    else if (section && line.startsWith('### ')) section.items.push({ kind: 'entry', text: line.slice(4).trim() });
    else if (section && /^[-*] /.test(line)) section.items.push({ kind: 'bullet', text: line.slice(2).trim() });
    else if (section) section.items.push({ kind: 'para', text: line });
  }
  return cv;
}

function renderSection(section) {
  const out = [`<h2>${esc(section.title)}</h2>`];
  let list = [];
  const flush = () => {
    if (list.length) out.push(`<ul>${list.join('')}</ul>`);
    list = [];
  };
  for (const item of section.items) {
    if (item.kind === 'bullet') {
      list.push(`<li>&bull; ${keepWhole(item.text)}</li>`);
      continue;
    }
    flush();
    if (item.kind === 'entry') {
      const [title, dates] = item.text.split(/\s+\|\s+/);
      out.push(`<h3>${keepWhole(title)}${dates ? ` | <span class="nowrap">${esc(dates)}</span>` : ''}</h3>`);
    } else out.push(`<p>${keepWhole(item.text)}</p>`);
  }
  flush();
  return out.join('\n');
}

// Sections in the given order first, then any others in cv.md order.
export function renderHtml(cv, order = DEFAULT_ORDER, template = readFileSync(TEMPLATE, 'utf8')) {
  const rank = (t) => {
    const i = order.findIndex((o) => o.toLowerCase() === t.toLowerCase());
    return i === -1 ? order.length : i;
  };
  const sections = [...cv.sections].sort((a, b) => rank(a.title) - rank(b.title));
  const contact = cv.contact.split(/\s*\|\s*/).map(esc).join(' | ');
  return template.replace(/\{\{name\}\}/g, esc(cv.name)).replace('{{contact}}', contact).replace('{{sections}}', sections.map(renderSection).join('\n'));
}

// Renders html to a one-page letter PDF through generate-pdf.mjs with strict page checking.
export function renderPdf({ root, html, pdf, runner = runResult }) {
  return runner(process.execPath, [join(root, 'generate-pdf.mjs'), html, pdf, '--format=letter', '--max-pages=1', '--strict-pages'], { cwd: root, timeout: 120 * 1000 });
}

export const EXIT_WAIT = 4;

// The browser-slot gate before any PDF render: null when the render may start, else the slot command's exit code. With
// no slot command configured the render starts, as chrome.mjs open does.
export function slotRefusal({ env = process.env, config = null, runSlot = runSlotCommand } = {}) {
  const slot = resolveSlotCommand({ env, config });
  if (!slot) return null;
  const code = runSlot(slot);
  return code === 0 ? null : code;
}

// Parses the cv, writes the template HTML into outDir, and renders the PDF unless htmlOnly is set. The render runs only
// after the browser-slot gate passes; a refused slot returns code 4 (waiting) and spawns nothing.
export function buildResume({ root, cvFile, outDir, order = DEFAULT_ORDER, htmlOnly = false, runner, config = null, env = process.env, runSlot = runSlotCommand }) {
  const cv = parseCv(readFileSync(cvFile, 'utf8'));
  mkdirSync(outDir, { recursive: true });
  const html = join(outDir, 'resume.html');
  const pdf = join(outDir, 'resume.pdf');
  writeFileSync(html, renderHtml(cv, order));
  if (htmlOnly) return { code: 0, html, pdf: null };
  const refused = slotRefusal({ env, config, runSlot });
  if (refused !== null) return { code: EXIT_WAIT, html, pdf: null, error: `waiting for a browser slot (hook exit ${refused}); run this again in a few minutes` };
  const res = renderPdf({ root, html, pdf, runner });
  return { code: res.code === 0 ? 0 : 1, html, pdf, error: res.code === 0 ? null : (res.stderr || res.stdout).trim().split('\n')[0] };
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2), { flags: { cv: 'string', out: 'string', order: 'string', 'html-only': 'boolean' } });
  const paths = resolvePaths({ root: flags.root, dataDir: flags.dataDir });
  const cvFile = flags.cv ?? join(paths.root, 'cv.md');
  if (!existsSync(cvFile)) throw new UsageError(`no cv file at ${cvFile}`);
  const order = flags.order ? flags.order.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_ORDER;
  const config = await loadStudentConfig({ root: paths.root }).catch(() => null);
  const res = buildResume({ root: paths.root, cvFile, outDir: flags.out ?? join(paths.dataDir, 'resume'), order, htmlOnly: Boolean(flags.htmlOnly), config });
  if (res.code === EXIT_WAIT) console.log(`build-resume: ${res.error}`);
  else console.log(res.code === 0 ? `build-resume: wrote ${res.pdf ?? res.html}` : `build-resume: PDF render failed: ${res.error}`);
  return res.code;
}

if (isMain(import.meta.url)) await runCli(main);
