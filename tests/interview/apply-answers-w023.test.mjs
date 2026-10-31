// W-023 review fixes in the interview path: provider seeds reach portals.yml, a skipped submit answer stays `user`,
// cv_path refuses binary resume formats, detect-field reads stdin, and a rerun keeps keys the interview never asks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { applyAnswers, AnswersError, buildConfig } from '../../interview/apply-answers.mjs';
import { loadStudentConfig } from '../../lib/config.mjs';
import { loadPreset } from '../../lib/presets.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const TODAY = '2026-10-29';
const CV = '# Jordan Testwell\n\nSkills: Python, Java, SQL\n';
const answersOf = (k) => JSON.parse(readFileSync(join(PACK_ROOT, 'tests', 'fixtures', 'answers', `${k}.json`), 'utf8'));

function scratch() {
  const root = mkdtempSync(join(tmpdir(), 'pack-w023-'));
  for (const d of ['config', 'data', 'modes']) mkdirSync(join(root, d));
  writeFileSync(join(root, 'cv.md'), CV);
  return { root, read: (rel) => readFileSync(join(root, rel), 'utf8'), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const withoutSwitches = ({ switches, ...rest }) => rest;

// Every provider seed of a preset must come out of portals.yml with the same config the preset declares.
async function providerSeedsReachPortals(answers, expectedNames) {
  const r = scratch();
  try {
    await applyAnswers({ answers, root: r.root, today: TODAY });
    const entries = yaml.load(r.read('portals.yml')).tracked_companies;
    for (const id of answers.presets) {
      for (const seed of loadPreset(id).seed_employers.filter((s) => s.provider)) {
        const got = entries.find((e) => e.name === seed.name);
        assert.ok(got, `${seed.name} is written`);
        assert.deepEqual(got, { ...seed, enabled: true }, `${seed.name} keeps its provider config`);
      }
    }
    for (const name of expectedNames) assert.ok(entries.find((e) => e.name === name)?.provider, `${name} carries a provider`);
  } finally {
    r.cleanup();
  }
}

test('W-023-A3-2 an accounting setup writes Crowe with provider phenom and its config', async () => {
  await providerSeedsReachPortals({ ...answersOf('finance'), presets: ['accounting'] }, ['Crowe']);
  const r = scratch();
  try {
    await applyAnswers({ answers: { ...answersOf('finance'), presets: ['accounting'] }, root: r.root, today: TODAY });
    const crowe = yaml.load(r.read('portals.yml')).tracked_companies.find((e) => e.name === 'Crowe');
    assert.equal(crowe.provider, 'phenom');
    assert.deepEqual(crowe.phenom, { lang: 'en_us', country: 'us' });
  } finally {
    r.cleanup();
  }
});

test('W-023-A3-2 Trane Technologies and IBM keep their provider config', async () => {
  await providerSeedsReachPortals(answersOf('mechanical'), ['Trane Technologies']);
  await providerSeedsReachPortals(answersOf('mis'), ['IBM']);
});

test('W-023-A4-1 answers without switches load as submission user', async () => {
  assert.equal(buildConfig(withoutSwitches(answersOf('mis'))).switches.submission, 'user');
  assert.equal(buildConfig({ ...answersOf('mis'), switches: { outreach: 'drafts' } }).switches.submission, 'user');
  const r = scratch();
  try {
    await applyAnswers({ answers: withoutSwitches(answersOf('cs')), root: r.root, today: TODAY });
    const cfg = await loadStudentConfig({ root: r.root });
    assert.equal(cfg.switches.submission, 'user');
  } finally {
    r.cleanup();
  }
});

test('W-023-A4-1 an explicit agent answer is still written', () => {
  assert.equal(buildConfig({ ...answersOf('cs'), switches: { submission: 'agent' } }).switches.submission, 'agent');
});

test('W-023-A4-2 detect-field reads the resume text from stdin when the path is -', () => {
  const text = readFileSync(join(PACK_ROOT, 'tests', 'fixtures', 'resumes', 'nursing.md'), 'utf8');
  const out = spawnSync(process.execPath, [join(PACK_ROOT, 'interview', 'detect-field.mjs'), '-', '--json'], { cwd: PACK_ROOT, input: text, encoding: 'utf8', timeout: 30000 });
  assert.equal(out.status, 0, out.stderr);
  assert.equal(JSON.parse(out.stdout).pick, 'nursing');
});

for (const file of ['resume.pdf', 'resume.docx', 'resume']) {
  test(`W-023-A4-3 cv_path ${file} is refused and names resume-text.mjs and cv_markdown`, async () => {
    const r = scratch();
    try {
      const { cv_markdown, ...answers } = answersOf('cs');
      writeFileSync(join(r.root, file), 'binary');
      await assert.rejects(applyAnswers({ answers: { ...answers, cv_path: file }, root: r.root, today: TODAY }), (err) => {
        assert.ok(err instanceof AnswersError);
        assert.match(err.message, /resume-text\.mjs/);
        assert.match(err.message, /cv_markdown/);
        return true;
      });
      assert.equal(existsSync(join(r.root, 'config', 'student.yml')), false);
    } finally {
      r.cleanup();
    }
  });
}

test('W-023-A4-3 cv_path .txt is still read', async () => {
  const r = scratch();
  try {
    rmSync(join(r.root, 'cv.md'));
    writeFileSync(join(r.root, 'resume.txt'), CV);
    const { cv_markdown, ...answers } = answersOf('cs');
    await applyAnswers({ answers: { ...answers, cv_path: 'resume.txt' }, root: r.root, today: TODAY });
    assert.equal(r.read('cv.md'), CV);
  } finally {
    r.cleanup();
  }
});

test('W-023-A4-4 a rerun keeps rank, audit, judgment_keywords and measured triage keys, and takes interview keys from the answers', async () => {
  const r = scratch();
  try {
    const answers = answersOf('cs');
    await applyAnswers({ answers, root: r.root, today: TODAY });
    const file = join(r.root, 'config', 'student.yml');
    const mine = yaml.load(readFileSync(file, 'utf8'));
    mine.rank.weights = { recency: 2 };
    mine.rank.ignore_words = ['unpaid'];
    mine.rank.metros = ['Nowhere'];
    mine.audit.require_triage = true;
    mine.judgment_keywords = ['relocation'];
    mine.triage_budget = { daily: 45, first_run: 'all', measured_pct_per_100_rows: 4.5, measured_window: 'weekly' };
    mine.daily_target = 99;
    writeFileSync(file, yaml.dump(mine));
    await applyAnswers({ answers, root: r.root, today: TODAY });
    const after = yaml.load(readFileSync(file, 'utf8'));
    assert.deepEqual(after.rank.weights, { recency: 2 });
    assert.deepEqual(after.rank.ignore_words, ['unpaid']);
    assert.equal(after.audit.require_triage, true);
    assert.deepEqual(after.judgment_keywords, ['relocation']);
    assert.deepEqual(after.triage_budget, { daily: 45, first_run: 'all', measured_pct_per_100_rows: 4.5, measured_window: 'weekly' });
    assert.deepEqual(after.rank.metros, answers.locations, 'interview keys come from the answers');
    assert.equal(after.daily_target, answers.daily_target ?? 10);
    assert.equal(after.onboarding.complete, true);
  } finally {
    r.cleanup();
  }
});

test('W-023-A4-4 answers that set triage_budget win over the existing file for those keys only', async () => {
  const r = scratch();
  try {
    await applyAnswers({ answers: answersOf('cs'), root: r.root, today: TODAY });
    const file = join(r.root, 'config', 'student.yml');
    const mine = yaml.load(readFileSync(file, 'utf8'));
    mine.triage_budget = { daily: 45, measured_pct_per_100_rows: 4.5, measured_window: 'weekly' };
    writeFileSync(file, yaml.dump(mine));
    await applyAnswers({ answers: { ...answersOf('cs'), triage_budget: { daily: 30 } }, root: r.root, today: TODAY });
    assert.deepEqual(yaml.load(readFileSync(file, 'utf8')).triage_budget, { daily: 30, measured_pct_per_100_rows: 4.5, measured_window: 'weekly' });
  } finally {
    r.cleanup();
  }
});

test('W-023-A4-4 an unparsable existing student.yml raises AnswersError before any write', async () => {
  const r = scratch();
  try {
    writeFileSync(join(r.root, 'config', 'student.yml'), 'rank: [unclosed\n');
    await assert.rejects(applyAnswers({ answers: answersOf('cs'), root: r.root, today: TODAY }), (err) => err instanceof AnswersError && /student\.yml/.test(err.message));
    assert.equal(existsSync(join(r.root, 'portals.yml')), false);
  } finally {
    r.cleanup();
  }
});
