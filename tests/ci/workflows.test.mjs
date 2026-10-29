// Workflow policy checks. Blocked substrings are rebuilt from char codes so they never appear in tracked text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const WF_DIR = join(PACK_ROOT, '.github', 'workflows');
const REQUIRED = ['ci.yml', 'canary.yml', 'audit-presets.yml', 'safety-tag.yml', 'release.yml', 'mark-unmaintained.yml'];
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

// M-005-S1
test('M-005-S1 all required workflows exist', () => {
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

// M-005-S2
test('M-005-S2 release.yml permissions are contents write and actions read', () => {
  assert.deepEqual(parse('release.yml').permissions, { contents: 'write', actions: 'read' });
});

// M-005-S3
test('M-005-S3 mark-unmaintained.yml permissions are contents write, pull-requests write, issues read', () => {
  assert.deepEqual(parse('mark-unmaintained.yml').permissions, {
    contents: 'write',
    'pull-requests': 'write',
    issues: 'read',
  });
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

// M-005-S4, M-005-S5
for (const [id, f] of [['M-005-S4', 'release.yml'], ['M-005-S5', 'mark-unmaintained.yml']]) {
  test(`${id} ${f} has a cron schedule and workflow_dispatch`, () => {
    const on = triggers(f);
    assert.ok(Array.isArray(on.schedule) && on.schedule[0].cron, `${f} cron`);
    assert.ok('workflow_dispatch' in on, `${f} dispatch`);
  });
}

// M-005-S6
test('M-005-S6 release bump input offers minor, patch, major with default minor', () => {
  const bump = triggers('release.yml').workflow_dispatch.inputs.bump;
  assert.deepEqual(bump.options, ['minor', 'patch', 'major']);
  assert.equal(bump.default, 'minor');
});

const releaseSteps = () => parse('release.yml').jobs.release.steps;
const createIdx = () => releaseSteps().findIndex((st) => /gh release create/.test(st.run ?? ''));

// M-005-S7
test('M-005-S7 the release job runs only on refs/heads/main', () => {
  assert.ok(String(parse('release.yml').jobs.release.if).includes('refs/heads/main'));
});

// M-005-S8
test('M-005-S8 gh release create step comes after the gate step', () => {
  const gate = releaseSteps().findIndex((st) => st.id === 'gate');
  assert.ok(gate >= 0, 'step with id gate');
  assert.ok(createIdx() > gate, 'gh release create after gate');
});

// M-005-S9
test('M-005-S9 gh release create step is conditioned on steps.plan.outputs.release', () => {
  const i = createIdx();
  assert.ok(i >= 0, 'step running gh release create');
  assert.match(String(releaseSteps()[i].if), /steps\.plan\.outputs\.release/);
});

// M-005-S10
test('M-005-S10 release.yml concurrency serializes without cancelling', () => {
  assert.deepEqual(parse('release.yml').concurrency, { group: 'release', 'cancel-in-progress': false });
});

// M-005-S11
test('M-005-S11 safety-tag.yml passes only the tag to check-safety-tag.mjs', () => {
  assert.match(raw('safety-tag.yml'), /check-safety-tag\.mjs "\$THIS_TAG"\s*$/m);
});

// M-005-S12
test('M-005-S12 safety-tag.yml has no no-earlier-tag exit', () => {
  assert.ok(!/no earlier tag/i.test(raw('safety-tag.yml')));
});

// M-005-S20
test('M-005-S20 new workflows reference the repository through github.repository', () => {
  assert.match(raw('release.yml'), /\$\{\{\s*github\.repository\s*\}\}/);
  assert.match(raw('mark-unmaintained.yml'), /\$\{\{\s*github\.repository\s*\}\}/);
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

// W-011-S2 the monthly audit reuses open issues and a real audit failure fails the job after the issues are filed.
test('W-011-S2 audit-presets.yml never hides an audit failure and never opens issues directly', () => {
  const text = raw('audit-presets.yml');
  assert.ok(!/\|\|\s*true/.test(text), 'no || true');
  assert.ok(!/issue['",\s]+create/.test(text), 'issues are filed through audit-issues.mjs, not gh issue create in the workflow');
  const steps = parse('audit-presets.yml').jobs.audit.steps;
  const audit = steps.findIndex((s) => /audit-portals\.mjs/.test(s.run ?? ''));
  const file = steps.findIndex((s) => /audit-issues\.mjs/.test(s.run ?? ''));
  const fail = steps.findIndex((s) => /exit 1/.test(s.run ?? ''));
  assert.ok(audit >= 0 && file > audit, 'issue step after the audit step');
  assert.match(steps[file].run, /gh issue list/);
  assert.match(steps[file].run, /--open /);
  assert.ok(fail > file, 'the failing step comes after the issue step');
  assert.match(String(steps[fail].if), /steps\.audit\.outputs\.failed/);
  assert.equal(steps[audit].id, 'audit');
});
