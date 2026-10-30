// Per-field setup written by apply-answers: ownership of upstream filters, term expansion, application profile,
// resume resolution and onboarding notes. Runs the CLI: `node interview/apply-answers.mjs --root R --data-dir R/data --today D`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import * as yaml from 'js-yaml';
import { applyAnswers, AnswersError } from '../../interview/apply-answers.mjs';
import { loadStudentConfig } from '../../lib/config.mjs';
import { loadPreset } from '../../lib/presets.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';
import { copyPack, cleanupAll } from '../goal-check/_harness.mjs';

const SETS = ['cs', 'mis', 'finance', 'mechanical', 'nursing'];
const TODAY_M1 = '2026-10-29';
const PROFILE = { start_date: '2027-06', relocation: 'within-locations', eeo: 'leave-blank', how_did_you_hear: 'University career fair' };
const CV = '# Jordan Testwell\n\nSkills: Python, Java, SQL\n';
const answersOf = (k) => JSON.parse(readFileSync(join(PACK_ROOT, 'tests', 'fixtures', 'answers', `${k}.json`), 'utf8'));
// An answers file saved before Phase 3 collected the application profile.
const withoutProfile = ({ application_profile, ...rest }) => rest;
const withProfile = (a) => ({ application_profile: PROFILE, ...a });

const TITLE_FILTER = 'title_filter:\n  positive:\n    - "AI"\n    - "Machine Learning"\n  negative:\n    - "word:Intern"\n    - "word:Junior"\n';
const LOCATION_FILTER = 'location_filter:\n  allow:\n    - "United States"\n    - "Canada"\n';
const TEMPLATE = `# upstream example\n${TITLE_FILTER}${LOCATION_FILTER}tracked_companies: []\n`;

