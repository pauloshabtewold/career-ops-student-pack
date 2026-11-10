// Assumed: docs/commands.md is the single list of what the student can say. Each guide row quotes a phrase in double
// quotes and names its handler file in backticks (a path from the pack root, with or without a leading `student/`).
// extractTriggers and checkGuide are pure functions over text; the real-file tests feed them the pack's files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const read = (rel) => readFileSync(join(PACK_ROOT, rel), 'utf8');
const QUOTED = /"([^"\n]+)"/g;
const quoted = (text) => [...text.matchAll(QUOTED)].map((m) => m[1]);
const paragraphs = (text) => text.split(/\n\s*\n/);

// Quoted phrases from AGENTS.student.md table cells and Switches bullets, the first 'Read this when' paragraph of each
// mode file (modes: { 'modes/x.md': text }) and the opening paragraph of the interview. Returns [{ phrase, file }].
export function extractTriggers(agentsText, modes, interviewText) {
  const out = [];
  const add = (text, file) => quoted(text).forEach((phrase) => out.push({ phrase, file }));
  const sw = /^## Switches\n([\s\S]*?)(?=\n## |$)/m.exec(agentsText)?.[1] ?? '';
  add(agentsText.split('\n').filter((l) => l.startsWith('|')).join('\n'), 'AGENTS.student.md');
  add(sw.split('\n').filter((l) => l.startsWith('- ')).join('\n'), 'AGENTS.student.md');
  for (const [file, text] of Object.entries(modes)) {
    const first = paragraphs(text).find((p) => /^Read this when/.test(p.trim()));
    if (first) add(first, file);
  }
  const opening = paragraphs(interviewText).find((p) => p.trim() && !p.startsWith('#'));
  if (opening) add(opening, 'interview/interview.md');
  return out;
}

