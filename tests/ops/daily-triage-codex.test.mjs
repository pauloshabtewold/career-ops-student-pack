// Assumed: dailyTriage({ root, dataDir, packRoot, today, runner, agent, agentPath, claude, platform, say }) reads agent from
// config/student.yml (absent = claude). With agent codex it makes one runner(program, args, opts) call; the prompt travels
// in opts.input, the answer comes back in the -o file inside a temp folder that is also -C and opts.cwd. Failures write
// one digest line, leave pipeline.md unchanged and resolve normally. The runner is injected; no real codex starts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { dailyTriage } from '../../scripts/daily-triage.mjs';
import { which } from '../../lib/which.mjs';
import { rowsOf } from '../helpers/script-harness.mjs';
import { PLUS, args, digestFile, flagValue, jobUrl, makeRunner, makeTriageRoot, sentUrls, unquote, untriaged, verdict, BRIEF_MARKER } from '../helpers/triage-harness.mjs';

const CODEX = '/opt/sample/bin/codex';
const CODEX_CFG = `${PLUS}agent: codex\n`;
const FEATURES = ['apps', 'plugins', 'browser_use', 'in_app_browser', 'computer_use', 'shell_tool', 'hooks', 'image_generation', 'goals', 'view_image'];
const codexArgs = (r, extra = {}) => args(r, { agent: 'codex', agentPath: CODEX, claude: null, ...extra });
const withRoot = async (opts, fn) => {
  const r = makeTriageRoot({ config: CODEX_CFG, ...opts });
  try {
    await fn(r);
  } finally {
    r.cleanup();
  }
};
const answer = (text) => (argv, opts, out) => (writeFileSync(out, text), '');
const failing = (props) => () => {
  throw Object.assign(new Error('Command failed: codex exec'), props);
};
const pairs = (argv, flag) => argv.flatMap((a, i) => (a === flag ? [argv[i + 1]] : []));
const digestLines = (r, re) => r.read(digestFile(r)).split('\n').filter((l) => re.test(l));

// Isolated PATH and home so the real machine's codex (PATH or ChatGPT.app) is never found.
async function isolated(fn, { withCodex = false } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'triage-codex-env-'));
  const bin = join(tmp, 'bin');
  const home = join(tmp, 'home');
  mkdirSync(bin);
  mkdirSync(home);
  if (withCodex) {
    writeFileSync(join(bin, 'codex'), '#!/usr/bin/env node\nprocess.exit(0);\n');
    chmodSync(join(bin, 'codex'), 0o755);
    writeFileSync(join(bin, 'codex.cmd'), '@echo off\r\nexit /b 0\r\n');
  }
  const saved = { PATH: process.env.PATH, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  Object.assign(process.env, { PATH: bin, HOME: home, USERPROFILE: home });
  try {
    await fn({ bin, home });
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(tmp, { recursive: true, force: true });
  }
}

// legacy-M-002-S4
// M-002-S2
test('legacy-M-002-S4 M-002-S2 agent codex makes one call: argv shape, prompt on stdin, verdicts from the -o file applied', () =>
  withRoot({ pending: untriaged(3) }, async (r) => {
    const out = ['Here is my review.', verdict('PASS', jobUrl(1), '4.2'), verdict('FAIL', jobUrl(2), '1.0', 'wrong field')].join('\n');
    const { runner, calls } = makeRunner(r, { codex: answer(out) });
    await dailyTriage({ ...codexArgs(r), runner });
    assert.equal(calls.claude.length, 0);
    assert.equal(calls.codex.length, 1);
    const call = calls.codex[0];
    assert.equal(call.cmd, CODEX);
    assert.deepEqual(call.args.slice(0, 3), ['-a', 'never', 'exec']);
    for (const flag of ['--ephemeral', '--skip-git-repo-check']) assert.ok(call.args.includes(flag), flag);
    assert.equal(call.args[call.args.indexOf('-s') + 1], 'read-only');
    for (const f of FEATURES) assert.ok(pairs(call.args, '--disable').includes(f), `--disable ${f}`);
    assert.ok(call.tmp && call.out, '-C and -o are present');
    assert.equal(call.out, join(call.tmp, 'last.txt'));
    assert.equal(call.args.at(-1), '-');
    assert.equal(call.args.includes('--setting-sources'), false);
    assert.equal(call.args.includes('--strict-mcp-config'), false);
    assert.equal(call.opts.input.includes(BRIEF_MARKER), true, 'prompt on stdin');
    assert.deepEqual([...sentUrls(call.opts.input)].sort(), [jobUrl(1), jobUrl(2), jobUrl(3)]);
    assert.equal(call.args.join(' ').includes('https://example.com/jobs'), false, 'no posting text or url in argv');
    assert.equal(call.opts.timeout, 15 * 60 * 1000);
    assert.notEqual(call.opts.shell, true);
    const pipeline = r.read('data/pipeline.md');
    assert.equal(rowsOf(pipeline, 'Pending').find((x) => x.url === jobUrl(1)).notes.get('triage'), '4.2');
    assert.deepEqual(rowsOf(pipeline, 'Skipped').map((x) => x.url), [jobUrl(2)]);
    assert.equal(rowsOf(pipeline, 'Pending').find((x) => x.url === jobUrl(3)).notes.has('triage'), false);
  }));

