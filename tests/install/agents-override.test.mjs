// Assumed: lib/agents-override.mjs exports PACK_BLOCK_LIMIT (8192), packBlock(packText),
// buildOverride({ packText, upstreamText, existing }) -> { text, status } and
// refreshOverride({ root, packRoot, dryRun, write }) -> { status, line }.
// install.mjs writes <root>/AGENTS.override.md: the student-pack block at byte 0, then a career-ops-agents block
// holding AGENTS.md verbatim. session-start.mjs and update.mjs refresh it. Markers are HTML comments
// (student-pack:start/end and career-ops-agents:start/end).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PACK_BLOCK_LIMIT, buildOverride, packBlock, refreshOverride } from '../../lib/agents-override.mjs';
import { runUpdate } from '../../update.mjs';
import { PACK_ROOT } from '../helpers/budget-harness.mjs';
import { makePack, put } from './_pack-repo.mjs';

const P_START = '<!-- student-pack:start -->';
const P_END = '<!-- student-pack:end -->';
const U_START = '<!-- career-ops-agents:start -->';
const U_END = '<!-- career-ops-agents:end -->';
const TRIGGER = 'INTERVIEW: run student/interview/interview.md before anything else';
const UNMARKED = 'AGENTS.override.md has no student-pack markers; left as is, so Codex will not see the pack rules';
const DAMAGED = 'AGENTS.override.md has damaged student-pack markers; delete it and run node student/install.mjs';
const UPSTREAM_V1 = '# Upstream rules v1\n\nKeep the tracker tidy.\n';
const UPSTREAM_V2 = '# Upstream rules v2\n\nKeep the tracker tidy and the notes short.\n';

const OVERRIDE = (root) => join(root, 'AGENTS.override.md');
const readOverride = (root) => readFileSync(OVERRIDE(root), 'utf8');
const lines = (text) => text.split(/\r?\n/);

// Text between a start and end marker (markers excluded), or null when the pair is missing.
function between(text, start, end) {
  const a = text.indexOf(start);
  const b = text.indexOf(end);
  if (a === -1 || b === -1 || b < a) return null;
  return text.slice(a + start.length, b);
}

async function withPack(opts, fn) {
  const p = makePack(opts);
  try {
    await fn(p);
  } finally {
    p.cleanup();
  }
}

const install = (p) => p.run('install.mjs', ['--yes', '--skip-npm']);

// M-001-S1
test('M-001-S1 install writes the pack block at byte 0 and the career-ops block equal to AGENTS.md', () =>
  withPack({ agentsMd: UPSTREAM_V1 }, (p) => {
    const r = install(p);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const text = readOverride(p.root);
    assert.ok(text.startsWith(P_START), 'pack block does not start at byte 0');
    assert.equal(text.indexOf(P_START), text.lastIndexOf(P_START));
    assert.ok(text.indexOf(P_END) < text.indexOf(U_START), 'career-ops block must follow the pack block');
    assert.equal(between(text, U_START, U_END), UPSTREAM_V1);
    const pack = between(text, P_START, P_END);
    assert.ok(pack.includes(readFileSync(join(p.pack, 'AGENTS.student.md'), 'utf8')), 'pack block lacks AGENTS.student.md');
    assert.ok(r.lines.some((l) => l.includes('AGENTS.override.md: wrote the pack block and the career-ops AGENTS.md copy')), r.stdout);
  }));

// M-001-S2
test('M-001-S2 install lists AGENTS.override.md and .codex/config.toml in local-paths and exclude', () =>
  withPack({}, (p) => {
    const r = install(p);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const paths = lines(readFileSync(join(p.root, 'config', 'local-paths.txt'), 'utf8'));
    const exclude = lines(readFileSync(join(p.root, '.git', 'info', 'exclude'), 'utf8'));
    for (const entry of ['AGENTS.override.md', '.codex/config.toml']) {
      assert.ok(paths.includes(entry), `local-paths.txt lacks ${entry}`);
      assert.ok(exclude.includes(entry), `exclude lacks ${entry}`);
    }
  }));