function scratch(answers, { cv = CV, template = null, portals = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'pack-setup-'));
  for (const d of ['config', 'data', 'modes']) mkdirSync(join(root, d));
  if (answers) writeFileSync(join(root, 'data', 'interview-answers.json'), JSON.stringify(answers, null, 2));
  if (cv != null) writeFileSync(join(root, 'cv.md'), cv);
  if (template != null) {
    mkdirSync(join(root, 'templates'));
    writeFileSync(join(root, 'templates', 'portals.example.yml'), template);
  }
  if (portals != null) writeFileSync(join(root, 'portals.yml'), portals);
  return {
    root,
    read: (rel) => readFileSync(join(root, rel), 'utf8'),
    write: (rel, t) => {
      mkdirSync(join(root, rel, '..'), { recursive: true });
      writeFileSync(join(root, rel), t);
    },
    exists: (rel) => existsSync(join(root, rel)),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function run(r, pack = PACK_ROOT) {
  const out = spawnSync(process.execPath, [join(pack, 'interview', 'apply-answers.mjs'), '--root', r.root, '--data-dir', join(r.root, 'data'), '--today', TODAY_M1], { cwd: pack, encoding: 'utf8', timeout: 60000 });
  return { code: out.status, stdout: out.stdout ?? '', stderr: out.stderr ?? '' };
}

function snapshot(dir) {
  const acc = {};
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(join(d, name));
      else acc[relative(dir, p)] = readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return acc;
}

const lc = (list) => (list ?? []).map((s) => String(s).toLowerCase());
const count = (text, re) => (text.match(re) ?? []).length;

// M-001-S1 normal
test('M-001-S1 an unmarked title_filter equal to the upstream template is replaced by a marked block of expanded preset terms', () => {
  const r = scratch(withProfile(answersOf('mechanical')), { template: TEMPLATE, portals: TEMPLATE });
  try {
    const res = run(r);
    assert.equal(res.code, 0, res.stderr);
    const portals = r.read('portals.yml');
    assert.equal(count(portals, /^title_filter:/gm), 1, 'one title_filter key');
    assert.match(portals, /^[ \t]*# student-pack:start\s+title_filter/m);
    assert.doesNotMatch(portals, /word:Intern/);
    const doc = yaml.load(portals);
    const positive = lc(doc.title_filter.positive);
    for (const term of ['engineer', 'mechanical', 'co-op', 'coop']) assert.ok(positive.includes(term), `positive holds ${term}`);
    assert.ok(!positive.includes('co-?op'), 'regex source is expanded');
    assert.ok(!positive.includes('ai'), 'upstream AI term is gone');
  } finally {
    r.cleanup();
  }
});

// M-001-S2 edge
test('M-001-S2 a user-edited unmarked title_filter is kept and each unapplied preset rule is named in a warning', () => {
  const edited = 'title_filter:\n  positive:\n    - "my custom term"\n  negative:\n    - "my custom negative"\n';
  const r = scratch(withProfile(answersOf('finance')), { template: TEMPLATE, portals: `${edited}${LOCATION_FILTER}tracked_companies: []\n` });
  try {
    const res = run(r);
    assert.equal(res.code, 0, res.stderr);
    const portals = r.read('portals.yml');
    assert.ok(portals.includes(edited), 'user title_filter text kept byte-identical');
    assert.equal(count(portals, /^title_filter:/gm), 1);
    assert.doesNotMatch(portals, /student-pack:start\s+title_filter/);
    assert.doesNotThrow(() => yaml.load(portals));
    assert.match(res.stdout, /warn/i);
    for (const rule of answersOfPresetIncludes(['finance-economics'])) assert.ok(res.stdout.includes(rule), `warning names rule ${rule}`);
  } finally {
    r.cleanup();
  }
});

function answersOfPresetIncludes(ids) {
  return ids.flatMap((id) => loadPreset(id).title_rules.include);
}

// M-001-S20 edge
test('M-001-S20 with templates/portals.example.yml absent an unmarked title_filter is kept and the warning names each preset rule', () => {
  const r = scratch(withProfile(answersOf('finance')), { template: null, portals: `${TITLE_FILTER}tracked_companies: []\n` });
  try {
    const res = run(r);
    assert.equal(res.code, 0, res.stderr);
    const portals = r.read('portals.yml');
    assert.ok(portals.includes(TITLE_FILTER), 'title_filter kept byte-identical');
    assert.equal(count(portals, /^title_filter:/gm), 1);
    assert.match(res.stdout, /warn/i);
    for (const rule of answersOfPresetIncludes(['finance-economics'])) assert.ok(res.stdout.includes(rule), `warning names rule ${rule}`);
  } finally {
    r.cleanup();
  }
});

// M-001-S3 edge
test('M-001-S3 tracked_companies: [] yields one tracked_companies key holding the marked block and parses with js-yaml', () => {
  const answers = withProfile(answersOf('mechanical'));
  const r = scratch(answers, { template: null, portals: 'tracked_companies: []\n' });
  try {
    const res = run(r);
    assert.equal(res.code, 0, res.stderr);
    const portals = r.read('portals.yml');
    assert.equal(count(portals, /^tracked_companies:/gm), 1, 'one tracked_companies key');
    assert.match(portals, /# student-pack:start\s+tracked_companies/);
    assert.doesNotMatch(portals, /tracked_companies:\s*\[\s*\]/);
    const doc = yaml.load(portals);
    const names = doc.tracked_companies.map((e) => e.name.toLowerCase());
    for (const t of answers.target_employers) assert.ok(names.includes(t.name.toLowerCase()), `target ${t.name} tracked`);
  } finally {
    r.cleanup();
  }
});

// M-001-S4 normal
test('M-001-S4 an archetype with an abbreviation yields " + " title entries for the abbreviation and its expansion', () => {
  const r = scratch(withProfile({ ...answersOf('cs'), archetypes: ['RN residency'] }), { portals: '' });
  try {
    const res = run(r);
    assert.equal(res.code, 0, res.stderr);
    const positive = yaml.load(r.read('portals.yml')).title_filter.positive.map(String);
    const plus = positive.filter((p) => p.includes(' + '));
    assert.ok(plus.some((p) => /\brn\b/i.test(p)), `a " + " entry keeps RN in: ${JSON.stringify(plus)}`);
    assert.ok(plus.some((p) => /registered nurse/i.test(p)), `a " + " entry holds the expansion in: ${JSON.stringify(plus)}`);
  } finally {
    r.cleanup();
  }
});

test('M-001-S4 the nursing archetype Registered nurse residency becomes a " + " entry', () => {
  const r = scratch(withProfile(answersOf('nursing')), { portals: '' });
  try {
    const res = run(r);
    assert.equal(res.code, 0, res.stderr);
    const positive = yaml.load(r.read('portals.yml')).title_filter.positive.map(String);
    assert.ok(positive.some((p) => p.includes(' + ') && /registered nurse/i.test(p)), JSON.stringify(positive));
  } finally {
    r.cleanup();
  }
});

// M-001-S5 normal
test('M-001-S5 application_profile answers land under application_answers in a new config/profile.yml', () => {
  const r = scratch(withProfile(answersOf('cs')));
  try {
    const res = run(r);
    assert.equal(res.code, 0, res.stderr);
    const profile = yaml.load(r.read('config/profile.yml'));
    for (const [key, value] of Object.entries(PROFILE)) assert.equal(profile.application_answers?.[key], value, key);
  } finally {
    r.cleanup();
  }
});

// M-001-S6 error
test('M-001-S6 answers without application_profile raise AnswersError naming $.application_profile and write no file', async () => {
  const r = scratch(withoutProfile(answersOf('cs')));
  try {
    const before = snapshot(r.root);
    await assert.rejects(applyAnswers({ answers: withoutProfile(answersOf('cs')), root: r.root, today: TODAY_M1 }), (err) => {
      assert.ok(err instanceof AnswersError);
      assert.match(err.message, /\$\.application_profile/);
      return true;
    });
    assert.deepEqual(snapshot(r.root), before);
    const res = run(r);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /\$\.application_profile/);
    assert.deepEqual(snapshot(r.root), before);
  } finally {
    r.cleanup();
  }
});

// M-001-S28 error
test('M-001-S28 an answers file without application_profile tells the student to re-run interview Phase 3 and writes nothing', () => {
  const r = scratch(withoutProfile(answersOf('mis')));
  try {
    const before = snapshot(r.root);
    const res = run(r);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /re-?run/i);
    assert.match(res.stderr, /Phase 3/);
    assert.deepEqual(snapshot(r.root), before);
  } finally {
    r.cleanup();
  }
});

// M-001-S7 edge
test('M-001-S7 an existing config/profile.yml stays byte-identical and one note per unwritten application answer is printed', () => {
  const existing = 'candidate:\n  full_name: "Pre Existing"\napplication_answers:\n  start_date: "2030-01"\n';
  const r = scratch(withProfile(answersOf('cs')));
  try {
    r.write('config/profile.yml', existing);
    const res = run(r);
    assert.equal(res.code, 0, res.stderr);
    assert.equal(r.read('config/profile.yml'), existing);
    const outLines = res.stdout.split('\n');
    for (const key of Object.keys(PROFILE)) {
      const mentions = outLines.filter((l) => l.includes(key));
      assert.equal(mentions.length, 1, `exactly one note for ${key}, saw ${JSON.stringify(mentions)}`);
    }
  } finally {
    r.cleanup();
  }
});

// M-001-S8 normal
test('M-001-S8 a relative cv_path is read relative to the career-ops root and written to cv.md', () => {
  const text = '# Jordan Testwell\n\nUnique resume line for the relative path test.\n';
  const answers = withProfile(answersOf('cs'));
  answers.cv_path = 'imports/my-resume.md';
  const r = scratch(answers, { cv: null });
  try {
    r.write('imports/my-resume.md', text);
    const res = run(r);
    assert.equal(res.code, 0, res.stderr);
    assert.equal(r.read('cv.md').trim(), text.trim());
  } finally {
    r.cleanup();
  }
});

// M-001-S9 error
test('M-001-S9 a blank resume with no cv.md raises AnswersError resume is empty and onboarding.complete stays false', async () => {
  const answers = { ...withProfile(answersOf('cs')), cv_markdown: '  \n \n' };
  const r = scratch(answers, { cv: null });
  try {
    await assert.rejects(applyAnswers({ answers, root: r.root, today: TODAY_M1 }), (err) => {
      assert.ok(err instanceof AnswersError);
      assert.match(err.message, /resume is empty/);
      return true;
    });
    assert.equal(r.exists('cv.md'), false);
    const cfg = r.exists('config/student.yml') ? await loadStudentConfig({ root: r.root }) : null;
    assert.notEqual(cfg?.onboarding?.complete, true);
    const res = run(r);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /resume is empty/);
  } finally {
    r.cleanup();
  }
});

