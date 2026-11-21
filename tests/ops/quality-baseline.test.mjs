// tools/quality-baseline.mjs with root set to a scratch copy of the pack in its own git repo with a release tag, so
// capture's product-file check and freeze's commit and tag come from real git and every file it writes stays in the copy. The agent
// runner is a fake: no claude or codex process is started. Assertions read the files on disk and do not depend on the
// baseline folder layout beyond its location.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as tool from '../../tools/quality-baseline.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const TAG = 'v9.9.9-qbtest';
const PROFILE_NAMES = ['software-cs', 'finance-economics', 'nursing', 'policy-government', 'mis-business-analytics'];
const USAGE = { input_tokens: 7341, output_tokens: 2917 };
const MODEL = { claude: 'claude-fake-model-1', codex: 'codex-fake-model-1' };
const BARS_WITH_AA = ['OVERLAP_MIN', 'INVENTED_FACTS_MAX', 'JUDGE_NOT_WORSE_MIN', 'FORM_ACCURACY', 'CLASSIFY_ACCURACY', 'SCAM_FP_MAX'];
const JUDGE_LINE = '{"verdict":"tie","not_worse":true,"invented_facts":0}';

const hex = (text) => createHash('sha256').update(text).digest('hex');
const git = (cwd, args) => spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { cwd, encoding: 'utf8' });

// A pack copy committed and tagged in a fresh repo; node_modules is linked, an existing baseline is left out.
async function packRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'qb-pack-'));
  const skip = new Set(['.git', 'node_modules']);
  const baseline = join(PACK_ROOT, 'tests', 'fixtures', 'quality', 'baseline');
  cpSync(PACK_ROOT, dir, { recursive: true, filter: (src) => !skip.has(basename(src)) && src !== baseline && !src.startsWith(baseline + sep) });
  symlinkSync(join(PACK_ROOT, 'node_modules'), join(dir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  for (const args of [['init', '-q'], ['add', '-A'], ['commit', '-q', '-m', 'fixture'], ['tag', TAG]]) {
    const r = git(dir, args);
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  }
  return { dir, tool, baseline: join(dir, 'tests', 'fixtures', 'quality', 'baseline'), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// The frozen bars module of the copy, loaded in a child node so this process keeps its own module cache.
function exportsOf(file) {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', 'const m = await import(process.argv[1]); console.log(JSON.stringify(m));', pathToFileURL(file).href], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p));
    else out.push(p);
  }
  return out.sort();
}
const snapshot = (dir) => Object.fromEntries(filesUnder(dir).map((f) => [relative(dir, f), readFileSync(f, 'utf8')]));
const manifestOf = (files) => files.find((f) => /manifest/i.test(basename(f)) && f.endsWith('.json'));

function agentReply(agent, text, usage) {
  const model = MODEL[agent];
  const stdout =
    agent === 'codex'
      ? [{ type: 'thread.started', thread_id: 't-fake' }, { type: 'item.completed', item: { id: 'i0', type: 'agent_message', text } }, { type: 'turn.completed', usage }].map((e) => JSON.stringify(e)).join('\n')
      : JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: text, usage, modelUsage: { [model]: { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens } } });
  return { status: 0, code: 0, stdout, stderr: '', text, usage, model };
}

function quotaReply(agent) {
  const message = 'API Error: 429 rate limit reached, usage quota exceeded';
  const stdout = agent === 'codex' ? JSON.stringify({ type: 'error', message }) : JSON.stringify({ type: 'result', subtype: 'error', is_error: true, result: message });
  return { status: 1, code: 1, stdout, stderr: message, text: '', usage: null, model: null, error: message };
}