// M-001-S3
test('M-001-S3 a second install leaves AGENTS.override.md byte-identical and reports no override action', () =>
  withPack({}, (p) => {
    assert.equal(install(p).code, 0);
    const before = readFileSync(OVERRIDE(p.root));
    const second = install(p);
    assert.equal(second.code, 0, second.stdout + second.stderr);
    assert.ok(readFileSync(OVERRIDE(p.root)).equals(before), 'override changed on the second run');
    assert.deepEqual(second.lines.filter((l) => l.includes('AGENTS.override.md')), [], second.stdout);
  }));

// M-001-S4
test('M-001-S4 the pack block built from the shipped AGENTS.student.md is under 8192 bytes', () => {
  assert.equal(PACK_BLOCK_LIMIT, 8192);
  const block = packBlock(readFileSync(join(PACK_ROOT, 'AGENTS.student.md'), 'utf8'));
  assert.ok(block.startsWith(P_START));
  assert.ok(block.endsWith(P_END));
  assert.ok(Buffer.byteLength(block, 'utf8') < PACK_BLOCK_LIMIT, `pack block is ${Buffer.byteLength(block, 'utf8')} bytes`);
});

// M-001-S5
test('M-001-S5 a checkout with no AGENTS.md gets the pack block and an empty career-ops block', () =>
  withPack({ agentsMd: null }, (p) => {
    assert.equal(existsSync(join(p.root, 'AGENTS.md')), false);
    const r = install(p);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const text = readOverride(p.root);
    assert.ok(text.startsWith(P_START));
    assert.equal(between(text, U_START, U_END), '');
    assert.ok(text.includes(U_END));
  }));

// M-001-S5
test('M-001-S5 buildOverride with an empty existing text reports created', () => {
  const { text, status } = buildOverride({ packText: 'Pack rules.\n', upstreamText: '', existing: '' });
  assert.equal(status, 'created');
  assert.ok(text.startsWith(P_START));
  assert.equal(between(text, U_START, U_END), '');
  assert.ok(text.indexOf(P_END) < text.indexOf(U_START));
});

// M-001-S6
test('M-001-S6 an override without pack markers stays byte-identical and install prints one line naming it', () =>
  withPack({}, (p) => {
    const own = Buffer.from('My own rules, written by hand.\r\nNo markers here.\r\n');
    writeFileSync(OVERRIDE(p.root), own);
    const r = install(p);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.ok(readFileSync(OVERRIDE(p.root)).equals(own), 'unmarked override was modified');
    const named = r.lines.filter((l) => l.includes('AGENTS.override.md'));
    assert.equal(named.length, 1, r.stdout);
    assert.ok(named[0].includes('no student-pack markers'), named[0]);
  }));

// M-001-S6
test('M-001-S6 buildOverride on unmarked text reports unmarked and returns the text unchanged', () => {
  const existing = 'Hand written rules.\n';
  const out = buildOverride({ packText: 'Pack.\n', upstreamText: UPSTREAM_V1, existing });
  assert.equal(out.status, 'unmarked');
  assert.equal(out.text, existing);
});

// M-001-S7
test('M-001-S7 session start rewrites the career-ops block after AGENTS.md changes and keeps outside text', () =>
  withPack({ agentsMd: UPSTREAM_V1 }, (p) => {
    p.up.setOutput('update-system', '{"status":"up-to-date","local":"1.38.0","remote":"1.38.0"}\n');
    assert.equal(install(p).code, 0);
    const created = readOverride(p.root);
    const between1 = '\n\nNOTE between the blocks.\n';
    const tail = '\n\nMy trailing note.\n';
    const edited = created.replace(P_END, `${P_END}${between1}`).replace(/\s*$/, '') + tail;
    writeFileSync(OVERRIDE(p.root), edited);
    writeFileSync(join(p.root, 'AGENTS.md'), UPSTREAM_V2);
    const r = p.run('scripts/session-start.mjs');
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const after = readOverride(p.root);
    assert.equal(between(after, U_START, U_END), UPSTREAM_V2);
    assert.ok(!after.includes('Upstream rules v1'), 'old upstream text remains');
    assert.ok(after.includes('NOTE between the blocks.'));
    assert.ok(after.includes('My trailing note.'));
    assert.ok(after.startsWith(P_START));
    assert.equal(r.lines.at(-1), TRIGGER);
    assert.ok(r.lines.length <= 6, r.stdout);
  }));