// M-001-S17 keep
for (const k of SETS) {
  test(`M-001-S17 the ${k} fixture answer set applies with a cv.md present and sets onboarding.complete true`, async () => {
    const r = scratch(answersOf(k));
    try {
      const res = run(r);
      assert.equal(res.code, 0, res.stderr);
      const cfg = await loadStudentConfig({ root: r.root });
      assert.equal(cfg.onboarding.complete, true);
    } finally {
      r.cleanup();
    }
  });
}

// M-001-S18 edge
test('M-001-S18 fewer than 10 target_employers prints a note naming the count and the 10 to 20 target', () => {
  const answers = withProfile(answersOf('cs'));
  assert.equal(answers.target_employers.length, 2);
  const r = scratch(answers);
  try {
    const res = run(r);
    assert.equal(res.code, 0, res.stderr);
    const note = res.stdout.split('\n').find((l) => /target.employers/i.test(l));
    assert.ok(note, `a target employers note in: ${res.stdout}`);
    assert.match(note, /\b2\b/);
    assert.match(note, /10/);
    assert.match(note, /20/);
  } finally {
    r.cleanup();
  }
});

test('M-001-S18 ten target_employers prints no target employers note', () => {
  const answers = withProfile(answersOf('cs'));
  answers.target_employers = Array.from({ length: 10 }, (_, i) => ({ name: `Example Target ${i + 1}`, careers_url: `https://careers.example.com/t/${i + 1}` }));
  const r = scratch(answers);
  try {
    const res = run(r);
    assert.equal(res.code, 0, res.stderr);
    assert.ok(!res.stdout.split('\n').some((l) => /target.employers/i.test(l)), res.stdout);
  } finally {
    r.cleanup();
  }
});

