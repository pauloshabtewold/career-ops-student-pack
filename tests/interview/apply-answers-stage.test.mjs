// apply-answers.mjs --stage queue|final, portals research_companies handling and the inbox_schedule rule, through the CLI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as yaml from 'js-yaml';
import { apply, finalAnswers, queueAnswers, scratch } from '../helpers/profile-harness.mjs';

const MARKER = (name) => new RegExp(`^[ \\t]*# student-pack:start ${name}\\n[\\s\\S]*?^[ \\t]*# student-pack:end ${name}[ \\t]*$`, 'm');
const RESEARCH_URL = 'https://careers.example.com/research/1';
const RESEARCH_BLOCK = ['  # student-pack:start research_companies', '  - name: "Research Co"', `    careers_url: ${RESEARCH_URL}`, '    enabled: true', '  # student-pack:end research_companies'].join('\n');

// M-003-S8-cdel
test('M-003-S8-cdel apply-answers --stage queue writes student.yml with onboarding false, the portals blocks, the registry and the cycle file and no profile.yml', () => {
  const r = scratch();
  try {
    const res = apply(r, queueAnswers(), ['--stage', 'queue']);
    assert.equal(res.code, 0, res.text);
    const cfg = yaml.load(r.read('config/student.yml'));
    assert.equal(cfg.onboarding.complete, false);
    assert.deepEqual(cfg.presets, ['software-cs']);
    const portals = r.read('portals.yml');
    for (const name of ['title_filter', 'location_filter', 'tracked_companies']) assert.match(portals, MARKER(name), name);
    assert.ok(r.exists('data/student-github-sources.json'), 'registry written');
    assert.ok(r.exists('data/student-cycle.json'), 'cycle file written');
    assert.ok(!r.exists('config/profile.yml'), 'no profile.yml');
    assert.ok(!r.exists('modes/_profile.md') && !r.exists('modes/_brief.md') && !r.exists('modes/_custom.md'), 'no modes blocks');
    assert.equal(r.read('cv.md'), '# Fake Student\n\nSkills: Python, Java, SQL\n');
  } finally {
    r.cleanup();
  }
});

// M-003-S9-cdel
test('M-003-S9-cdel apply-answers --stage queue without archetypes exits 1 listing $.archetypes: required and writes nothing', () => {
  const r = scratch();
  try {
    const answers = queueAnswers();
    delete answers.archetypes;
    const res = apply(r, answers, ['--stage', 'queue']);
    assert.equal(res.code, 1, res.text);
    assert.ok(res.stderr.includes('$.archetypes: required'), res.stderr);
    const files = Object.keys(r.snapshot()).filter((f) => f !== 'data/interview-answers.json');
    assert.deepEqual(files, []);
  } finally {
    r.cleanup();
  }
});

// M-003-S10-cdel
test('M-003-S10-cdel an apply-answers rerun leaves the research_companies block byte-identical and omits target employers whose careers_url is in it', () => {
  const r = scratch();
  try {
    r.write('portals.yml', `title_filter:\n  positive: []\ntracked_companies:\n${RESEARCH_BLOCK}\n`);
    const answers = queueAnswers({
      target_employers: [
        { name: 'Research Co Again', careers_url: RESEARCH_URL },
        { name: 'Fresh Target', careers_url: 'https://careers.example.com/fresh/2' },
      ],
    });
    for (let run = 1; run <= 2; run++) {
      const res = apply(r, answers, ['--stage', 'queue']);
      assert.equal(res.code, 0, res.text);
      const portals = r.read('portals.yml');
      assert.equal(MARKER('research_companies').exec(portals)[0], RESEARCH_BLOCK, `research block byte-identical on run ${run}`);
      const own = MARKER('tracked_companies').exec(portals)[0];
      assert.ok(!own.includes(RESEARCH_URL), 'tracked_companies block omits the research url');
      assert.ok(own.includes('https://careers.example.com/fresh/2'), 'other target employer kept');
      assert.equal(portals.split(RESEARCH_URL).length - 1, 1, 'research url appears once in portals.yml');
    }
  } finally {
    r.cleanup();
  }
});

let s19 = 0;
for (const [label, over, reason] of [
  ['automation is manual', { automation: 'manual' }, /automation/i],
  ['the mail path is paste', { automation: 'scheduled-discovery-plus-triage', mailbox_backend: 'paste' }, /paste|mail/i],
]) {
  test(`${s19++ === 0 ? 'M-003-S19-cdel' : 'extra check:'} final apply with inbox_schedule on writes mailbox.schedule off and prints the reason when ${label}`, () => {
    const r = scratch();
    try {
      const res = apply(r, finalAnswers({ inbox_schedule: 'on', ...over }));
      assert.equal(res.code, 0, res.text);
      assert.equal(yaml.load(r.read('config/student.yml')).mailbox.schedule, 'off');
      const line = res.stdout.split('\n').find((l) => l.startsWith('inbox pass left off:'));
      assert.ok(line, res.stdout);
      assert.match(line, reason);
    } finally {
      r.cleanup();
    }
  });
}

// extra check
test('extra check: final apply with inbox_schedule on keeps it on when automation is scheduled and the mail path is connector', () => {
  const r = scratch();
  try {
    const res = apply(r, finalAnswers({ inbox_schedule: 'on', automation: 'scheduled-discovery-plus-triage', mailbox_backend: 'connector' }));
    assert.equal(res.code, 0, res.text);
    assert.equal(yaml.load(r.read('config/student.yml')).mailbox.schedule, 'on');
    assert.ok(!res.stdout.includes('inbox pass left off'), res.stdout);
  } finally {
    r.cleanup();
  }
});