// Answers every call with one triage line per posting URL in the prompt plus a judge verdict line. The first time a
// prompt is seen (arm A) URLs keep prompt order with falling scores; the repeat (arm AA) reverses the ranking, so the
// two arms share no top-ten URL and the A/A overlap is 0.
function fakeRunner({ usage = USAGE, fail = null } = {}) {
  const calls = [];
  const seen = new Map();
  const runner = (call) => {
    calls.push(call);
    if (fail) return fail(call);
    const key = `${call.agent}\n${call.prompt}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    const urls = [...new Set(String(call.prompt).match(/https?:\/\/[^\s|<>"')]+/g) ?? [])];
    const lines = urls.map((u, i) => `TRIAGE: PASS | ${u} | ${(n === 1 ? 5 - i * 0.01 : 4.0 + i * 0.01).toFixed(2)} | fits the rules`);
    return agentReply(call.agent, [...lines, JUDGE_LINE].join('\n'), usage);
  };
  return { runner, calls, seen };
}

const resolve = (agent) => `/fake/bin/${agent}`;

function sayer() {
  const lines = [];
  return { say: (...a) => lines.push(a.join(' ')), lines };
}

// capture, noise and freeze may report through a returned code or a thrown error; both read as the exit code.
// A thrown error's message joins the said lines when a sink is given.
async function codeOf(work, tool, sink = null) {
  try {
    const v = await work;
    if (typeof v === 'number') return v;
    return v?.code ?? v?.exitCode ?? 0;
  } catch (err) {
    if (sink) sink.push(String(err?.message ?? err));
    if (err instanceof tool.BlockedError) return 5;
    if (typeof err?.exitCode === 'number') return err.exitCode;
    if (typeof err?.code === 'number') return err.code;
    throw err;
  }
}

const cellsOf = (row) => row.split('|').slice(1, -1).map((c) => c.trim().replace(/`/g, ''));
const asNumber = (cell) => {
  const m = cell.match(/^(-?\d+(?:\.\d+)?)(%?)$/);
  if (!m) return null;
  return m[2] ? Number(m[1]) / 100 : Number(m[1]);
};
function rowNumbers(text, name) {
  const row = text.split('\n').find((l) => l.trim().startsWith('|') && cellsOf(l.trim()).includes(name));
  assert.ok(row, `docs/quality-gate.md has a row for ${name}`);
  return cellsOf(row.trim()).map(asNumber).filter((n) => n !== null);
}

function findKey(node, name) {
  if (!node || typeof node !== 'object') return undefined;
  for (const [k, v] of Object.entries(node)) {
    if (k.toUpperCase() === name) return v;
    const inner = findKey(v, name);
    if (inner !== undefined) return inner;
  }
  return undefined;
}

// M-001-S2-osdr
test('M-001-S2-osdr quality-baseline capture with a fake runner writes outputs and usage per step for all 5 profiles and a sha256 manifest', async () => {
  const p = await packRepo();
  try {
    assert.deepEqual(p.tool.PROFILES, PROFILE_NAMES);
    const fake = fakeRunner();
    const out = sayer();
    const code = await codeOf(p.tool.capture({ root: p.dir, runner: fake.runner, resolve, say: out.say }), p.tool);
    assert.equal(code, 0, out.lines.join('\n'));

    const files = filesUnder(p.baseline);
    const manifest = manifestOf(files);
    assert.ok(manifest, 'baseline holds a manifest json');
    const manifestText = readFileSync(manifest, 'utf8');
    const data = files.filter((f) => f !== manifest);
    assert.ok(data.length > 0, 'baseline holds output files');
    for (const f of data) assert.ok(manifestText.includes(hex(readFileSync(f))), `manifest holds the sha256 of ${relative(p.baseline, f)}`);

    for (const profile of PROFILE_NAMES) {
      const mine = data.filter((f) => relative(p.baseline, f).includes(profile));
      assert.ok(mine.length > 0, `baseline files for ${profile}`);
      const text = mine.map((f) => readFileSync(f, 'utf8')).join('\n');
      assert.ok(text.includes('TRIAGE: PASS'), `outputs recorded for ${profile}`);
      assert.ok(text.includes(String(USAGE.input_tokens)) && text.includes(String(USAGE.output_tokens)), `usage recorded for ${profile}`);
    }
  } finally {
    p.cleanup();
  }
});

