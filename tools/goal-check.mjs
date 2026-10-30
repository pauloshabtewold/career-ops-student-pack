#!/usr/bin/env node
// Maintainer and CI tool: runs each synthetic fixture student through the whole path (install, interview answers,
// first run, triage, top 10) on throwaway copies of an upstream checkout and decides every OUTPUT vs DESIGN GOALS row
// with one named check. A row is met only when its check passes for all five fixtures. Output is counts and verdicts
// only: no row, URL, company, title or path ever reaches the report. The scratch copy is deleted on every exit path.
// Usage: goal-check.mjs --upstream <dir> --scratch <new dir> [--feeds fixtures|live] [--today D] [--report F]
// Exit 0 every row met, 1 any row not met, 2 usage.
// Triage here is a stand-in scorer, not a model: PASS 4.2 when a title matches an effective include term and an
// archetype word, else FAIL 1.0. Rows 7 and 10 are proxies: tailoring is upstream and in-session, and no real
// launchd or Task Scheduler registration is made.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';
import { install } from '../install.mjs';
import { UsageError, parseArgs, runCli } from '../lib/args.mjs';
import { loadStudentConfig } from '../lib/config.mjs';
import { effectiveTitleRules, loadMerged, toUpstreamTerms } from '../lib/presets.mjs';
import { classify } from '../scripts/inbox.mjs';

const PACK_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FIXTURES = join(PACK_ROOT, 'tests', 'fixtures');
const SETS = ['cs', 'finance', 'mechanical', 'mis', 'nursing'];
const TOP_WANTED = 10;
const STEP_TIMEOUT_MS = 30 * 60 * 1000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const NEWGRAD_TITLE = /\b(new[ -]?grad(uate)?s?|graduate program(me)?|entry[- ]level)\b/i;
const INTERN_TITLE = /\b(intern(ship)?s?|co-?ops?)\b/i;
const PROFILE_KEYS = ['start_date', 'relocation', 'eeo', 'how_did_you_hear'];

