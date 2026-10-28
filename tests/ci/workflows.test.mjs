// Workflow policy checks. Blocked substrings are rebuilt from char codes so they never appear in tracked text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const WF_DIR = join(PACK_ROOT, '.github', 'workflows');
const REQUIRED = ['ci.yml', 'canary.yml', 'audit-presets.yml', 'safety-tag.yml'];
const raw = (f) => readFileSync(join(WF_DIR, f), 'utf8');
const parse = (f) => yaml.load(raw(f));
const triggers = (f) => {
  const wf = parse(f);
  return wf.on ?? wf.true;
};
const chars = (...codes) => String.fromCharCode(...codes);
const BLOCKED = [
  chars(112, 97, 117, 108, 111, 115),
  chars(104, 97, 98, 116, 101, 119, 111, 108, 100),
  chars(119, 97, 114, 114, 105, 111, 114, 108, 105, 102, 101),
];

test('M-009-S7 all four workflows exist', () => {
  for (const f of REQUIRED) assert.ok(existsSync(join(WF_DIR, f)), `missing .github/workflows/${f}`);
});

test('M-009-S7 ci.yml jobs run on macos-latest and windows-latest', () => {
  const wf = parse('ci.yml');
  const jobs = Object.entries(wf.jobs);
  assert.ok(wf.jobs['upstream-install'], 'upstream-install job');
  assert.ok(jobs.length >= 2, 'expects test and upstream-install jobs');
  for (const [name, job] of jobs) {
    const os = job.strategy?.matrix?.os;
    assert.deepEqual([...os].sort(), ['macos-latest', 'windows-latest'], `${name} matrix`);
  }
  const text = raw('ci.yml');
  assert.match(text, /compat-hash\.mjs --check/);
  assert.match(text, /check-plugin-versions\.mjs/);
  assert.match(text, /upstream-setup\.mjs/);
  assert.match(text, /assert-doctor\.mjs/);
});

test('M-009-S7 every workflow file declares a top-level permissions block', () => {
  const files = readdirSync(WF_DIR).filter((f) => /\.ya?ml$/.test(f));
  for (const f of REQUIRED) assert.ok(files.includes(f), f);
  for (const f of files) {
    const wf = parse(f);
    assert.ok(wf.permissions && typeof wf.permissions === 'object', `${f} permissions`);
  }
});

test('M-009-S7 permissions match the interface per workflow', () => {
  assert.deepEqual(parse('ci.yml').permissions, { contents: 'read' });
  assert.deepEqual(parse('safety-tag.yml').permissions, { contents: 'read' });
  assert.deepEqual(parse('audit-presets.yml').permissions, { contents: 'read', issues: 'write' });
  assert.deepEqual(parse('canary.yml').permissions, { contents: 'write', 'pull-requests': 'write', issues: 'write' });
});

test('M-009-S7 canary and audit workflows have a schedule and workflow_dispatch; safety-tag triggers on safety-* tags', () => {
  for (const f of ['canary.yml', 'audit-presets.yml']) {
    const on = triggers(f);
    assert.ok(Array.isArray(on.schedule) && on.schedule[0].cron, `${f} cron`);
    assert.ok('workflow_dispatch' in on, `${f} dispatch`);
  }
  assert.ok(triggers('safety-tag.yml').push.tags.includes('safety-*'));
  assert.match(raw('safety-tag.yml'), /check-safety-tag\.mjs/);
});

test('M-009-S6 workflows reference the repository through github.repository', () => {
  assert.match(raw('canary.yml'), /\$\{\{\s*github\.repository\s*\}\}/);
  assert.match(raw('audit-presets.yml'), /\$\{\{\s*github\.repository\s*\}\}/);
});

test('M-009-S6 no owner handle, no pack URL, no github.com URL besides the upstream repository', () => {
  for (const f of readdirSync(WF_DIR)) {
    const text = raw(f);
    for (const bad of BLOCKED) assert.ok(!text.toLowerCase().includes(bad), `${f} contains a blocked string`);
    for (const m of text.matchAll(/github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)/g)) {
      assert.equal(`${m[1]}/${m[2]}`, 'career-ops-hq/career-ops', `${f}: ${m[0]}`);
    }
  }
});

test('M-009-S6 gh commands never target another repository', () => {
  for (const f of readdirSync(WF_DIR)) {
    for (const m of raw(f).matchAll(/--repo\s+(\S+)/g)) {
      assert.ok(m[1] === 'career-ops-hq/career-ops' || /github\.repository/.test(m[1]), `${f}: --repo ${m[1]}`);
    }
  }
});
