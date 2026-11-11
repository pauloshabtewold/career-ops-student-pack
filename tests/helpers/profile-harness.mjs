// Scratch roots and CLI runners for the apply-answers stage, profile merge and profile-answers tests. Fake values only.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { PACK_ROOT, TODAY } from './script-harness.mjs';

export const EEO_FAKE = Object.freeze({
  gender: 'fake-gender-a',
  race_ethnicity: 'fake-race-b',
  hispanic_latino: 'decline',
  veteran: 'fake-vet-c',
  disability: 'decline',
  pronouns: 'fake-pron-d',
  sexual_orientation: 'fake-orient-e',
  transgender: 'decline',
});
export const EEO_KEYS = ['gender', 'race_ethnicity', 'hispanic_latino', 'veteran', 'disability', 'pronouns', 'sexual_orientation', 'transgender'];

const persona = () => JSON.parse(readFileSync(join(PACK_ROOT, 'tests', 'fixtures', 'answers', 'cs.json'), 'utf8'));

// Answers that satisfy the queue stage only.
export const queueAnswers = (over = {}) => ({
  presets: ['software-cs'],
  tracks: [{ kind: 'internship', graduation: '2028-05', resume_variant: 'cs-main' }],
  locations: ['Remote', 'Austin, TX'],
  archetypes: ['Backend engineering intern', 'Data engineering intern'],
  timezone: 'America/Chicago',
  cv_markdown: '# Fake Student\n\nSkills: Python, Java, SQL\n',
  ...over,
});

// A complete final-stage answers file with the eeo map.
export const finalAnswers = (over = {}) => {
  const base = persona();
  return {
    ...base,
    cv_markdown: '# Jordan Testwell\n\nSkills: Python, Java, SQL\n',
    application_profile: { start_date: '2027-06', relocation: 'within-locations', eeo: { ...EEO_FAKE }, how_did_you_hear: 'University career fair' },
    ...over,
  };
};

export function scratch() {
  const root = mkdtempSync(join(tmpdir(), 'pack-profile-'));
  for (const d of ['config', 'data', 'modes']) mkdirSync(join(root, d));
  return {
    root,
    file: (rel) => join(root, rel),
    read: (rel) => readFileSync(join(root, rel), 'utf8'),
    write: (rel, t) => writeFileSync(join(root, rel), t),
    exists: (rel) => existsSync(join(root, rel)),
    snapshot: () => snapshot(root),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

export function snapshot(dir) {
  const acc = {};
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else acc[relative(dir, p).split(sep).join('/')] = readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return acc;
}

export function apply(r, answers, extra = []) {
  writeFileSync(join(r.root, 'data', 'interview-answers.json'), JSON.stringify(answers, null, 2));
  const out = spawnSync(process.execPath, [join(PACK_ROOT, 'interview', 'apply-answers.mjs'), '--root', r.root, '--data-dir', join(r.root, 'data'), '--today', TODAY, ...extra], { cwd: PACK_ROOT, encoding: 'utf8', timeout: 60000 });
  return { code: out.status, stdout: out.stdout ?? '', stderr: out.stderr ?? '', text: `${out.stdout ?? ''}${out.stderr ?? ''}` };
}

export function profileAnswers(r, args) {
  const out = spawnSync(process.execPath, [join(PACK_ROOT, 'scripts', 'profile-answers.mjs'), ...args, '--root', r.root], { cwd: PACK_ROOT, encoding: 'utf8', timeout: 60000 });
  return { code: out.status, stdout: out.stdout ?? '', stderr: out.stderr ?? '', text: `${out.stdout ?? ''}${out.stderr ?? ''}` };
}