const ROWS = [
  ['Interview writes config, profile, portals and modes', 'files written and parse after apply-answers'],
  ['Preset choice and honest coverage line', 'detect-field pick equals expected preset; coverage line printed'],
  ['Correct cycle years', 'student-cycle.json equals expected years'],
  ['Daily zero-token digest never fails', 'daily.mjs with a failing step exits 0, writes the digest, starts no claude'],
  ['Prefilter, triage and rank', 'no senior, out-of-cycle or internship-only new-grad row in the ranked list'],
  ['First run shows top-10', 'first-run exits 0 and rank-queue --n 10 lists 10 rows'],
  ['Tailored materials and resume guard (PROXY)', 'check-resume passes one page, fails two; apply-loop names its flags'],
  ['Inbox', 'interview after a receipt is interview; a conditional receipt is ignored'],
  ['Outreach and apply gates', 'log apply.policy exits 0; a below-floor submit check is refused'],
  ['Daily schedule installed (PROXY)', 'schedule install --dry-run starts scheduled.mjs; interview runs it after rank-queue'],
];

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: STEP_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, ...opts });
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const readIf = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : '');
const isInside = (child, parent) => {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

function copyTree(from, to, skip) {
  cpSync(from, to, { recursive: true, filter: (src) => !skip.has(src.split(/[\\/]/).pop()) });
}

// One fixture student: a copy of upstream with the pack installed in student/. node_modules are linked, not copied.
function prepare({ upstream, scratch, set }) {
  const dir = join(scratch, set);
  copyTree(upstream, dir, new Set(['.git', 'node_modules']));
  // An upstream checkout without installed packages borrows the pack's, so its scripts can import js-yaml.
  const modules = existsSync(join(upstream, 'node_modules')) ? join(upstream, 'node_modules') : join(PACK_ROOT, 'node_modules');
  symlinkSync(modules, join(dir, 'node_modules'), 'junction');
  const student = join(dir, 'student');
  copyTree(PACK_ROOT, student, new Set(['.git', 'node_modules', 'tests']));
  symlinkSync(join(PACK_ROOT, 'node_modules'), join(student, 'node_modules'), 'junction');
  // npm is skipped: the packages are already linked, and a check must not need the network to install them.
  install({ root: dir, packRoot: student, skipNpm: true });
  mkdirSync(join(dir, 'data'), { recursive: true });
  writeFileSync(join(dir, 'cv.md'), readFileSync(join(FIXTURES, 'resumes', `${set}.md`), 'utf8'));
  writeFileSync(join(dir, 'data', 'interview-answers.json'), readFileSync(join(FIXTURES, 'answers', `${set}.json`), 'utf8'));
  return dir;
}

const student = (dir, script, args = []) => run(process.execPath, [join(dir, 'student', script), ...args], { cwd: dir });

// Fixture staging files carry tag comments for row 5; they are removed before the rows are seeded.
function readStaging(set) {
  const text = readFileSync(join(FIXTURES, 'goal-check', `${set}.staging.md`), 'utf8');
  const tags = [];
  const rows = [];
  let tag = null;
  for (const line of text.split('\n')) {
    const m = /^<!-- tag: (\S+) -->$/.exec(line.trim());
    if (m) tag = m[1];
    else if (line.startsWith('- [ ] ')) {
      rows.push(line);
      if (tag) tags.push({ tag, url: line.slice(6).split(' | ')[0].trim() });
      tag = null;
    }
  }
  return { tags, rows };
}

function pendingRows(dir) {
  const text = readIf(join(dir, 'data', 'pipeline.md'));
  const section = text.split(/^## /m).find((s) => s.startsWith('Pending')) ?? '';
  return section.split('\n').filter((l) => l.startsWith('- ')).map((l) => {
    const cells = l.replace(/^- (\[[ xX]\] )?/, '').split(' | ');
    return { url: cells[0], title: cells[2] ?? '', triaged: /\btriage=/.test(l) };
  });
}

// Stand-in scorer. An empty include list (byo-employer-list) constrains nothing, so only the archetype word decides.
async function standInTriage({ dir, answers }) {
  const config = await loadStudentConfig({ root: dir });
  const terms = effectiveTitleRules(loadMerged(config.presets), config).include.flatMap((p) => toUpstreamTerms(p).terms).map((t) => t.toLowerCase());
  const words = [...new Set(answers.archetypes.flatMap((a) => a.toLowerCase().split(/[^a-z0-9]+/)).filter((w) => w.length > 3))];
  const rows = pendingRows(dir).filter((r) => !r.triaged);
  const lines = rows.map((r) => {
    const t = r.title.toLowerCase();
    const pass = (!terms.length || terms.some((x) => t.includes(x))) && words.some((w) => t.includes(w));
    return `TRIAGE: ${pass ? 'PASS' : 'FAIL'} | ${r.url} | ${pass ? '4.2' : '1.0'}/5 | stand-in`;
  });
  const file = join(dir, 'data', 'goal-triage.txt');
  writeFileSync(file, `${lines.join('\n')}\n`);
  const res = student(dir, join('scripts', 'apply-triage.mjs'), [file, '--root', dir]);
  return { count: lines.length, passed: lines.filter((l) => l.includes('PASS')).length, code: res.code };
}

const rank = (dir, n, today) => {
  const res = student(dir, join('scripts', 'rank-queue.mjs'), ['--n', String(n), '--json', '--root', dir, '--today', today]);
  let picks = [];
  try {
    picks = JSON.parse(res.stdout);
  } catch {
    picks = [];
  }
  return { code: res.code, picks };
};

function checkFiles({ dir }) {
  const fails = [];
  const must = (ok, name) => ok || fails.push(name);
  must(existsSync(join(dir, 'config', 'student.yml')), 'student.yml');
  try {
    const answers = yaml.load(readIf(join(dir, 'config', 'profile.yml')))?.application_answers ?? {};
    must(PROFILE_KEYS.every((k) => answers[k] !== undefined), 'application_answers keys');
  } catch {
    fails.push('profile.yml parse');
  }
  const portals = readIf(join(dir, 'portals.yml'));
  must(portals.includes('# student-pack:start title_filter'), 'title_filter block');
  try {
    yaml.load(portals);
  } catch {
    fails.push('portals.yml parse');
  }
  for (const f of ['_profile.md', '_brief.md', '_custom.md']) must(readIf(join(dir, 'modes', f)).includes('<!-- student-pack:start -->'), `modes/${f} block`);
  return fails;
}

function checkSetup({ dir, set, apply }) {
  const expect = readJson(join(FIXTURES, 'goal-check', `${set}.expect.json`));
  const fails = { 1: apply.code === 0 ? checkFiles({ dir }) : ['apply-answers exit'], 2: [], 3: [] };
  const detect = student(dir, join('interview', 'detect-field.mjs'), [join(dir, 'cv.md'), '--json']);
  let pick = null;
  try {
    pick = JSON.parse(detect.stdout).pick;
  } catch {
    pick = null;
  }
  if (pick !== expect.preset) fails[2].push('detect-field pick');
  const answers = readJson(join(FIXTURES, 'answers', `${set}.json`));
  if (!student(dir, join('interview', 'coverage.mjs'), answers.presets).stdout.trim()) fails[2].push('coverage line');
  const cycle = (() => {
    try {
      return readJson(join(dir, 'data', 'student-cycle.json'));
    } catch {
      return {};
    }
  })();
  // The expected file names both year lists the pack must derive, compared exactly.
  const list = (a) => [...new Set(a ?? [])].sort();
  const same = (a, b) => JSON.stringify(list(a)) === JSON.stringify(list(b));
  const ok = same(cycle.internship_years, expect.internship_years) && same(cycle.newgrad_years, expect.newgrad_years);
  if (!ok) fails[3].push('cycle years');
  return fails;
}

// A claude stand-in that records a call; row 4 passes only when the marker never appears.
function writeClaudeShim(binDir, marker) {
  mkdirSync(binDir, { recursive: true });
  const body = `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'called');\n`;
  writeFileSync(join(binDir, 'claude'), body, { mode: 0o755 });
  writeFileSync(join(binDir, 'claude.cmd'), `@echo off\r\n"${process.execPath}" "${join(binDir, 'claude')}"\r\n`);
}

function checkDaily({ dir, today }) {
  const marker = join(dir, 'claude-called.txt');
  writeClaudeShim(join(dir, '.shim'), marker);
  writeFileSync(join(dir, 'scan.mjs'), 'process.exit(1);\n');
  const env = { ...process.env, PATH: join(dir, '.shim') };
  const res = run(process.execPath, [join(dir, 'student', 'scripts', 'daily.mjs'), '--root', dir, '--today', today], { cwd: dir, env });
  const digest = readIf(join(dir, 'data', 'digest', `student-${today}.md`));
  const fails = [];
  if (res.code !== 0) fails.push('daily exit');
  if (!digest.includes('FAILED')) fails.push('digest records the failure');
  if (existsSync(marker)) fails.push('claude was started');
  return fails;
}

function checkRanking({ dir, set, today, tags }) {
  const answers = readJson(join(FIXTURES, 'answers', `${set}.json`));
  const all = rank(dir, 1000, today);
  const urls = new Set(all.picks.map((p) => p.url));
  const internOnly = !answers.tracks.some((t) => t.kind === 'newgrad');
  // The pack's out-of-cycle rule reads the cycle's terms, which only internship and co-op tracks produce.
  const cycle = (() => {
    try {
      return readJson(join(dir, 'data', 'student-cycle.json'));
    } catch {
      return {};
    }
  })();
  const blocked = new Set(['senior', ...((cycle.terms ?? []).length ? ['out-of-cycle'] : []), ...(internOnly ? ['new-grad'] : [])]);
  const taggedInTop = tags.filter((t) => blocked.has(t.tag) && urls.has(t.url));
  const newgradRows = all.picks.filter((p) => NEWGRAD_TITLE.test(p.title ?? '') && !INTERN_TITLE.test(p.title ?? ''));
  const fails = [];
  if (taggedInTop.length) fails.push('tagged row ranked');
  if (internOnly && newgradRows.length) fails.push('new-grad row for internship-only student');
  return { fails, taggedInTop: taggedInTop.length, newgrad: newgradRows.length };
}

const pdf = (pages) => `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${i + 3} 0 R`).join(' ')}] /Count ${pages} >>\nendobj\n${Array.from({ length: pages }, (_, i) => `${i + 3} 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n`).join('')}%%EOF\n`;

function checkResumeGuard({ dir, set }) {
  const variant = readJson(join(FIXTURES, 'answers', `${set}.json`)).resume_variants[0];
  const [year, month] = variant.graduation.split('-');
  writeFileSync(join(dir, 'resume.html'), `<html><body>Graduation ${MONTHS[Number(month) - 1]} ${year}</body></html>\n`);
  writeFileSync(join(dir, 'one.pdf'), pdf(1));
  writeFileSync(join(dir, 'two.pdf'), pdf(2));
  const guard = (file) => student(dir, join('scripts', 'check-resume.mjs'), ['--pdf', join(dir, file), '--html', join(dir, 'resume.html'), '--variant', variant.name, '--root', dir]).code;
  const fails = [];
  if (guard('one.pdf') !== 0) fails.push('one-page pdf passes');
  if (guard('two.pdf') !== 1) fails.push('two-page pdf fails');
  const line = readIf(join(dir, 'student', 'modes', 'apply-loop.md')).split('\n').find((l) => l.includes('check-resume.mjs')) ?? '';
  if (!['--pdf', '--html', '--variant'].every((f) => line.includes(f))) fails.push('apply-loop flags');
  return fails;
}

function checkGates({ dir, today }) {
  const fails = [];
  const base = ['--root', dir, '--today', today];
  if (student(dir, join('scripts', 'budget.mjs'), ['log', 'apply.policy', '--company', 'Example', ...base]).code !== 0) fails.push('log apply.policy');
  const over = student(dir, join('scripts', 'budget.mjs'), ['check', 'apply.submit', '--company', 'Example', '--track', 'internship', '--score', '1.0', '--batch', '1', ...base]);
  if (over.code !== 3) fails.push('below-floor submit refused');
  return fails;
}

function checkSchedule({ dir }) {
  const res = student(dir, join('scripts', 'schedule.mjs'), ['install', '--dry-run', '--root', dir]);
  const fails = [];
  if (res.code !== 0 || !res.stdout.includes('scheduled.mjs') || !res.stdout.includes(process.execPath)) fails.push('dry-run program');
  const phase6 = readIf(join(dir, 'student', 'interview', 'interview.md')).split('## Phase 6')[1] ?? '';
  if (!(phase6.includes('rank-queue.mjs') && phase6.lastIndexOf('schedule.mjs install') > phase6.lastIndexOf('rank-queue.mjs'))) fails.push('interview order');
  return fails;
}

// The sample file holds synthetic mails only; the expected kind for each id is fixed here.
const INBOX_EXPECT = { m1: 'interview', m2: 'ignore' };
const INBOX_CTX = { companies: [{ name: 'Example', domains: ['example.com'] }] };

function checkInbox() {
  const mails = readJson(join(FIXTURES, 'goal-check', 'inbox-sample.json'));
  const fails = mails.filter((m) => classify({ ...m, snippet: m.body }, INBOX_CTX).kind !== INBOX_EXPECT[m.id]).map(() => 'inbox classification');
  return mails.length === Object.keys(INBOX_EXPECT).length ? fails : [...fails, 'inbox sample'];
}

// Every step runs through spawnSync and the awaits around them resolve at once, so without a turn of the event loop a
// SIGINT handler would not run until the whole run had finished.
const settle = () => new Promise((res) => setImmediate(res));

async function runSet(args) {
  try {
    return await runSetSteps(args);
  } catch {
    const per = { counts: {}, rows: {} };
    for (let n = 1; n <= ROWS.length; n++) per.rows[n] = ['fixture step'];
    return per;
  }
}

async function runSetSteps({ upstream, scratch, set, today, feeds }) {
  const per = { counts: {}, rows: Object.fromEntries(ROWS.map((_, i) => [i + 1, []])) };
  let dir;
  try {
    dir = prepare({ upstream, scratch, set });
  } catch {
    for (let n = 1; n <= ROWS.length; n++) per.rows[n].push('setup');
    return per;
  }
  await settle();
  const answers = readJson(join(FIXTURES, 'answers', `${set}.json`));
  const apply = student(dir, join('interview', 'apply-answers.mjs'), ['data/interview-answers.json', '--root', dir, '--today', today]);
  Object.assign(per.rows, checkSetup({ dir, set, apply }));
  await settle();
  const { tags, rows } = feeds === 'fixtures' ? readStaging(set) : { tags: [], rows: [] };
  if (feeds === 'fixtures') writeFileSync(join(dir, 'data', 'pipeline.staging.md'), `${rows.join('\n')}\n`);
  else run(process.execPath, [join(dir, 'plugins.mjs'), 'enable', 'github-lists', '--confirm'], { cwd: dir });
  const first = student(dir, join('scripts', 'first-run.mjs'), ['--root', dir, '--today', today]);
  await settle();
  const count = (label) => Number(new RegExp(`^${label}: (\\d+)`, 'm').exec(first.stdout)?.[1] ?? 0);
  const triage = await standInTriage({ dir, answers });
  const top = rank(dir, 10, today);
  const ranking = checkRanking({ dir, set, today, tags });
  per.rows[5].push(...ranking.fails);
  if (first.code !== 0) per.rows[6].push('first-run exit');
  if (top.picks.length < TOP_WANTED) per.rows[6].push(top.picks.length ? 'top list under 10' : 'top list empty');
  await settle();
  per.rows[4].push(...checkDaily({ dir, today }));
  per.rows[7].push(...checkResumeGuard({ dir, set }));
  per.rows[9].push(...checkGates({ dir, today }));
  per.rows[10].push(...checkSchedule({ dir }));
  per.counts = { staged: rows.length, pending: count('Pending rows'), untriaged: count('Untriaged Pending rows'), passed: triage.passed, top: top.picks.length, taggedInTop: ranking.taggedInTop, newgrad: ranking.newgrad };
  return per;
}

export function formatGoalReport({ results, meta }) {
  const verdicts = ROWS.map(([name, check], i) => {
    const n = i + 1;
    const failed = SETS.filter((s) => results[s].rows[n].length);
    const names = [...new Set(SETS.flatMap((s) => results[s].rows[n]))];
    return { n, name, check, met: failed.length === 0, line: failed.length ? `${SETS.length - failed.length}/${SETS.length} fixtures; failed fixtures: ${failed.join(', ')}; failed check: ${names.join(', ')}` : `${SETS.length}/${SETS.length} fixtures` };
  });
  const allMet = verdicts.every((v) => v.met);
  return {
    allMet,
    text: [
      '# Goal check',
      '',
      `Date: ${meta.date}`,
      `Upstream version: ${meta.upstream}`,
      `Pack commit: ${meta.pack}`,
      `Feeds: ${meta.feeds}`,
      'Triage: stand-in scorer (PASS 4.2 or FAIL 1.0); rows 7 and 10 are proxies.',
      '',
      '| Row | Deciding check | Verdict | Counts |',
      '|---|---|---|---|',
      ...verdicts.map((v) => `| ${v.name} | ${v.check} | ${v.met ? 'met' : 'not met'} | ${v.line} |`),
      '',
      ...SETS.map((s) => {
        const c = results[s].counts;
        return `- ${s}: top-list ${c.top ?? 0}, new-grad rows ${c.newgrad ?? 0}, staged ${c.staged ?? 0}, pending ${c.pending ?? 0}, untriaged ${c.untriaged ?? 0}, passed ${c.passed ?? 0}, tagged rows in ranking ${c.taggedInTop ?? 0}`;
      }),
      '',
      `Overall: ${allMet ? 'met' : 'not met'}`,
      '',
    ].join('\n'),
  };
}

function checkArgs({ upstream, scratch, feeds = 'fixtures' }) {
  if (!upstream || !scratch) throw new UsageError('usage: goal-check.mjs --upstream <dir> --scratch <new dir> [--feeds fixtures|live] [--today D] [--report F]');
  if (!['fixtures', 'live'].includes(feeds)) throw new UsageError('--feeds expects fixtures or live');
  const up = resolve(upstream);
  const scr = resolve(scratch);
  if (!existsSync(up) || !statSync(up).isDirectory() || !existsSync(join(up, 'package.json'))) throw new UsageError('--upstream is not a career-ops checkout');
  if (isInside(scr, PACK_ROOT) || isInside(scr, up) || isInside(PACK_ROOT, scr) || isInside(up, scr)) throw new UsageError('--scratch must be a new directory outside the pack and the upstream checkout');
  if (existsSync(scr) && (!statSync(scr).isDirectory() || readdirSync(scr).length > 0)) throw new UsageError('--scratch exists and is not an empty directory');
  return { up, scr, feeds };
}

const packCommit = () => run('git', ['rev-parse', '--short', 'HEAD'], { cwd: PACK_ROOT }).stdout.trim() || 'unknown';
const upstreamVersion = (dir) => readJson(join(dir, 'package.json')).version ?? 'unknown';

async function main() {
  const { flags } = parseArgs(process.argv.slice(2), { common: false, flags: { upstream: 'string', scratch: 'string', feeds: 'string', today: 'date', report: 'string' } });
  const { up, scr, feeds } = checkArgs(flags);
  const today = flags.today ?? '2026-10-29';
  mkdirSync(scr, { recursive: true });
  // Child scripts compare their real path with argv[1], so the working copies live under the resolved directory.
  const work = realpathSync(scr);
  // spawnSync blocks until a child ends, so a signal removes the copy as soon as control returns.
  const remove = () => rmSync(scr, { recursive: true, force: true });
  const onSignal = (code) => () => {
    remove();
    process.exit(code);
  };
  process.on('SIGINT', onSignal(130));
  process.on('SIGTERM', onSignal(143));
  let text;
  let allMet = false;
  try {
    const results = {};
    for (const set of SETS) results[set] = await runSet({ upstream: up, scratch: work, set, today, feeds });
    results.inbox = checkInbox();
    for (const set of SETS) results[set].rows[8] = results.inbox;
    ({ text, allMet } = formatGoalReport({ results, meta: { date: today, upstream: upstreamVersion(up), pack: packCommit(), feeds } }));
  } finally {
    remove();
  }
  if (flags.report) writeFileSync(resolve(flags.report), text);
  console.log(text);
  return allMet ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(resolve(process.argv[1]))) await runCli(main);
