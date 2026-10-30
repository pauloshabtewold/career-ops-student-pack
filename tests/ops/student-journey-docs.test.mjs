// Student journey in the docs: README Install blocks, browser setup, interview flow, changelog, rerun sentence and the
// count labels first-run.mjs prints. Failures name the block or file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { firstRun } from '../../scripts/first-run.mjs';
import { createFakeUpstream } from '../helpers/fake-upstream.mjs';
import { PACK_ROOT, TODAY, jobUrl, line, pipelineText } from '../helpers/script-harness.mjs';
import { checkInstallBlocks, checkReadmeRules, readDoc } from '../helpers/doc-contract.mjs';

const phase = (text, n) => {
  const m = new RegExp(`^## Phase ${n}:[^\\n]*\\n([\\s\\S]*?)(?=^## Phase |(?![\\s\\S]))`, 'm').exec(text);
  return m ? m[1] : '';
};

// M-003-S1
test('M-003-S1 README Install has ordered macOS and Windows blocks', () => {
  assert.deepEqual(checkInstallBlocks(readDoc('README.md')), []);
});

// M-003-S1
test('M-003-S1 macOS uses brew and Windows uses winget', () => {
  const readme = readDoc('README.md');
  assert.match(readme, /brew install node git|brew install git node/);
  assert.match(readme, /winget install OpenJS\.NodeJS\.LTS/);
  assert.match(readme, /winget install[^\n]*Git\.Git/);
});

// M-003-S11
test('M-003-S11 a README missing the Windows block fails naming Windows', () => {
  const readme = readDoc('README.md');
  const cut = readme.replace(/Windows[^\n]*\n\n```[\s\S]*?```\n/, '');
  const problems = checkInstallBlocks(cut);
  assert.ok(problems.some((p) => /^Windows block/.test(p)), problems.join('\n'));
});

// M-003-S11
test('M-003-S11 steps out of order fail naming the block', () => {
  const swapped = [
    '## Install',
    '',
    'macOS (Terminal):',
    '',
    '```',
    'brew install node git',
    'node student/install.mjs',
    'git clone https://example.com/career-ops career-ops',
    'npm install',
    'git clone https://example.com/pack student',
    '```',
    '',
    'Windows 11 (PowerShell):',
    '',
    '```',
    'winget install OpenJS.NodeJS.LTS Git.Git',
    'git clone https://example.com/career-ops career-ops',
    'npm install',
    'git clone https://example.com/pack student',
    'node student/install.mjs',
    '```',
    '',
    '## Update',
  ].join('\n');
  const problems = checkInstallBlocks(swapped);
  assert.ok(problems.length > 0);
  assert.ok(problems.every((p) => /^macOS block/.test(p)), problems.join('\n'));
});

// M-003-S2
test('M-003-S2 README or usage names Claude in Chrome, playwright chromium and the suggested settings template', () => {
  const text = `${readDoc('README.md')}\n${readDoc('docs/usage.md')}`;
  assert.match(text, /Claude in Chrome/);
  assert.match(text, /npx playwright install chromium/);
  assert.match(text, /templates\/claude-settings\.suggested\.json/);
});

// M-003-S3
test('M-003-S3 interview Phase 1 runs resume-text.mjs and detect-field.mjs', () => {
  const p1 = phase(readDoc('interview/interview.md'), 1);
  assert.match(p1, /resume-text\.mjs/);
  assert.match(p1, /detect-field\.mjs/);
});

// M-003-S3
test('M-003-S3 interview asks the application profile and target employers, offers h1b-sponsor and the USAJOBS alert', () => {
  const text = readDoc('interview/interview.md');
  assert.match(text, /application[ _]profile/i);
  assert.match(text, /target employers/i);
  assert.match(text, /10 to 20/);
  assert.match(text, /every field/i);
  assert.match(phase(text, 2), /h1b-sponsor/);
  assert.match(text, /USAJOBS[^\n]*saved[ -]search|saved[ -]search[^\n]*USAJOBS/i);
});

