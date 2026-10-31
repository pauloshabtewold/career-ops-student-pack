// Assumed: sessionStart({ root, packRoot, update, refresh }) in scripts/session-start.mjs prints at most six lines with
// the INTERVIEW (or switch) line last. An unreachable pack remote or a throwing update step yields exactly one
// 'update check skipped (offline)' line; update.mjs passes { timeout: 20000, env: { GIT_TERMINAL_PROMPT: '0' } }
// to the runner for its pack fetch; a throwing AGENTS.override.md write yields
// 'AGENTS.override.md not refreshed (<reason>)'. Nothing here throws out of sessionStart or changes the exit code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { refreshOverride } from '../../lib/agents-override.mjs';
import { defaultRunner } from '../../lib/upstream.mjs';
import { sessionStart } from '../../scripts/session-start.mjs';
import { runUpdate } from '../../update.mjs';
import { makePack, checkJson, put } from './_pack-repo.mjs';

const TRIGGER = 'INTERVIEW: run student/interview/interview.md before anything else';
const OFFLINE = 'update check skipped (offline)';
const SCRIPT = 'scripts/session-start.mjs';

async function withPack(fn) {
  const p = makePack();
  p.up.setOutput('update-system', checkJson('up-to-date', { remote: '1.38.0' }));
  try {
    await fn(p);
  } finally {
    p.cleanup();
  }
}

const count = (lines, text) => lines.filter((l) => l === text).length;
const quiet = () => ({ status: 'unchanged', line: '' });

// M-001-S10
test('M-001-S10 an unreachable pack remote prints one offline line, keeps the last line and exits 0', () =>
  withPack((p) => {
    p.git('remote', 'set-url', 'origin', join(tmpdir(), 'student-pack-no-such-origin'));
    const r = p.run(SCRIPT);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(count(r.lines, OFFLINE), 1, r.lines.join('\n'));
    assert.ok(!r.lines.some((l) => /could not reach/i.test(l)), r.lines.join('\n'));
    assert.ok(r.lines.length <= 6, r.lines.join('\n'));
    assert.equal(r.lines.at(-1), TRIGGER);
  }));

// M-001-S10
test('M-001-S10 several unreachable-remote lines from the update step collapse into one', async () =>
  withPack(async (p) => {
    const update = async () => ({ lines: ['pack: could not reach the pack remote; using tags already fetched', OFFLINE, OFFLINE], code: 0 });
    const out = await sessionStart({ root: p.root, packRoot: p.pack, update, refresh: quiet });
    assert.equal(count(out, OFFLINE), 1, out.join('\n'));
    assert.ok(out.length <= 6, out.join('\n'));
    assert.equal(out.at(-1), TRIGGER);
  }));

// M-001-S11
test('M-001-S11 an update step that throws a network failure prints one offline line and still resolves', async () =>
  withPack(async (p) => {
    const update = async () => {
      throw Object.assign(new Error('fatal: unable to access the pack remote'), { code: 'ETIMEDOUT' });
    };
    const out = await sessionStart({ root: p.root, packRoot: p.pack, update, refresh: quiet });
    assert.equal(count(out, OFFLINE), 1, out.join('\n'));
    assert.ok(!out.some((l) => /update check failed/i.test(l)), out.join('\n'));
    assert.ok(out.length <= 6, out.join('\n'));
    assert.equal(out.at(-1), TRIGGER);
  }));

// W-023-A2-9
test('W-023-A2-9 an update step that throws something other than a network failure prints the reason, not offline', async () =>
  withPack(async (p) => {
    const update = async () => {
      throw new Error('bad indentation in config/plugins.yml');
    };
    const out = await sessionStart({ root: p.root, packRoot: p.pack, update, refresh: quiet });
    assert.equal(count(out, OFFLINE), 0, out.join('\n'));
    assert.equal(out.filter((l) => l === 'pack update failed: bad indentation in config/plugins.yml').length, 1, out.join('\n'));
    assert.ok(out.length <= 6, out.join('\n'));
    assert.equal(out.at(-1), TRIGGER);
  }));

// W-023-A2-9
test('W-023-A2-9 a malformed config/plugins.yml reads as a failed update, not offline', () =>
  withPack((p) => {
    put(p.root, 'config/plugins.yml', 'plugins:\n  github-lists: [unclosed\n');
    const r = p.run(SCRIPT);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(count(r.lines, OFFLINE), 0, r.lines.join('\n'));
    assert.ok(r.lines.some((l) => l.startsWith('pack update failed: ')), r.lines.join('\n'));
    assert.equal(r.lines.at(-1), TRIGGER);
  }));

// M-001-S12
test('M-001-S12 the pack fetch gets a 20000 ms timeout and GIT_TERMINAL_PROMPT=0 and its failure reads offline', async () =>
  withPack(async (p) => {
    const calls = [];
    const runner = (cmd, args, opts = {}) => {
      calls.push({ cmd, args, opts });
      if (cmd === 'git' && args.includes('fetch')) throw new Error('fatal: unable to access remote');
      return defaultRunner(cmd, args, opts);
    };
    const res = await runUpdate({ root: p.root, packRoot: p.pack, safetyOnly: true, runner });
    const fetches = calls.filter((c) => c.cmd === 'git' && c.args.includes('fetch'));
    assert.equal(fetches.length, 1, JSON.stringify(calls.map((c) => c.args)));
    assert.equal(fetches[0].opts.timeout, 20000);
    assert.equal(fetches[0].opts.env.GIT_TERMINAL_PROMPT, '0');
    assert.equal(count(res.lines, OFFLINE), 1, res.lines.join('\n'));
    assert.equal(res.code, 0);
  }));

// M-001-S17
test('M-001-S17 a refresh whose write throws EACCES prints a not-refreshed line and keeps the last line', async () =>
  withPack(async (p) => {
    const refresh = (args) =>
      refreshOverride({
        ...args,
        write: () => {
          throw Object.assign(new Error('EACCES: permission denied, open AGENTS.override.md'), { code: 'EACCES' });
        },
      });
    const out = await sessionStart({ root: p.root, packRoot: p.pack, refresh });
    const hit = out.filter((l) => l.startsWith('AGENTS.override.md not refreshed ('));
    assert.equal(hit.length, 1, out.join('\n'));
    assert.match(hit[0], /^AGENTS\.override\.md not refreshed \(.+\)$/);
    assert.ok(hit[0].includes('EACCES'), hit[0]);
    assert.ok(!hit[0].includes('\n'));
    assert.ok(out.length <= 6, out.join('\n'));
    assert.equal(out.at(-1), TRIGGER);
  }));

// M-001-S17
test('M-001-S17 a refresh that returns an empty line adds nothing to the session output', async () =>
  withPack(async (p) => {
    const out = await sessionStart({ root: p.root, packRoot: p.pack, refresh: quiet });
    assert.ok(!out.some((l) => l.includes('AGENTS.override.md')), out.join('\n'));
    assert.equal(out.at(-1), TRIGGER);
  }));
