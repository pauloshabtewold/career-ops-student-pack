// Assumed transcript format: turns start on a line beginning 'INTERVIEWER:' or 'STUDENT:' (optionally bold);
// phase headings are '## Phase N: ...' lines. Run fixtures live in tests/fixtures/interview-runs/<set>/{transcript.md,answers.json}.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { applyAnswers, validateAgainst } from '../../interview/apply-answers.mjs';
import { scanText } from '../../scripts/pii-lint.mjs';
import { PACK_ROOT, TODAY } from '../helpers/script-harness.mjs';

const SETS = ['cs', 'mis', 'finance', 'mechanical', 'nursing'];
const RUNS = join(PACK_ROOT, 'tests', 'fixtures', 'interview-runs');
// Read from presets/ so a shipped preset never makes a transcript header stale; OWNERS.yml is not a preset.
const ALLOWED_PRESETS = readdirSync(join(PACK_ROOT, 'presets')).filter((f) => f.endsWith('.yml') && f !== 'OWNERS.yml').map((f) => f.slice(0, -'.yml'.length));
const PERSONA_KEYS = ['presets', 'tracks', 'switches', 'identity', 'work_authorization', 'locations'];

// Request verb or question word, then your/the student, then name/e-mail/phone in one sentence; plus 'which email' forms.
const IDENTITY_ASK = /\b(?:could|can|may|would|will|please|what|what's|which|tell|give|share|provide|send|enter|type|state|confirm|have)\b[^.?!\n]*\b(?:your|the student's|the student)\b[^.?!\n]*\b(?:name|e-?mail|phone)\b|\bwhich (?:e-?mail|phone)\b/i;
const NARROW_ASK = /(what is|what's|tell me|give me|enter|type) your (full )?(name|e-?mail|phone)/i;

const norm = (t) => t.replace(/^[ \t]*>[ \t]?/gm, '').replace(/\s+/g, ' ').trim();
const readText = (rel) => readFileSync(join(PACK_ROOT, rel), 'utf8');
const runPath = (k, f) => join(RUNS, k, f);
const personaOf = (k) => JSON.parse(readText(`tests/fixtures/answers/${k}.json`));
const runAnswers = (k) => JSON.parse(readFileSync(runPath(k, 'answers.json'), 'utf8'));
const transcriptOf = (k) => readFileSync(runPath(k, 'transcript.md'), 'utf8');

// Blocks in file order: headings and turns. A turn runs until the next turn or heading.
function blocks(text) {
  const out = [];
  let cur = null;
  for (const line of text.split('\n')) {
    const turn = /^\s*(?:\*\*)?(INTERVIEWER|STUDENT)(?:\*\*)?\s*:(?:\*\*)?\s*(.*)$/.exec(line);
    const head = /^(#{1,6})\s+(.*)$/.exec(line);
    if (turn) {
      cur = { kind: 'turn', role: turn[1], text: turn[2] };
      out.push(cur);
    } else if (head) {
      cur = null;
      out.push({ kind: 'heading', level: head[1].length, text: line.trim() });
    } else if (cur) {
      cur.text += `\n${line}`;
    }
  }
  return out;
}

// Anchors read from interview.md at run time.
function anchors() {
  const md = readText('interview/interview.md');
  const phase4 = md.split(/^## Phase 4/m)[1].split(/^## Phase 5/m)[0];
  const paras = phase4.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const at = paras.findIndex((p) => /read this disclaimer once/i.test(p));
  assert.ok(at >= 0 && paras[at + 1], 'Phase 4 read-once instruction followed by the disclaimer paragraph');
  const D = norm(paras[at + 1]);
  const li = paras.find((p) => p.startsWith('LinkedIn outreach.'));
  assert.ok(li, 'LinkedIn outreach disclosure present');
  const L = norm(/^.*?[.!?](?=\s|$)(?:\s*)/s.exec(li)[0]);
  const sLine = phase4.split('\n').find((l) => l.startsWith('- Outreach:'));
  assert.ok(sLine, 'switch line starting Outreach: present');
  const S = norm(sLine.replace(/^- /, ''));
  return { D, L, S };
}

function orderProblems(text) {
  const { D, L, S } = anchors();
  const bs = blocks(text);
  const interviewer = bs.map((b, i) => ({ b, i })).filter(({ b }) => b.kind === 'turn' && b.role === 'INTERVIEWER');
  const dTurns = interviewer.filter(({ b }) => norm(b.text).includes(D));
  const problems = [];
  if (dTurns.length !== 1) problems.push(`disclaimer in ${dTurns.length} INTERVIEWER turns, expected 1`);
  const dIdx = dTurns.length ? dTurns[0].i : -1;
  const rest = interviewer.filter(({ i }) => i !== dIdx);
  const lTurn = rest.find(({ b }) => norm(b.text).includes(L));
  const sTurn = rest.find(({ b }) => norm(b.text).includes(S));
  const p6 = bs.findIndex((b) => b.kind === 'heading' && /^##\s+Phase 6\b/.test(b.text));
  if (!lTurn) problems.push('no turn quotes the LinkedIn outreach disclosure first sentence');
  if (!sTurn) problems.push('no turn quotes the Outreach: switch line');
  if (p6 < 0) problems.push('no ## Phase 6 heading');
  if (problems.length) return problems;
  if (!(dIdx < lTurn.i)) problems.push('disclaimer does not precede the LinkedIn disclosure');
  if (!(lTurn.i < sTurn.i)) problems.push('LinkedIn disclosure does not precede the switch line');
  if (!(sTurn.i < p6)) problems.push('switch line does not precede ## Phase 6');
  return problems;
}

// M-008-S1
for (const k of SETS) {
  test(`M-008-S1 ${k} run answers.json validates and applies in dry run without writing`, async () => {
    const answers = runAnswers(k);
    const schema = JSON.parse(readText('interview/answers.schema.json'));
    assert.deepEqual(validateAgainst(schema, answers), []);
    const root = mkdtempSync(join(tmpdir(), 'pack-runs-'));
    try {
      for (const d of ['config', 'data', 'modes']) mkdirSync(join(root, d));
      writeFileSync(join(root, 'cv.md'), '# Jordan Testwell\n\nSkills: Python, Java, SQL\n');
      await applyAnswers({ answers, root, today: TODAY, dryRun: true });
      for (const d of ['config', 'data', 'modes']) assert.deepEqual(readdirSync(join(root, d)), [], `${d} untouched`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

// M-008-S2
for (const k of SETS) {
  test(`M-008-S2 ${k} run answers equal the persona answers on the recorded keys`, () => {
    const run = runAnswers(k);
    const persona = personaOf(k);
    for (const key of PERSONA_KEYS) assert.deepEqual(run[key], persona[key], key);
  });
}

// M-008-S3
for (const k of SETS) {
  test(`M-008-S3 ${k} transcript orders disclaimer, LinkedIn disclosure, Outreach switch, Phase 6`, () => {
    assert.deepEqual(orderProblems(transcriptOf(k)), []);
  });
}

test('M-008-S3 order check flags a transcript that asks the switch before the disclaimer', () => {
  const { D, L, S } = anchors();
  const bad = ['## Phase 4: switches', `INTERVIEWER: ${S}`, `INTERVIEWER: ${D}`, `INTERVIEWER: ${L}`, '## Phase 6: write'].join('\n');
  assert.notDeepEqual(orderProblems(bad), []);
  const good = ['## Phase 4: switches', `INTERVIEWER: ${D}`, `INTERVIEWER: ${L}`, `INTERVIEWER: ${S}`, '## Phase 6: write'].join('\n');
  assert.deepEqual(orderProblems(good), []);
});

// M-008-S4
test('M-008-S4 identity-ask pattern flags asks and spares the Phase 1 confirmation', () => {
  for (const ask of ['Could you share your email?', 'Can I have your phone number?', 'Please provide your name.', 'Which email should I use?']) {
    assert.match(ask, IDENTITY_ASK, ask);
  }
  const confirm = 'From your resume I have name Jordan Testwell, email jordan.testwell@example.edu and phone 415-555-0140. Does that look right?';
  assert.doesNotMatch(confirm, IDENTITY_ASK);
  assert.doesNotMatch(confirm, NARROW_ASK);
});

for (const k of SETS) {
  test(`M-008-S4 ${k} INTERVIEWER turns never ask for a name, email or phone the resume holds`, () => {
    const offending = blocks(transcriptOf(k))
      .filter((b) => b.kind === 'turn' && b.role === 'INTERVIEWER')
      .filter((b) => IDENTITY_ASK.test(b.text) || NARROW_ASK.test(b.text));
    assert.equal(offending.length, 0, `set ${k}: identity ask in ${offending.length} INTERVIEWER turn(s)`);
  });
}

// M-008-S5
for (const k of SETS) {
  test(`M-008-S5 ${k} transcript has the marker, Preset set line and Phase 1 to 6 headings in order`, () => {
    const text = transcriptOf(k);
    assert.ok(text.split('\n').slice(0, 5).join('\n').includes('SYNTHETIC FIXTURE'), 'marker in first five lines');
    const line = text.split('\n').find((l) => l.startsWith('Preset set:'));
    assert.ok(line, 'Preset set: line present');
    const tokens = line.slice('Preset set:'.length).split(/[\s,;()]+/).filter(Boolean);
    assert.ok(tokens.some((t) => /^[0-9a-f]{7,40}$/.test(t)), 'hex snapshot sha present');
    const ids = tokens.filter((t) => /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(t));
    assert.ok(ids.length > 0, 'preset ids present');
    for (const id of ids) assert.ok(ALLOWED_PRESETS.includes(id), `unexpected preset id ${id}`);
    assert.deepEqual([...new Set(tokens.filter((t) => ALLOWED_PRESETS.includes(t)))].sort(), [...ALLOWED_PRESETS].sort(), 'Preset set: line lists every preset in presets/');
    const phases = text.split('\n').map((l) => /^## Phase (\d)\b/.exec(l)).filter(Boolean).map((m) => Number(m[1]));
    assert.deepEqual(phases, [1, 2, 3, 4, 5, 6]);
  });
}

// M-008-S6
test('M-008-S6 pii-lint scanText finds nothing in any interview-runs fixture file', () => {
  assert.ok(existsSync(RUNS), 'interview-runs directory exists');
  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name));
      else files.push(join(d, e.name));
    }
  };
  walk(RUNS);
  for (const k of SETS) {
    for (const f of ['transcript.md', 'answers.json']) assert.ok(files.includes(runPath(k, f)), `${k}/${f} exists`);
  }
  for (const f of files) {
    const rel = relative(PACK_ROOT, f).split('\\').join('/');
    assert.deepEqual(scanText(rel, readFileSync(f, 'utf8')), [], rel);
  }
});