// M-003-S3
test('M-003-S3 Phase 6 runs first-run.mjs, then rank-queue.mjs --n 10, then schedule.mjs install', () => {
  const p6 = phase(readDoc('interview/interview.md'), 6);
  const a = p6.indexOf('first-run.mjs');
  const b = p6.indexOf('rank-queue.mjs --n 10');
  const c = p6.indexOf('schedule.mjs install');
  assert.ok(a >= 0, 'first-run.mjs');
  assert.ok(b > a, 'rank-queue.mjs --n 10 after first-run');
  assert.ok(c > b, 'schedule.mjs install after rank-queue');
  assert.match(p6, /apply-triage\.mjs/);
});

// M-003-S5
test('M-003-S5 README has no <pack-url> and carries the sync warning', () => {
  assert.deepEqual(checkReadmeRules(readDoc('README.md')), []);
});

// M-003-S5
test('M-003-S5 a README with <pack-url> or without the sync warning fails', () => {
  assert.ok(checkReadmeRules('git clone <pack-url> student\nkeep it out of OneDrive sync').some((p) => /<pack-url>/.test(p)));
  assert.ok(checkReadmeRules('git clone https://example.com/p student').some((p) => /sync warning/.test(p)));
});

// M-003-S6
test('M-003-S6 interview.md keeps the Phase 4 and Phase 6 headings', () => {
  const text = readDoc('interview/interview.md');
  assert.match(text, /^## Phase 4: switches and disclosures$/m);
  assert.match(text, /^## Phase 6: write, check, enable$/m);
});

// M-003-S7
test('M-003-S7 CHANGELOG has an Unreleased section naming W-011 and W-012 and the reinstall line', () => {
  const log = readDoc('CHANGELOG.md');
  const m = /^## Unreleased\s*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(log);
  assert.ok(m, 'Unreleased heading');
  assert.ok(log.indexOf('## Unreleased') < log.indexOf('## v0.1.0'), 'Unreleased is newest');
  assert.match(m[1], /W-011/);
  assert.match(m[1], /W-012/);
  assert.match(m[1], /schedule\.mjs install/);
});

// M-003-S8
test('M-003-S8 README describes the second install run and drops the old sentence', () => {
  const readme = readDoc('README.md');
  assert.ok(!readme.includes('Running it again changes nothing'));
  const install = readme.slice(readme.indexOf('## Install'), readme.indexOf('## Update'));
  assert.match(install, /again|second|rerun|re-run/i);
  assert.match(install, /npm/i);
});

// M-003-S9
test('M-003-S9 docs/usage.md names every count label first-run.mjs prints on the fake upstream', async () => {
  const up = createFakeUpstream();
  try {
    writeFileSync(join(up.root, 'config', 'student.yml'), 'timezone: America/Chicago\npresets: []\n');
    const mk = (n, src, from) => Array.from({ length: n }, (_, i) => line(jobUrl(from + i), 'Example Robotics', `Data Intern ${from + i}`, 'Remote', `src=${src}; imported=2026-10-27`));
    writeFileSync(join(up.root, 'data', 'pipeline.md'), pipelineText({ pending: [...mk(3, 'handshake', 1), ...mk(2, 'github-lists', 4)] }));
    writeFileSync(join(up.root, 'data', 'pipeline.staging.md'), '');
    writeFileSync(join(up.root, 'data', 'applications.md'), '# Applications\n');
    const out = [];
    await firstRun({ root: up.root, dataDir: join(up.root, 'data'), packRoot: PACK_ROOT, today: TODAY, out: (l) => out.push(String(l)) });
    const labels = new Set();
    for (const l of out) {
      if (l.includes(' | ') || /\bmore\b/i.test(l)) continue;
      const m = /^\s*([a-z][a-z0-9 _-]*?)\s*[:=]?\s*\d+\s*$/i.exec(l) || /^\s*\d+\s+([a-z][a-z0-9 _-]*?)\s*$/i.exec(l);
      if (m) labels.add(m[1].trim().toLowerCase());
    }
    assert.ok(labels.size > 0, `no count labels found in:\n${out.join('\n')}`);
    const usage = readDoc('docs/usage.md').toLowerCase();
    for (const label of labels) assert.ok(usage.includes(label), `docs/usage.md names "${label}"`);
  } finally {
    rmSync(up.root, { recursive: true, force: true });
  }
});