// legacy-M-002-S5
test('legacy-M-002-S5 with 25 untriaged rows and triage_daily 5 only 5 reach the codex prompt', () =>
  withRoot({ config: `${CODEX_CFG}limits:\n  triage_daily: 5\n`, pending: untriaged(25) }, async (r) => {
    const { runner, calls } = makeRunner(r);
    await dailyTriage({ ...codexArgs(r), runner });
    assert.equal(calls.codex.length, 1);
    assert.equal(sentUrls(calls.codex[0].opts.input).size, 5);
    assert.equal(calls.fetch.length, 5);
  }));

// legacy-M-002-S6
test('legacy-M-002-S6 codex exiting 1 leaves pipeline.md unchanged and writes one digest line with the first stderr line and the sign-in step', () =>
  withRoot({ pending: untriaged(2) }, async (r) => {
    const before = r.read('data/pipeline.md');
    const { runner } = makeRunner(r, { codex: failing({ status: 1, stderr: 'Authentication required\nsecond line' }) });
    await dailyTriage({ ...codexArgs(r), runner });
    assert.equal(r.read('data/pipeline.md'), before);
    const lines = digestLines(r, /Authentication required/);
    assert.equal(lines.length, 1, r.read(digestFile(r)));
    assert.match(lines[0], /codex/);
    assert.match(lines[0], /run codex once in a terminal to sign in/);
    assert.doesNotMatch(r.read(digestFile(r)), /second line/);
  }));

// legacy-M-002-S7
test('legacy-M-002-S7 codex exiting 0 without an -o file, or with an empty one, writes "codex wrote no answer" and leaves pipeline.md unchanged', () =>
  withRoot({ pending: untriaged(2) }, async (r) => {
    const before = r.read('data/pipeline.md');
    for (const codex of [() => '', answer('')]) {
      const { runner } = makeRunner(r, { codex });
      await dailyTriage({ ...codexArgs(r), runner });
      assert.equal(r.read('data/pipeline.md'), before);
      assert.match(r.read(digestFile(r)), /codex wrote no answer/);
      rmSync(r.file(digestFile(r)), { force: true });
    }
  }));

// legacy-M-002-S8
test('legacy-M-002-S8 no codex binary found writes one digest line naming codex and schedule.mjs install and makes no agent call', () =>
  isolated(async () => {
      const r = makeTriageRoot({ config: CODEX_CFG, pending: untriaged(2) });
      try {
        const before = r.read('data/pipeline.md');
        const { runner, calls } = makeRunner(r);
        await dailyTriage({ ...args(r), claude: null, platform: 'linux', runner });
        assert.equal(calls.codex.length + calls.claude.length + calls.fetch.length + calls.other.length, 0);
        assert.equal(r.read('data/pipeline.md'), before);
        const lines = digestLines(r, /codex/);
        assert.equal(lines.length, 1, r.read(digestFile(r)));
        assert.match(lines[0], /codex was not found/);
        assert.match(lines[0], /schedule\.mjs install/);
      } finally {
        r.cleanup();
      }
    }));

