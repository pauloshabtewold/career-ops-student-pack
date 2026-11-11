// scripts/profile-answers.mjs show|set through the CLI, with config/profile.yml in a scratch root. Fake values only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as yaml from 'js-yaml';
import { apply, finalAnswers, profileAnswers, scratch, EEO_KEYS } from '../helpers/profile-harness.mjs';

const HEAD = '# hand edited\ncandidate:\n  full_name: "Pat Existing"\n';
const BLOCK = ['application_answers:', '  work_authorization: US citizen', '  requires_sponsorship: false', '  start_date: 2027-06', '  relocation: within-locations', '  how_did_you_hear: Online job search', '  eeo:', '    gender: fake-gender-a', '    pronouns: fake-pron-d'].join('\n');
const TAIL = 'target_roles:\n  primary:\n    - Old role\n';
const PROFILE = `${HEAD}${BLOCK}\n${TAIL}`;

for (const legacy of ['leave-blank', 'ask-each-time']) {
  test(`${legacy === 'leave-blank' ? 'M-003-S12-cdel' : 'extra check:'} an answers file with eeo ${legacy} still applies and show lists all eight eeo items in needs_confirmation`, () => {
    const r = scratch();
    try {
      const base = finalAnswers();
      const res = apply(r, finalAnswers({ application_profile: { ...base.application_profile, eeo: legacy } }));
      assert.equal(res.code, 0, res.text);
      const json = profileAnswers(r, ['show', '--json']);
      assert.equal(json.code, 0, json.text);
      assert.notEqual(json.stdout.trim(), '', 'show --json prints a document');
      const out = JSON.parse(json.stdout);
      assert.deepEqual([...out.needs_confirmation].sort(), EEO_KEYS.map((k) => `eeo.${k}`).sort());
      const text = profileAnswers(r, ['show']);
      assert.equal(text.code, 0, text.text);
      const line = text.stdout.split('\n').find((l) => l.startsWith('needs_confirmation:'));
      assert.ok(line, text.stdout);
      for (const k of EEO_KEYS) assert.ok(line.includes(`eeo.${k}`), `${k} listed: ${line}`);
    } finally {
      r.cleanup();
    }
  });
}

// M-003-S13-cdel
test('M-003-S13-cdel profile-answers set eeo.gender decline merges only that key and show prints it', () => {
  const r = scratch();
  try {
    r.write('config/profile.yml', PROFILE);
    const set = profileAnswers(r, ['set', 'eeo.gender', 'decline']);
    assert.equal(set.code, 0, set.text);
    assert.match(set.stdout, /saved eeo\.gender/);
    const text = r.read('config/profile.yml');
    assert.ok(text.startsWith(HEAD), 'bytes before the block unchanged');
    assert.ok(text.endsWith(TAIL), 'bytes after the block unchanged');
    const a = yaml.load(text).application_answers;
    assert.equal(a.eeo.gender, 'decline');
    assert.equal(a.eeo.pronouns, 'fake-pron-d', 'other eeo item kept');
    assert.equal(a.work_authorization, 'US citizen');
    assert.equal(a.relocation, 'within-locations');
    const show = profileAnswers(r, ['show']);
    assert.equal(show.code, 0, show.text);
    assert.ok(show.stdout.split('\n').includes('eeo.gender: decline'), show.stdout);
  } finally {
    r.cleanup();
  }
});

// M-003-S14-cdel
test('M-003-S14-cdel profile-answers set with an unknown key exits 2 naming the key and leaves profile.yml byte-identical', () => {
  const r = scratch();
  try {
    r.write('config/profile.yml', PROFILE);
    const res = profileAnswers(r, ['set', 'favorite_color', 'blue']);
    assert.equal(res.code, 2, res.text);
    assert.ok(res.stderr.includes('favorite_color'), res.stderr);
    assert.equal(r.read('config/profile.yml'), PROFILE);
  } finally {
    r.cleanup();
  }
});

// extra check
test('extra check: profile-answers set with a start_date that is neither YYYY-MM nor immediately exits 2 naming the key and leaves profile.yml byte-identical', () => {
  const r = scratch();
  try {
    r.write('config/profile.yml', PROFILE);
    for (const bad of ['next summer', '2027-13', '2027']) {
      const res = profileAnswers(r, ['set', 'start_date', bad]);
      assert.equal(res.code, 2, `${bad}: ${res.text}`);
      assert.ok(res.stderr.includes('start_date'), res.stderr);
      assert.equal(r.read('config/profile.yml'), PROFILE, `${bad}: file unchanged`);
    }
    for (const good of ['2027-09', 'immediately']) {
      const res = profileAnswers(r, ['set', 'start_date', good]);
      assert.equal(res.code, 0, `${good}: ${res.text}`);
      assert.equal(String(yaml.load(r.read('config/profile.yml')).application_answers.start_date), good);
    }
  } finally {
    r.cleanup();
  }
});

test('eeo.sexual_orientation and eeo.transgender: set saves each, show prints each, other items kept', () => {
  const r = scratch();
  try {
    r.write('config/profile.yml', PROFILE);
    for (const [k, v] of [['eeo.sexual_orientation', 'fake-orient-x'], ['eeo.transgender', 'decline']]) {
      const set = profileAnswers(r, ['set', k, v]);
      assert.equal(set.code, 0, set.text);
      assert.match(set.stdout, new RegExp(`saved ${k.replace('.', '\\.')}`));
    }
    const a = yaml.load(r.read('config/profile.yml')).application_answers;
    assert.equal(a.eeo.sexual_orientation, 'fake-orient-x');
    assert.equal(a.eeo.transgender, 'decline');
    assert.equal(a.eeo.pronouns, 'fake-pron-d', 'other eeo item kept');
    const show = profileAnswers(r, ['show']);
    const lines = show.stdout.split('\n');
    assert.ok(lines.includes('eeo.sexual_orientation: fake-orient-x'), show.stdout);
    assert.ok(lines.includes('eeo.transgender: decline'), show.stdout);
  } finally {
    r.cleanup();
  }
});

test('needs_confirmation lists eeo.sexual_orientation and eeo.transgender when missing', () => {
  const r = scratch();
  try {
    r.write('config/profile.yml', 'application_answers:\n  eeo:\n    gender: decline\n');
    const out = JSON.parse(profileAnswers(r, ['show', '--json']).stdout);
    assert.ok(out.needs_confirmation.includes('eeo.sexual_orientation'));
    assert.ok(out.needs_confirmation.includes('eeo.transgender'));
    assert.ok(!out.needs_confirmation.includes('eeo.gender'));
  } finally {
    r.cleanup();
  }
});