// M-001-S5-osdr
test('M-001-S5-osdr quality-baseline capture over an existing baseline without --replace exits 3 and changes no file', async () => {
  const p = await packRepo();
  try {
    const first = fakeRunner();
    assert.equal(await codeOf(p.tool.capture({ root: p.dir, runner: first.runner, resolve, say: () => {} }), p.tool), 0);
    const before = snapshot(p.baseline);
    assert.ok(Object.keys(before).length > 0);

    const second = fakeRunner();
    const code = await codeOf(p.tool.capture({ root: p.dir, runner: second.runner, resolve, say: () => {} }), p.tool);
    assert.equal(code, 3);
    assert.equal(second.calls.length, 0, 'no agent call on a refused capture');
    assert.deepEqual(snapshot(p.baseline), before);
  } finally {
    p.cleanup();
  }
});

// M-001-S8-osdr
test('M-001-S8-osdr quality-baseline verify exits 3 naming a baseline file whose hash changed', async () => {
  const p = await packRepo();
  try {
    const fake = fakeRunner();
    assert.equal(await codeOf(p.tool.capture({ root: p.dir, runner: fake.runner, resolve, say: () => {} }), p.tool), 0);
    assert.equal(await codeOf(p.tool.noise({ root: p.dir, runner: fake.runner, resolve, say: () => {}, seed: 's8-seed' }), p.tool), 0);
    assert.equal(await codeOf(p.tool.freeze({ root: p.dir, say: () => {} }), p.tool), 0);

    const verify = () => spawnSync(process.execPath, [join(p.dir, 'tools', 'quality-baseline.mjs'), 'verify'], { cwd: p.dir, encoding: 'utf8', timeout: 60000 });
    const clean = verify();
    assert.equal(clean.status, 0, clean.stdout + clean.stderr);

    const files = filesUnder(p.baseline);
    const target = files.find((f) => f !== manifestOf(files));
    appendFileSync(target, '\ntampered\n');
    const changed = verify();
    assert.equal(changed.status, 3, changed.stdout + changed.stderr);
    assert.ok((changed.stdout + changed.stderr).includes(basename(target)), `verify names ${basename(target)}:\n${changed.stdout}${changed.stderr}`);
  } finally {
    p.cleanup();
  }
});

// M-001-S9-osdr
test('M-001-S9-osdr capture records the resolved model id on every call row and writes an A/A repeat arm plus noise.json with one A/A value per bar', async () => {
  const p = await packRepo();
  try {
    const fake = fakeRunner();
    assert.equal(await codeOf(p.tool.capture({ root: p.dir, runner: fake.runner, resolve, say: () => {} }), p.tool), 0);
    assert.ok(fake.calls.length > 0);
    assert.deepEqual([...new Set(fake.seen.values())], [2], 'every capture call runs once in arm A and once in the A/A arm');

    const files = filesUnder(p.baseline);
    const rels = files.map((f) => relative(p.baseline, f));
    assert.ok(rels.some((r) => r.split(/[\\/._-]/).includes('AA')), 'baseline holds the A/A arm');
    const all = files.map((f) => readFileSync(f, 'utf8')).join('\n');
    for (const agent of ['claude', 'codex']) {
      const made = fake.calls.filter((c) => c.agent === agent).length;
      assert.ok(made > 0, `capture called ${agent}`);
      const recorded = all.split(MODEL[agent]).length - 1;
      assert.ok(recorded >= made, `${agent}: ${recorded} model ids recorded for ${made} calls`);
    }

    assert.equal(await codeOf(p.tool.noise({ root: p.dir, runner: fake.runner, resolve, say: () => {}, seed: 's9-seed' }), p.tool), 0);
    const noiseFile = filesUnder(join(p.dir, 'tests', 'fixtures', 'quality')).find((f) => basename(f) === 'noise.json');
    assert.ok(noiseFile, 'noise.json written');
    const noiseData = JSON.parse(readFileSync(noiseFile, 'utf8'));
    for (const bar of BARS_WITH_AA) assert.equal(typeof findKey(noiseData, bar), 'number', `noise.json holds an A/A value for ${bar}`);
  } finally {
    p.cleanup();
  }
});