// M-001-S8
test('M-001-S8 session start with nothing changed does not write AGENTS.override.md', () =>
  withPack({}, (p) => {
    p.up.setOutput('update-system', '{"status":"up-to-date","local":"1.38.0","remote":"1.38.0"}\n');
    assert.equal(install(p).code, 0);
    const old = new Date(Date.now() - 3600 * 1000);
    utimesSync(OVERRIDE(p.root), old, old);
    const bytes = readFileSync(OVERRIDE(p.root));
    const mtime = statSync(OVERRIDE(p.root)).mtimeMs;
    const r = p.run('scripts/session-start.mjs');
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.ok(readFileSync(OVERRIDE(p.root)).equals(bytes));
    assert.equal(statSync(OVERRIDE(p.root)).mtimeMs, mtime, 'the file was rewritten');
    assert.deepEqual(r.lines.filter((l) => l.includes('AGENTS.override.md')), [], r.stdout);
  }));

// M-001-S9
test('M-001-S9 update.mjs refreshes the career-ops block after the upstream step changes AGENTS.md', () =>
  withPack({ agentsMd: UPSTREAM_V1 }, async (p) => {
    assert.equal(install(p).code, 0);
    assert.equal(between(readOverride(p.root), U_START, U_END), UPSTREAM_V1);
    const upstream = {
      updateCheck: () => ({ status: 'update-available', local: '1.38.0', remote: '1.38.0' }),
      updateApply: () => writeFileSync(join(p.root, 'AGENTS.md'), UPSTREAM_V2),
      updateDismiss: () => {},
      pluginsTrust: () => {},
    };
    const res2 = await runUpdate({ root: p.root, packRoot: p.pack, upstream, schedule: { platform: 'linux' } });
    assert.equal(res2.code, 0, res2.lines.join('\n'));
    assert.equal(between(readOverride(p.root), U_START, U_END), UPSTREAM_V2);
    assert.ok(readOverride(p.root).startsWith(P_START));
    assert.ok(res2.lines.includes('AGENTS.override.md: refreshed'), res2.lines.join('\n'));
  }));

// M-001-S13
test('M-001-S13 install still writes the CLAUDE.local.md import block and names both agents', () =>
  withPack({}, (p) => {
    const r = install(p);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(readFileSync(join(p.root, 'CLAUDE.local.md'), 'utf8'), /<!-- student-pack:start -->\s*@student\/AGENTS\.student\.md\s*<!-- student-pack:end -->/);
    assert.ok(r.stdout.includes('Claude Code'), r.stdout);
    assert.ok(r.stdout.includes('Codex'), r.stdout);
  }));

// M-001-S14
test('M-001-S14 a missing career-ops block is inserted right after the pack block', () => {
  const first = buildOverride({ packText: 'Pack rules.\n', upstreamText: UPSTREAM_V1, existing: '' }).text;
  const packOnly = `${first.slice(0, first.indexOf(P_END) + P_END.length)}\n\nMy note after the pack.\n`;
  const out = buildOverride({ packText: 'Pack rules.\n', upstreamText: UPSTREAM_V1, existing: packOnly });
  assert.equal(out.status, 'updated');
  assert.ok(out.text.startsWith(P_START));
  assert.match(out.text, /<!-- student-pack:end -->\s*<!-- career-ops-agents:start -->/);
  assert.equal(between(out.text, U_START, U_END), UPSTREAM_V1);
  assert.ok(out.text.includes('My note after the pack.'));
  assert.ok(out.text.indexOf(U_END) < out.text.indexOf('My note after the pack.'));
});

// M-001-S14
test('M-001-S14 session start inserts the missing career-ops block into a pack-only override', () =>
  withPack({ agentsMd: UPSTREAM_V1 }, (p) => {
    p.up.setOutput('update-system', '{"status":"up-to-date","local":"1.38.0","remote":"1.38.0"}\n');
    assert.equal(install(p).code, 0);
    const full = readOverride(p.root);
    writeFileSync(OVERRIDE(p.root), `${full.slice(0, full.indexOf(P_END) + P_END.length)}\n`);
    const r = p.run('scripts/session-start.mjs');
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const after = readOverride(p.root);
    assert.match(after, /<!-- student-pack:end -->\s*<!-- career-ops-agents:start -->/);
    assert.equal(between(after, U_START, U_END), UPSTREAM_V1);
  }));