// M-001-S19 edge
test('M-001-S19 an unmarked location_filter equal to the template key is replaced by a marked block built from the locations', () => {
  const answers = withProfile(answersOf('cs'));
  const r = scratch(answers, { template: TEMPLATE, portals: LOCATION_FILTER });
  try {
    const res = run(r);
    assert.equal(res.code, 0, res.stderr);
    const portals = r.read('portals.yml');
    assert.equal(count(portals, /^location_filter:/gm), 1);
    assert.match(portals, /^[ \t]*# student-pack:start\s+location_filter/m);
    assert.doesNotMatch(portals, /United States|Canada/);
    const doc = yaml.load(portals);
    const allow = doc.location_filter?.allow ?? doc.location_filter;
    for (const loc of answers.locations) assert.ok(JSON.stringify(allow).includes(loc), `location ${loc}`);
  } finally {
    r.cleanup();
  }
});

// M-001-S21 edge
test('M-001-S21 a preset include regex that cannot be expanded is left out of portals.yml and named in a note', () => {
  // The shipped presets all convert (W-015-P1), so a scratch copy of the pack carries one rule that cannot.
  const unconvertible = 'full.?stack';
  const pack = copyPack();
  const presetFile = join(pack, 'presets', 'software-cs.yml');
  writeFileSync(presetFile, readFileSync(presetFile, 'utf8').replace('    - "backend"\n', `    - "backend"\n    - "${unconvertible}"\n`));
  assert.ok(readFileSync(presetFile, 'utf8').includes(`"${unconvertible}"`), 'scratch preset carries the rule');
  const r = scratch(withProfile(answersOf('cs')));
  try {
    const res = run(r, pack);
    assert.equal(res.code, 0, res.stderr);
    assert.ok(res.stdout.includes(unconvertible), `note names ${unconvertible}`);
    const positive = yaml.load(r.read('portals.yml')).title_filter.positive.map(String);
    assert.ok(!positive.includes(unconvertible));
    assert.ok(positive.map((p) => p.toLowerCase()).includes('software'), 'expandable terms still written');
  } finally {
    r.cleanup();
    cleanupAll();
  }
});

// M-001-S22 edge
test('M-001-S22 a non-empty flow-style tracked_companies list is kept byte-identical and the output says the company block was not written', () => {
  const flow = 'tracked_companies: [{name: "Example Own Co", careers_url: "https://careers.example.com/own"}]';
  const r = scratch(withProfile(answersOf('cs')), { template: null, portals: `${flow}\n` });
  try {
    const res = run(r);
    assert.equal(res.code, 0, res.stderr);
    const portals = r.read('portals.yml');
    assert.ok(portals.split('\n').includes(flow), 'flow line byte-identical');
    assert.equal(count(portals, /^tracked_companies:/gm), 1);
    assert.doesNotMatch(portals, /student-pack:start\s+tracked_companies/);
    assert.doesNotThrow(() => yaml.load(portals));
    assert.match(res.stdout, /company block[^\n]*not written|not written[^\n]*company block/i);
  } finally {
    r.cleanup();
  }
});

// M-001-S16 normal (portals.yml negatives and student.yml)
test('M-001-S16 with us_citizen true clearance-only excludes stay out of portals.yml negatives and student.yml records us_citizen', async () => {
  const citizen = scratch(withProfile({ ...answersOf('mechanical'), us_citizen: true }));
  const other = scratch(withProfile({ ...answersOf('mechanical'), us_citizen: false }));
  try {
    for (const r of [citizen, other]) {
      const res = run(r);
      assert.equal(res.code, 0, res.stderr);
    }
    const negCitizen = lc(yaml.load(citizen.read('portals.yml')).title_filter.negative);
    const negOther = lc(yaml.load(other.read('portals.yml')).title_filter.negative);
    assert.ok(!negCitizen.some((n) => /clearance|ts\/sci|citizen/.test(n)), JSON.stringify(negCitizen));
    assert.ok(negOther.some((n) => /clearance/.test(n)), JSON.stringify(negOther));
    assert.equal((await loadStudentConfig({ root: citizen.root })).us_citizen, true);
    assert.equal((await loadStudentConfig({ root: other.root })).us_citizen, false);
  } finally {
    citizen.cleanup();
    other.cleanup();
  }
});