// M-001-S10-osdr
test('M-001-S10-osdr freeze writes stated, A/A and effective bars and the manifest records both bar files, the commit sha and the release tag', async () => {
  const p = await packRepo();
  try {
    const fake = fakeRunner();
    assert.equal(await codeOf(p.tool.capture({ root: p.dir, runner: fake.runner, resolve, say: () => {} }), p.tool), 0);
    assert.equal(await codeOf(p.tool.noise({ root: p.dir, runner: fake.runner, resolve, say: () => {}, seed: 's10-seed' }), p.tool), 0);
    assert.equal(await codeOf(p.tool.freeze({ root: p.dir, say: () => {} }), p.tool), 0);

    const head = git(p.dir, ['rev-parse', 'HEAD']).stdout.trim();
    const manifestText = readFileSync(manifestOf(filesUnder(p.baseline)), 'utf8');
    assert.ok(manifestText.includes(hex(readFileSync(join(p.dir, 'lib', 'quality-bars.mjs')))), 'manifest pins lib/quality-bars.mjs');
    assert.ok(manifestText.includes(hex(readFileSync(join(p.dir, 'docs', 'quality-gate.md')))), 'manifest pins docs/quality-gate.md');
    assert.ok(manifestText.includes(head), 'manifest records the captured commit');
    assert.ok(manifestText.includes(TAG), 'manifest records the release tag');

    // The fake arms share no top-ten URL, so the A/A overlap is 0 and the effective overlap bar drops to it.
    const doc = readFileSync(join(p.dir, 'docs', 'quality-gate.md'), 'utf8');
    assert.deepEqual(rowNumbers(doc, 'OVERLAP_MIN'), [0.9, 0, 0]);
    const invented = rowNumbers(doc, 'INVENTED_FACTS_MAX');
    assert.equal(invented[0], 0);
    assert.equal(invented.at(-1), 0);
    const scam = rowNumbers(doc, 'SCAM_FP_MAX');
    assert.equal(scam[0], 0.02);
    assert.equal(scam.at(-1), 0.02);

    const bars = exportsOf(join(p.dir, 'lib', 'quality-bars.mjs'));
    assert.equal(bars.INVENTED_FACTS_MAX, 0);
    assert.equal(bars.SCAM_FP_MAX, 0.02);
    assert.equal(bars.OVERLAP_MIN, 0.9, 'the stated bar is kept beside the effective one');
  } finally {
    p.cleanup();
  }
});

// M-001-S11-osdr
test('M-001-S11-osdr capture in a temp git repo exits 3 naming lib/config.mjs when that product file differs from the release tag and writes no baseline file', async () => {
  const p = await packRepo();
  try {
    appendFileSync(join(p.dir, 'lib', 'config.mjs'), '\n// drift after the release tag\n');
    const fake = fakeRunner();
    const out = sayer();
    const code = await codeOf(p.tool.capture({ root: p.dir, runner: fake.runner, resolve, say: out.say }), p.tool, out.lines);
    assert.equal(code, 3);
    assert.ok(out.lines.join('\n').includes('lib/config.mjs'), out.lines.join('\n'));
    assert.equal(fake.calls.length, 0, 'no agent call before the product check passes');
    assert.deepEqual(filesUnder(p.baseline), []);
  } finally {
    p.cleanup();
  }
});

// M-001-S19-osdr
test('M-001-S19-osdr capture stops before the next call and exits 5 with blocked-on-user when usage passes 1.5 times the estimate or the runner reports a quota error', async () => {
  const cases = [
    ['usage over 1.5 times the estimate', fakeRunner({ usage: { input_tokens: 5e9, output_tokens: 5e9 } })],
    ['quota error', fakeRunner({ fail: (call) => quotaReply(call.agent) })],
  ];
  for (const [label, fake] of cases) {
    const p = await packRepo();
    try {
      const out = sayer();
      const code = await codeOf(p.tool.capture({ root: p.dir, runner: fake.runner, resolve, say: out.say }), p.tool, out.lines);
      assert.equal(code, 5, label);
      assert.equal(fake.calls.length, 1, `${label}: stopped before the second call`);
      assert.match(out.lines.join('\n'), /blocked-on-user \S/, label);
    } finally {
      p.cleanup();
    }
  }
});