// M-001-S15
test('M-001-S15 text before the pack block moves after the career-ops block', () => {
  const built = buildOverride({ packText: 'Pack rules.\n', upstreamText: UPSTREAM_V1, existing: '' }).text;
  const existing = `Leading note from the student.\n\n${built}`;
  const out = buildOverride({ packText: 'Pack rules.\n', upstreamText: UPSTREAM_V1, existing });
  assert.equal(out.status, 'updated');
  assert.ok(out.text.startsWith(P_START), 'pack block must start at byte 0');
  const note = out.text.indexOf('Leading note from the student.');
  assert.ok(note > out.text.indexOf(U_END), 'leading text must follow the career-ops block');
  assert.equal(out.text.indexOf('Leading note from the student.'), out.text.lastIndexOf('Leading note from the student.'));
  const again = buildOverride({ packText: 'Pack rules.\n', upstreamText: UPSTREAM_V1, existing: out.text });
  assert.equal(again.status, 'unchanged');
  assert.equal(again.text, out.text);
});

// M-001-S15
test('M-001-S15 session start moves leading text of the override file after the career-ops block', () =>
  withPack({ agentsMd: UPSTREAM_V1 }, (p) => {
    p.up.setOutput('update-system', '{"status":"up-to-date","local":"1.38.0","remote":"1.38.0"}\n');
    assert.equal(install(p).code, 0);
    writeFileSync(OVERRIDE(p.root), `Student line above.\n\n${readOverride(p.root)}`);
    const r = p.run('scripts/session-start.mjs');
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const after = readOverride(p.root);
    assert.ok(after.startsWith(P_START));
    assert.ok(after.indexOf('Student line above.') > after.indexOf(U_END));
  }));

const PAIR = (s, e, body = 'x') => `${s}${body}${e}`;
const DAMAGED_CASES = {
  'duplicated pack pair': `${PAIR(P_START, P_END)}\n\n${PAIR(P_START, P_END)}\n\n${PAIR(U_START, U_END)}\n`,
  'reversed pack markers': `${P_END}\nx\n${P_START}\n\n${PAIR(U_START, U_END)}\n`,
  'unpaired pack start': `${P_START}\nx\n\n${PAIR(U_START, U_END)}\n`,
  'unpaired pack end': `x\n${P_END}\n\n${PAIR(U_START, U_END)}\n`,
  'duplicated career-ops pair': `${PAIR(P_START, P_END)}\n\n${PAIR(U_START, U_END)}\n${PAIR(U_START, U_END)}\n`,
  'reversed career-ops markers': `${PAIR(P_START, P_END)}\n\n${U_END}\nx\n${U_START}\n`,
  'unpaired career-ops start': `${PAIR(P_START, P_END)}\n\n${U_START}\nx\n`,
  'career-ops block inside pack block': `${P_START}\nx\n${PAIR(U_START, U_END)}\ny\n${P_END}\n`,
  'career-ops block before pack block': `${PAIR(U_START, U_END)}\n\n${PAIR(P_START, P_END)}\n`,
  'pack block inside career-ops block': `${U_START}\nx\n${PAIR(P_START, P_END)}\ny\n${U_END}\n`,
};

// M-001-S16, W-023-A5-6
for (const [name, existing] of Object.entries(DAMAGED_CASES)) {
  test(`M-001-S16 buildOverride reports damaged and keeps the text for ${name}`, () => {
    const out = buildOverride({ packText: 'Pack.\n', upstreamText: UPSTREAM_V1, existing });
    assert.equal(out.status, 'damaged');
    assert.equal(out.text, existing);
  });
}

