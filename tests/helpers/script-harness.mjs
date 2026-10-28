// Shared fixtures for the pipeline-script tests: scratch roots with a config and data dir, pipeline.md builders,
// and a CLI runner that pins the clock through --today.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePipeline, getSection, parseRow } from '../../lib/pipeline-md.mjs';

export const PACK_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export const TODAY = '2026-10-27';
export const script = (name) => join(PACK_ROOT, 'scripts', `${name}.mjs`);

export const PRESET = {
  early_career: 'intern|new grad|university|graduate',
  title_rules: { include: ['software|data|engineer'], exclude: ['sales', 'recruiter'] },
  search_terms: [],
};

export function makeRoot({ config = '' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'pack-scripts-'));
  for (const d of ['config', 'data', 'modes']) mkdirSync(join(root, d));
  writeFileSync(join(root, 'config', 'student.yml'), `timezone: America/Chicago\n${config}`);
  const data = join(root, 'data');
  return {
    root,
    data,
    file: (rel) => join(root, rel),
    write: (rel, text) => writeFileSync(join(root, rel), text),
    read: (rel) => readFileSync(join(root, rel), 'utf8'),
    exists: (rel) => existsSync(join(root, rel)),
    list: (rel) => readdirSync(join(root, rel)).sort(),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

export function runScript(name, args, r, { today = TODAY, timeout = 60000, withToday = true } = {}) {
  const argv = [script(name), ...args, '--root', r.root, '--data-dir', r.data];
  if (withToday) argv.push('--today', today);
  const out = spawnSync(process.execPath, argv, { cwd: PACK_ROOT, encoding: 'utf8', timeout });
  return { code: out.status, stdout: out.stdout ?? '', stderr: out.stderr ?? '' };
}

// '- [ ] url | company | title | location | note: k=v; k=v'
export const line = (url, company, title, location = 'Remote', note = '') =>
  `- [ ] ${url} | ${company} | ${title} | ${location}${note ? ` | note: ${note}` : ''}`;

export function pipelineText({ pending = [], flagged = [], skipped = [], processed = [] } = {}) {
  const sec = (name, lines) => [`## ${name}`, '', ...lines, ''];
  return ['# Pipeline', '', ...sec('Pending', pending), ...sec('Flagged', flagged), ...sec('Skipped', skipped), ...sec('Processed', processed)].join('\n');
}

// Rows of one section as parsed row objects.
export function rowsOf(text, name) {
  const sec = getSection(parsePipeline(text), name);
  return sec ? sec.lines.map(parseRow).filter(Boolean) : [];
}
export const urlsOf = (text, name) => rowsOf(text, name).map((r) => r.url);
export const sectionText = (text, name) => (getSection(parsePipeline(text), name)?.lines ?? []).join('\n');

export const jobUrl = (n) => `https://example.com/jobs/${n}`;