const normName = (n) => n.replace(/^student\//, '');

// guideText: the guide. handlers: { 'path/from/pack/root': text }. Returns one problem string per trigger the guide
// lacks (named with its phrase and file) and per guide phrase whose named handler lacks it (phrase and handler).
export function checkGuide(guideText, handlers, triggers = []) {
  const problems = [];
  const lower = guideText.toLowerCase();
  for (const { phrase, file } of triggers) {
    if (!lower.includes(`"${phrase.toLowerCase()}"`)) problems.push(`guide is missing "${phrase}" from ${file}`);
  }
  for (const line of guideText.split('\n')) {
    const phrases = quoted(line);
    if (!phrases.length) continue;
    const names = [...line.matchAll(/`([^`\s]+\.(?:md|mjs))`/g)].map((m) => normName(m[1]));
    for (const phrase of phrases) {
      const ok = names.some((n) => (handlers[n] ?? '').toLowerCase().includes(phrase.toLowerCase()));
      if (!ok) problems.push(`"${phrase}" has no handler containing it (${names.join(', ') || 'none named'})`);
    }
  }
  return problems;
}

const modeFiles = () => Object.fromEntries(readdirSync(join(PACK_ROOT, 'modes')).filter((f) => f.endsWith('.md')).map((f) => [`modes/${f}`, read(`modes/${f}`)]));
const guidePresent = () => assert.ok(existsSync(join(PACK_ROOT, 'docs/commands.md')), 'docs/commands.md exists');
const handlersFor = (guide) => {
  const out = {};
  for (const m of guide.matchAll(/`([^`\s]+\.(?:md|mjs))`/g)) {
    const n = normName(m[1]);
    if (existsSync(join(PACK_ROOT, n))) out[n] = read(n);
  }
  return out;
};

// M-004-S1-cdel
test('M-004-S1-cdel every quoted trigger and mode file opening line appears in docs/commands.md', () => {
  guidePresent();
  const guide = read('docs/commands.md');
  const triggers = extractTriggers(read('AGENTS.student.md'), modeFiles(), read('interview/interview.md'));
  assert.ok(triggers.some((t) => t.phrase === 'apply' && t.file === 'modes/apply-loop.md'), 'apply trigger found');
  assert.ok(triggers.some((t) => t.phrase === 'outreach' && t.file === 'modes/outreach.md'), 'outreach opening line quotes it');
  assert.ok(triggers.some((t) => t.phrase === 'Handshake pass' && t.file === 'modes/handshake.md'), 'handshake opening line quotes it');
  assert.ok(triggers.some((t) => t.phrase === 'set me up' && t.file === 'interview/interview.md'));
  assert.ok(!triggers.some((t) => t.file === 'modes/review.md'), 'review.md has no student trigger');
  const missing = triggers.filter((t) => !guide.toLowerCase().includes(`"${t.phrase.toLowerCase()}"`));
  assert.deepEqual(missing.map((t) => `${t.phrase} (${t.file})`), []);
});

// M-004-S2-cdel
test('M-004-S2-cdel every phrase in docs/commands.md names a handler file that contains it', () => {
  guidePresent();
  const guide = read('docs/commands.md');
  for (const phrase of ['help', 'what can you do', 'what ran today', 'check my schedule', 'update the pack']) {
    assert.ok(guide.includes(`"${phrase}"`), `guide lists "${phrase}"`);
  }
  assert.deepEqual(checkGuide(guide, handlersFor(guide)), []);
});

// M-004-S3-cdel
test('M-004-S3-cdel a synthetic guide missing one trigger or holding an unhandled phrase returns one problem naming it', () => {
  const handlers = { 'modes/a.md': 'Read this when the user says "alpha" or "beta".' };
  const triggers = [{ phrase: 'alpha', file: 'modes/a.md' }, { phrase: 'beta', file: 'modes/a.md' }];
  const whole = '| "alpha" | `modes/a.md` |\n| "beta" | `modes/a.md` |\n';
  assert.deepEqual(checkGuide(whole, handlers, triggers), []);
  const missing = checkGuide('| "alpha" | `modes/a.md` |\n', handlers, triggers);
  assert.equal(missing.length, 1);
  assert.match(missing[0], /beta/);
  assert.match(missing[0], /modes\/a\.md/);
  const unhandled = checkGuide(`${whole}| "gamma" | \`modes/a.md\` |\n`, handlers, triggers);
  assert.equal(unhandled.length, 1);
  assert.match(unhandled[0], /gamma/);
  assert.match(unhandled[0], /modes\/a\.md/);
});

// M-004-S4-cdel
test('M-004-S4-cdel a quote in a mode file body outside its opening line is not a trigger', () => {
  const modes = { 'modes/x.md': '# X\n\nRead this when the user says "first one".\n\n## Body\n\nThe user may also say "body quote" here.\n' };
  const phrases = extractTriggers('# Rules\n', modes, '# Title\n\nRun this when the student says "open phrase".\n\n"later quote"\n').map((t) => t.phrase);
  assert.deepEqual(phrases, ['first one', 'open phrase']);
});

// M-004-S5-cdel
test('M-004-S5-cdel docs/commands.md has the six groups, a what-runs-on-its-own section and under 60 lines', () => {
  guidePresent();
  const guide = read('docs/commands.md');
  assert.match(guide, /^# What to say to career-ops$/m);
  for (const group of ['Daily use', 'Applying', 'Outreach', 'Inbox', 'Settings', 'Help']) {
    assert.match(guide, new RegExp(`^#{2,3} ${group}\\s*$`, 'm'), `group ${group}`);
  }
  assert.match(guide, /^#{2,3} What runs on its own/im);
  assert.match(guide, /morning digest/i);
  assert.ok(guide.split('\n').length < 60, 'fewer than 60 lines');
  assert.doesNotMatch(guide, /[–—‘’“”]/, 'plain punctuation');
});

// M-004-S6-cdel
test('M-004-S6-cdel AGENTS.student.md routes help and what can you do to docs/commands.md and stays under 8192 bytes', () => {
  const agents = read('AGENTS.student.md');
  const row = agents.split('\n').find((l) => l.startsWith('|') && l.includes('"help"'));
  assert.ok(row, 'a table row quotes "help"');
  assert.ok(row.includes('"what can you do"'), 'same row quotes "what can you do"');
  assert.ok(row.includes('docs/commands.md'), 'row routes to docs/commands.md');
  assert.ok(Buffer.byteLength(agents) < 8192, `pack block under 8192 bytes (${Buffer.byteLength(agents)})`);
});