// M-001-S16
test('M-001-S16 refreshOverride leaves a damaged file byte-identical and returns the damaged line', () => {
  const root = mkdtempSync(join(tmpdir(), 'ao-root-'));
  const packRoot = mkdtempSync(join(tmpdir(), 'ao-pack-'));
  try {
    writeFileSync(join(root, 'AGENTS.md'), UPSTREAM_V1);
    writeFileSync(join(packRoot, 'AGENTS.student.md'), 'Pack rules.\n');
    const damaged = Buffer.from(DAMAGED_CASES['duplicated pack pair']);
    writeFileSync(OVERRIDE(root), damaged);
    const res = refreshOverride({ root, packRoot });
    assert.equal(res.status, 'damaged');
    assert.equal(res.line, DAMAGED);
    assert.ok(readFileSync(OVERRIDE(root)).equals(damaged));
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(packRoot, { recursive: true, force: true });
  }
});

// M-001-S16
test('M-001-S16 session start prints one damaged-markers line naming node student/install.mjs and keeps the file', () =>
  withPack({}, (p) => {
    p.up.setOutput('update-system', '{"status":"up-to-date","local":"1.38.0","remote":"1.38.0"}\n');
    const damaged = Buffer.from(DAMAGED_CASES['reversed pack markers']);
    writeFileSync(OVERRIDE(p.root), damaged);
    const r = p.run('scripts/session-start.mjs');
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.ok(readFileSync(OVERRIDE(p.root)).equals(damaged));
    const named = r.lines.filter((l) => l.includes('AGENTS.override.md'));
    assert.equal(named.length, 1, r.stdout);
    assert.match(named[0], /damaged/);
    assert.ok(named[0].includes('node student/install.mjs'), named[0]);
    assert.equal(r.lines.at(-1), TRIGGER);
  }));

// M-001-S6
test('M-001-S6 refreshOverride returns the unmarked line and does not write', () => {
  const root = mkdtempSync(join(tmpdir(), 'ao-root-'));
  const packRoot = mkdtempSync(join(tmpdir(), 'ao-pack-'));
  try {
    writeFileSync(join(root, 'AGENTS.md'), UPSTREAM_V1);
    writeFileSync(join(packRoot, 'AGENTS.student.md'), 'Pack rules.\n');
    writeFileSync(OVERRIDE(root), 'Hand written.\n');
    let writes = 0;
    const res = refreshOverride({ root, packRoot, write: () => { writes += 1; } });
    assert.equal(res.status, 'unmarked');
    assert.equal(res.line, UNMARKED);
    assert.equal(writes, 0);
    assert.equal(readFileSync(OVERRIDE(root), 'utf8'), 'Hand written.\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(packRoot, { recursive: true, force: true });
  }
});

// M-001-S1
test('M-001-S1 refreshOverride creates the file with an empty line, and dryRun writes nothing', () => {
  const root = mkdtempSync(join(tmpdir(), 'ao-root-'));
  const packRoot = mkdtempSync(join(tmpdir(), 'ao-pack-'));
  try {
    mkdirSync(root, { recursive: true });
    put(root, 'AGENTS.md', UPSTREAM_V1);
    put(packRoot, 'AGENTS.student.md', 'Pack rules.\n');
    const dry = refreshOverride({ root, packRoot, dryRun: true });
    assert.equal(dry.status, 'created');
    assert.equal(dry.line, '');
    assert.equal(existsSync(OVERRIDE(root)), false, 'dryRun wrote the file');
    const res = refreshOverride({ root, packRoot });
    assert.equal(res.status, 'created');
    assert.equal(res.line, '');
    assert.equal(between(readOverride(root), U_START, U_END), UPSTREAM_V1);
    assert.equal(refreshOverride({ root, packRoot }).status, 'unchanged');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(packRoot, { recursive: true, force: true });
  }
});

// W-023-A2-4
test('W-023-A2-4 the generated header points students at text outside the markers, not at a tracked pack file', () => {
  const out = buildOverride({ packText: 'Pack rules.\n', upstreamText: UPSTREAM_V1 });
  assert.doesNotMatch(out.text, /Edit student\/AGENTS\.student\.md/);
  assert.match(out.text, /outside the markers/);
  const kept = buildOverride({ packText: 'Pack rules.\n', upstreamText: UPSTREAM_V1, existing: `${out.text}\nMy note.\n` });
  assert.ok(kept.text.includes('My note.'), 'text outside the markers survives a refresh');
});
