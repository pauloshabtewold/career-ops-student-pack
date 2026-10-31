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
test('M-003-S7 CHANGELOG has an Unreleased section on top, and the v0.2.0 notes name W-011, W-012 and the reinstall line', () => {
  const log = readDoc('CHANGELOG.md');
  assert.ok(/^## Unreleased\s*\n/m.test(log), 'Unreleased heading');
  assert.ok(log.indexOf('## Unreleased') < log.indexOf('## v0.2.0'), 'Unreleased is newest');
  const m = /^## v0\.2\.0\b.*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(log);
  assert.ok(m, 'v0.2.0 section');
  assert.match(m[1], /W-011/);
  assert.match(m[1], /W-012/);
  assert.match(m[1], /schedule\.mjs install/);
});

// M-003-S8
test('M-003-S8 README describes the second install run and drops the old sentence', () => {
  const readme = readDoc('README.md');
  assert.ok(!readme.includes('Running it again changes nothing'));
  const install = readme.slice(readme.indexOf('## Install'), readme.indexOf('## Update'));
  const sentence = install.split('\n').find((l) => l.includes('Running it again is safe'));
  assert.ok(sentence, 'Install section has the second-run sentence');
  assert.match(sentence, /Running it again is safe: it repeats the `npm ci` step, skips the career-ops `npm install` when `node_modules` already exists, copies the pack plugins again/);
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

// W-023-A4-2, A4-3
test('W-023-A4-2 interview step 4 runs detect-field on the resume text, not on a cv.md that may not exist yet', () => {
  const p1 = phase(readDoc('interview/interview.md'), 1);
  const step4 = p1.split('\n').find((l) => /^4\. /.test(l));
  assert.ok(step4, 'step 4 present');
  assert.doesNotMatch(step4, /detect-field\.mjs cv\.md/);
  assert.match(step4, /resume text/);
  assert.match(step4, /resume-text\.mjs/);
  assert.match(step4, /stdin/);
});

// W-023-A4-3
test('W-023-A4-3 interview step 1 allows cv_path only for .md or .txt', () => {
  const step1 = phase(readDoc('interview/interview.md'), 1).split('\n').find((l) => /^1\. /.test(l));
  assert.match(step1, /`cv_path` only for a `\.md` or `\.txt` file/);
});

// W-023-A4-4
test('W-023-A4-4 the rerun wording says student-owned keys are kept, in the interview, usage and Phase 5', () => {
  const interview = readDoc('interview/interview.md');
  assert.doesNotMatch(interview, /rewrites only the blocks the pack owns/);
  assert.match(interview.split('\n')[2], /judgment_keywords/);
  assert.match(readDoc('docs/usage.md'), /Running the interview again rebuilds the keys of config\/student\.yml that it asks about/);
  assert.match(phase(interview, 5), /On a re-run, read config\/student\.yml first and offer each current value as the default/);
});

// W-023-A4-5
test('W-023-A4-5 Phase 5 step 7 passes the chosen spend tier to triage-budget.mjs cost', () => {
  const step7 = phase(readDoc('interview/interview.md'), 5).split('\n').find((l) => /^7\. /.test(l));
  assert.match(step7, /triage-budget\.mjs cost <n\|all> --plan <plan> --agent <agent> --spend-tier <standard\|premium>/);
});

// W-023-A4-6
test('W-023-A4-6 apply-loop stops for the student to sign in instead of signing in for them', () => {
  const doc = readDoc('modes/apply-loop.md');
  assert.doesNotMatch(doc, /Sign in only through/);
  assert.match(doc, /If the site needs a sign-in, stop and ask the student to sign in themselves \(Google or LinkedIn SSO only, never a password\)/);
});

// W-023-A4-7
test('W-023-A4-7 the daily-run switches table lets a session triage on request under any automation', () => {
  const row = readDoc('modes/daily-run.md').split('\n').find((l) => l.startsWith('| Triage on request |'));
  assert.ok(row, 'on-request row present');
  assert.match(row, /any `automation` value/);
  assert.match(row, /triage-budget\.mjs status/);
  assert.match(row, /triage-budget\.mjs log/);
});

// W-023-A4-11
test('W-023-A4-11 the changelog says schedule.mjs passes --agent to scheduled.mjs and W-016 replaced triage_daily', () => {
  const log = readDoc('CHANGELOG.md');
  assert.doesNotMatch(log, /`schedule\.mjs` takes `--agent`/);
  assert.match(log, /`schedule\.mjs install` passes `--agent` and `--agent-path` to `scheduled\.mjs`, which still honours the older `--claude`/);
  assert.doesNotMatch(log, /the new `triage_daily` ceiling/);
  assert.match(log, /`triage_daily` ceiling that W-016 replaced/);
});

// W-023-A4-12
test('W-023-A4-12 architecture and coverage.mjs name phase 2 and the attach-point table lists AGENTS.override.md', () => {
  const arch = readDoc('docs/architecture.md');
  assert.doesNotMatch(arch, /four places/);
  assert.match(arch, /five places only/);
  assert.match(arch, /\| `AGENTS\.override\.md` \|/);
  assert.match(arch, /Interview phase 2 states the coverage line/);
  assert.match(readDoc('interview/coverage.mjs'), /read aloud in interview phase 2/);
});

// W-023-A4-13
test('W-023-A4-13 usage.md triage wording covers both agents and partial runs', () => {
  const usage = readDoc('docs/usage.md');
  assert.match(usage, /If the agent is missing, signed out or too slow, the digest says why; rows already applied by earlier chunks stay\./);
  assert.doesNotMatch(usage, /If claude is missing/);
  assert.match(usage, /\(`--n N` shows a different number\)/);
});

// W-023-A4-14
test('W-023-A4-14 the defaults file does not promise an automation flip nothing performs', () => {
  const defaults = readDoc('templates/student.defaults.yml');
  assert.doesNotMatch(defaults, /Becomes scheduled-discovery after the first successful run/);
  assert.match(defaults, /Set by the interview's Phase 5 answer; manual unless the student chose a schedule\./);
});