// legacy-M-002-S9
test('legacy-M-002-S9 win32 with a codex.cmd path runs with shell true, quoted program, -C and -o, and no posting text in argv', () =>
  withRoot({ pending: untriaged(2) }, async (r) => {
    const winCodex = 'C:\\Users\\Sample Student\\AppData\\Roaming\\npm\\codex.cmd';
    const { runner, calls } = makeRunner(r, { codex: answer(verdict('PASS', jobUrl(1), '4.2')) });
    await dailyTriage({ ...codexArgs(r, { agentPath: winCodex }), platform: 'win32', runner });
    assert.equal(calls.codex.length, 1);
    const call = calls.codex[0];
    assert.equal(call.cmd, `"${winCodex}"`);
    assert.equal(call.opts.shell, true);
    const rawC = call.args[call.args.indexOf('-C') + 1];
    const rawO = call.args[call.args.indexOf('-o') + 1];
    assert.equal(rawC, `"${unquote(rawC)}"`);
    assert.equal(rawO, `"${unquote(rawO)}"`);
    assert.equal(unquote(rawO), join(unquote(rawC), 'last.txt'));
    assert.equal(call.args.at(-1), '-');
    assert.equal(call.args.join(' ').includes('Posting text for'), false);
    assert.equal(call.args.join(' ').includes('example.com'), false);
    assert.ok(call.opts.input.includes(jobUrl(1)), 'prompt still on stdin');
    assert.equal(rowsOf(r.read('data/pipeline.md'), 'Pending').find((x) => x.url === jobUrl(1)).notes.get('triage'), '4.2');
  }));

// legacy-M-002-S10
test('legacy-M-002-S10 spend_tier standard passes model_reasoning_effort=medium, premium passes high, and -m is never passed', async () => {
  for (const [tier, effort] of [['standard', 'medium'], ['premium', 'high']]) {
    await withRoot({ config: `${CODEX_CFG}spend_tier: ${tier}\n`, pending: untriaged(2) }, async (r) => {
      const { runner, calls } = makeRunner(r);
      await dailyTriage({ ...codexArgs(r), runner });
      const a = calls.codex[0].args;
      assert.deepEqual(pairs(a, '-c').filter((v) => v.startsWith('model_reasoning_effort')), [`model_reasoning_effort=${effort}`], tier);
      assert.equal(a.includes('-m'), false);
      assert.equal(a.includes('--model'), false);
    });
  }
});

// legacy-M-002-S15
test('legacy-M-002-S15 a legacy claude path with no agent runs claude at that path with -p --tools "" --model', () =>
  withRoot({ config: PLUS, pending: untriaged(2) }, async (r) => {
    const { runner, calls } = makeRunner(r, { claude: () => verdict('PASS', jobUrl(1), '4.2') });
    await dailyTriage({ ...args(r), runner });
    assert.equal(calls.codex.length, 0);
    assert.equal(calls.claude.length, 1);
    assert.equal(calls.claude[0].cmd, '/opt/sample/bin/claude');
    const a = calls.claude[0].args;
    assert.ok(a.includes('-p'));
    assert.equal(a[a.indexOf('--tools') + 1], '');
    assert.match(a[a.indexOf('--model') + 1], /^(sonnet|opus)$/);
  }));

// legacy-M-002-S16
test('legacy-M-002-S16 --agent claude with config agent codex ignores --agent-path, resolves codex and adds the run-install-again hint', () =>
  isolated(
    async () => {
      const r = makeTriageRoot({ config: CODEX_CFG, pending: untriaged(2) });
      try {
        const expected = which('codex', { env: process.env, platform: process.platform });
        assert.ok(expected, 'fake codex is on the isolated PATH');
        const { runner, calls } = makeRunner(r);
        await dailyTriage({ ...args(r), agent: 'claude', agentPath: '/opt/sample/bin/claude', claude: null, runner });
        assert.equal(calls.claude.length, 0);
        assert.equal(calls.codex.length, 1);
        assert.equal(unquote(calls.codex[0].cmd), expected);
        assert.match(r.read(digestFile(r)), /agent changed to codex since the schedule was installed; run node student\/scripts\/schedule\.mjs install again/);
      } finally {
        r.cleanup();
      }
    },
    { withCodex: true },
  ));

// legacy-M-002-S17
test('legacy-M-002-S17 the -o temp folder is gone after a successful call and after each failed one', async () => {
  const cases = {
    success: answer(verdict('PASS', jobUrl(1), '4.2')),
    exit1: failing({ status: 1, stderr: 'Authentication required' }),
    exit2: failing({ status: 2, stderr: 'Error: Unknown feature flag: shell_tool' }),
    timeout: failing({ code: 'ETIMEDOUT' }),
    noAnswer: () => '',
  };
  for (const [name, codex] of Object.entries(cases)) {
    await withRoot({ pending: untriaged(2) }, async (r) => {
      const { runner, calls } = makeRunner(r, { codex });
      await dailyTriage({ ...codexArgs(r), runner });
      assert.equal(calls.codex.length, 1, name);
      assert.equal(calls.codex[0].tmpExistedDuringCall, true, `${name}: folder exists during the call`);
      assert.equal(existsSync(calls.codex[0].tmp), false, `${name}: folder removed`);
    });
  }
});

// legacy-M-002-S19
test('legacy-M-002-S19 codex exiting 2 reports its first stderr line and "update codex or the pack" without the sign-in hint', () =>
  withRoot({ pending: untriaged(2) }, async (r) => {
    const before = r.read('data/pipeline.md');
    const { runner } = makeRunner(r, { codex: failing({ status: 2, stderr: 'Error: Unknown feature flag: shell_tool\nusage: codex exec' }) });
    await dailyTriage({ ...codexArgs(r), runner });
    assert.equal(r.read('data/pipeline.md'), before);
    const digest = r.read(digestFile(r));
    assert.match(digest, /Error: Unknown feature flag: shell_tool/);
    assert.match(digest, /update codex or the pack/);
    assert.doesNotMatch(digest, /sign in/i);
    assert.doesNotMatch(digest, /usage: codex exec/);
  }));

// W-022: a live codex-cli 0.166 exits 1, not 2, for a --disable name it does not know.
test('W-022 codex exiting 1 with "Unknown feature flag" reports "update codex or the pack" without the sign-in hint', () =>
  withRoot({ pending: untriaged(2) }, async (r) => {
    const { runner } = makeRunner(r, { codex: failing({ status: 1, stderr: 'Error: Unknown feature flag: view_image' }) });
    await dailyTriage({ ...codexArgs(r), runner });
    const digest = r.read(digestFile(r));
    assert.match(digest, /Unknown feature flag: view_image/);
    assert.match(digest, /update codex or the pack/);
    assert.doesNotMatch(digest, /sign in/i);
  }));

// legacy-M-002-S20
test('legacy-M-002-S20 a codex call that throws ETIMEDOUT writes "codex timed out after 15 minutes", leaves pipeline.md unchanged and resolves', () =>
  withRoot({ pending: untriaged(2) }, async (r) => {
    const before = r.read('data/pipeline.md');
    const { runner } = makeRunner(r, { codex: failing({ code: 'ETIMEDOUT', signal: 'SIGTERM' }) });
    await assert.doesNotReject(dailyTriage({ ...codexArgs(r), runner }));
    assert.equal(r.read('data/pipeline.md'), before);
    assert.match(r.read(digestFile(r)), /codex timed out after 15 minutes/);
  }));

// legacy-M-002-S21
test('legacy-M-002-S21 the codex argv carries --ignore-user-config, --disable hooks and -c web_search=disabled, and -C and cwd are the temp folder', () =>
  withRoot({ pending: untriaged(2) }, async (r) => {
    const { runner, calls } = makeRunner(r);
    await dailyTriage({ ...codexArgs(r), runner });
    const call = calls.codex[0];
    assert.ok(call.args.includes('--ignore-user-config'));
    assert.ok(pairs(call.args, '--disable').includes('hooks'));
    assert.ok(pairs(call.args, '-c').includes('web_search=disabled'));
    assert.equal(flagValue(call.args, '-C'), call.opts.cwd);
    assert.notEqual(call.opts.cwd, r.root);
    assert.equal(call.out.startsWith(call.opts.cwd), true);
  }));
