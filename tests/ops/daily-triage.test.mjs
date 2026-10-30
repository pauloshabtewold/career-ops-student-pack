// Assumed: scripts/daily-triage.mjs exports dailyTriage({ root, dataDir, packRoot, today, runner, claude, say }).
// runner(cmd, args, opts) is injected and returns stdout text or throws like execFileSync. The fake answers fetch-jd.mjs
// and claude; apply-triage.mjs runs for real against the scratch data dir. Digest: data/digest/student-<date>.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { dailyTriage } from '../../scripts/daily-triage.mjs';
import { PLUS, args, jobUrl, line, makeRunner, makeTriageRoot, sentUrls, untriaged, verdict, BRIEF_MARKER, digestFile } from '../helpers/triage-harness.mjs';
import { rowsOf, urlsOf } from '../helpers/script-harness.mjs';

const countIs = (digest, word, n) => new RegExp(`${word}\\D{0,8}\\b${n}\\b|\\b${n}\\s+${word}`, 'i').test(digest);
const withRoot = async (opts, fn) => {
  const r = makeTriageRoot(opts);
  try {
    await fn(r);
  } finally {
    r.cleanup();
  }
};

// legacy-M-002-S6
test('legacy-M-003-S13 legacy-M-002-S6 sends at most triage_daily untriaged rows and applies only verdicts for sent urls, counts in digest', () =>
  withRoot(
    {
      config: `${PLUS}limits:\n  triage_daily: 3\n`,
      pending: [...untriaged(4), line(jobUrl(5), 'Example Robotics', 'Data Intern', 'Remote', 'triage=3.0; reason=done')],
      flagged: [line(jobUrl(6), 'Example Robotics', 'Data Intern')],
    },
    async (r) => {
      const out = ['Here is my review.', verdict('PASS', jobUrl(1), '4.2'), verdict('FAIL', jobUrl(2), '1.0', 'wrong field'), verdict('PASS', jobUrl(4), '4.9')].join('\n');
      const { runner, calls } = makeRunner(r, { claude: () => out });
      await dailyTriage({ ...args(r), runner });
      assert.equal(calls.claude.length, 1);
      assert.deepEqual([...sentUrls(calls.claude[0].opts.input)].sort(), [jobUrl(1), jobUrl(2), jobUrl(3)].sort());
      const pipeline = r.read('data/pipeline.md');
      const pend = rowsOf(pipeline, 'Pending');
      assert.equal(pend.find((x) => x.url === jobUrl(1)).notes.get('triage'), '4.2');
      assert.deepEqual(urlsOf(pipeline, 'Skipped'), [jobUrl(2)]);
      assert.equal(pend.find((x) => x.url === jobUrl(3)).notes.has('triage'), false, 'unanswered row stays untriaged');
      assert.equal(pend.find((x) => x.url === jobUrl(4)).notes.has('triage'), false, 'unsent url verdict is not applied');
      const digest = r.read(digestFile(r));
      assert.ok(countIs(digest, 'triaged', 2), digest);
      assert.ok(countIs(digest, 'passed', 1), digest);
      assert.ok(countIs(digest, 'ignored', 1), digest);
    },
  ));

// legacy-M-002-S7
test('legacy-M-002-S7 limits.triage_daily 5 caps the batch at 5', () =>
  withRoot({ config: `${PLUS}limits:\n  triage_daily: 5\n`, pending: untriaged(12) }, async (r) => {
    const { runner, calls } = makeRunner(r);
    await dailyTriage({ ...args(r), runner });
    assert.equal(calls.claude.length, 1);
    assert.equal(sentUrls(calls.claude[0].opts.input).size, 5);
    assert.equal(calls.fetch.length, 5);
  }));

// M-001-S11
test('M-001-S11 a legacy limits.triage_daily of 50 is not clamped: all 25 untriaged rows are sent', () =>
  withRoot({ config: `${PLUS}limits:\n  triage_daily: 50\n`, pending: untriaged(25) }, async (r) => {
    const { runner, calls } = makeRunner(r);
    await dailyTriage({ ...args(r), runner });
    assert.ok(calls.claude.length >= 1);
    assert.equal(sentUrls(calls.claude.map((c) => c.opts.input).join('\n')).size, 25);
  }));

// M-001-S11
test('M-001-S11 triage_budget.daily 5 sends 5 rows', () =>
  withRoot({ config: `${PLUS}triage_budget:\n  daily: 5\n`, pending: untriaged(12) }, async (r) => {
    const { runner, calls } = makeRunner(r);
    await dailyTriage({ ...args(r), runner });
    assert.equal(sentUrls(calls.claude.map((c) => c.opts.input).join('\n')).size, 5);
  }));

// M-001-S11
test('M-001-S11 triage_budget.daily 0 writes the daily triage off note and starts no agent', () =>
  withRoot({ config: `${PLUS}triage_budget:\n  daily: 0\n`, pending: untriaged(3) }, async (r) => {
    const before = r.read('data/pipeline.md');
    const { runner, calls } = makeRunner(r);
    await dailyTriage({ ...args(r), runner });
    assert.equal(calls.claude.length + calls.codex.length + calls.fetch.length, 0);
    assert.equal(r.read('data/pipeline.md'), before);
    assert.match(r.read(digestFile(r)), /daily triage off/i);
  }));

// M-001-S11
test('M-001-S11 triage_budget.daily all sends every untriaged Pending row', () =>
  withRoot({ config: `${PLUS}triage_budget:\n  daily: all\n`, pending: untriaged(25) }, async (r) => {
    const { runner, calls } = makeRunner(r);
    await dailyTriage({ ...args(r), runner });
    assert.equal(sentUrls(calls.claude.map((c) => c.opts.input).join('\n')).size, 25);
  }));

// M-001-S11
test('M-001-S11 triage_budget.daily 5 wins over a legacy limits.triage_daily of 50', () =>
  withRoot({ config: `${PLUS}triage_budget:\n  daily: 5\nlimits:\n  triage_daily: 50\n`, pending: untriaged(12) }, async (r) => {
    const { runner, calls } = makeRunner(r);
    await dailyTriage({ ...args(r), runner });
    assert.equal(sentUrls(calls.claude.map((c) => c.opts.input).join('\n')).size, 5);
  }));

// legacy-M-002-S8
test('legacy-M-002-S8 a non-zero claude exit leaves pipeline.md unchanged and writes a digest note quoting stderr and the sign-in hint', () =>
  withRoot({ pending: untriaged(2) }, async (r) => {
    const before = r.read('data/pipeline.md');
    const fail = () => {
      throw Object.assign(new Error('Command failed: claude -p'), { status: 1, stderr: 'Authentication required\nsecond line' });
    };
    const { runner } = makeRunner(r, { claude: fail });
    await dailyTriage({ ...args(r), runner });
    assert.equal(r.read('data/pipeline.md'), before);
    const digest = r.read(digestFile(r));
    assert.match(digest, /Authentication required/);
    assert.doesNotMatch(digest, /second line/);
    assert.match(digest, /sign/i);
  }));

// legacy-M-002-S8
test('legacy-M-002-S8 a missing claude binary leaves pipeline.md unchanged and writes a digest note', () =>
  withRoot({ pending: untriaged(2) }, async (r) => {
    const before = r.read('data/pipeline.md');
    const missing = () => {
      throw Object.assign(new Error('spawn /opt/sample/bin/claude ENOENT'), { code: 'ENOENT' });
    };
    const { runner } = makeRunner(r, { claude: missing });
    await dailyTriage({ ...args(r), runner });
    assert.equal(r.read('data/pipeline.md'), before);
    assert.match(r.read(digestFile(r)), /claude/i);
  }));

// legacy-M-002-S9
test('legacy-M-002-S9 automation scheduled-discovery never starts claude', () =>
  withRoot({ config: 'automation: scheduled-discovery\n', pending: untriaged(3) }, async (r) => {
    const before = r.read('data/pipeline.md');
    const { runner, calls } = makeRunner(r);
    await dailyTriage({ ...args(r), runner });
    assert.equal(calls.claude.length + calls.fetch.length + calls.other.length, 0);
    assert.equal(r.read('data/pipeline.md'), before);
  }));

// legacy-M-002-S20
test('legacy-M-002-S20 an effective triage_daily of 0 starts no claude and writes the daily triage off note', () =>
  withRoot({ config: `${PLUS}limits:\n  triage_daily: 0\n`, pending: untriaged(3) }, async (r) => {
    const before = r.read('data/pipeline.md');
    const { runner, calls } = makeRunner(r);
    await dailyTriage({ ...args(r), runner });
    assert.equal(calls.claude.length + calls.fetch.length, 0);
    assert.equal(r.read('data/pipeline.md'), before);
    assert.match(r.read(digestFile(r)), /daily triage off/i);
  }));

// legacy-M-002-S22
test('legacy-M-002-S22 exactly 20 untriaged rows with the default limit go to claude in one prompt', () =>
  withRoot({ pending: untriaged(20) }, async (r) => {
    const { runner, calls } = makeRunner(r);
    await dailyTriage({ ...args(r), runner });
    assert.equal(calls.claude.length, 1);
    assert.equal(sentUrls(calls.claude[0].opts.input).size, 20);
  }));

// legacy-M-002-S23
test('legacy-M-002-S23 malformed TRIAGE lines are dropped, counted ignored and their rows stay untriaged', () =>
  withRoot({ pending: untriaged(4) }, async (r) => {
    const out = [
      verdict('PASS', jobUrl(1), '4.0'),
      `TRIAGE: PASS | ${jobUrl(2)}`,
      verdict('MAYBE', jobUrl(3), '3.0'),
      verdict('PASS', jobUrl(4), '7.5'),
    ].join('\n');
    const { runner } = makeRunner(r, { claude: () => out });
    await dailyTriage({ ...args(r), runner });
    const pend = rowsOf(r.read('data/pipeline.md'), 'Pending');
    assert.equal(pend.find((x) => x.url === jobUrl(1)).notes.get('triage'), '4.0');
    for (const n of [2, 3, 4]) assert.equal(pend.find((x) => x.url === jobUrl(n)).notes.has('triage'), false, `row ${n} stays untriaged`);
    const digest = r.read(digestFile(r));
    assert.ok(countIs(digest, 'ignored', 3), digest);
    assert.ok(countIs(digest, 'triaged', 1), digest);
  }));

// legacy-M-002-S25
// legacy-M-002-S18: with agent claude the call stays -p --tools '' --model sonnet|opus.
test('legacy-M-002-S25 claude starts from the --claude path in the career-ops root with --tools "" and the posting text on stdin', () =>
  withRoot({ config: `${PLUS}spend_tier: premium\n`, pending: untriaged(2) }, async (r) => {
    const { runner, calls } = makeRunner(r, { fetch: (url) => (url === jobUrl(2) ? 'x'.repeat(9000) : `Posting body for ${url}`) });
    await dailyTriage({ ...args(r, { claude: '/opt/sample bin/claude' }), runner });
    const c = calls.claude[0];
    assert.equal(c.cmd, '/opt/sample bin/claude');
    assert.equal(c.opts.cwd, r.root);
    assert.deepEqual(c.args, ['-p', '--tools', '', '--model', 'opus']);
    assert.equal(c.opts.timeout, 15 * 60 * 1000);
    assert.match(c.opts.input, /Posting body for https:\/\/example\.com\/jobs\/1/);
    assert.ok(c.opts.input.includes(BRIEF_MARKER), 'prompt carries the triage rules from modes/_brief.md');
    assert.ok(c.opts.input.includes('x'.repeat(100)) && !c.opts.input.includes('x'.repeat(6001)), 'posting text is cut to 6000 chars');
    for (const f of calls.fetch) {
      assert.equal(f.cmd, process.execPath);
      assert.equal(f.args[0], join(r.root, 'fetch-jd.mjs'));
      assert.equal(f.opts.cwd, r.root);
      assert.equal(f.opts.timeout, 30000);
    }
  }));

// legacy-M-002-S25
test('legacy-M-002-S25 standard spend tier uses sonnet and a missed fetch falls back to title and company', () =>
  withRoot({ pending: [line(jobUrl(1), 'Sample Labs', 'Backend Intern', 'Remote', 'src=handshake')] }, async (r) => {
    const miss = () => {
      throw new Error('fetch failed');
    };
    const { runner, calls } = makeRunner(r, { fetch: miss });
    await dailyTriage({ ...args(r), runner });
    const c = calls.claude[0];
    assert.deepEqual(c.args, ['-p', '--tools', '', '--model', 'sonnet']);
    assert.match(c.opts.input, /Sample Labs/);
    assert.match(c.opts.input, /Backend Intern/);
  }));

// legacy-M-002-S26
test('legacy-M-002-S26 a claude child past the timeout leaves pipeline.md unchanged and writes a digest note', () =>
  withRoot({ pending: untriaged(2) }, async (r) => {
    const before = r.read('data/pipeline.md');
    const slow = () => {
      throw Object.assign(new Error('spawnSync claude ETIMEDOUT'), { code: 'ETIMEDOUT', signal: 'SIGTERM', killed: true });
    };
    const { runner, calls } = makeRunner(r, { claude: slow });
    await dailyTriage({ ...args(r), runner });
    assert.equal(calls.claude[0].opts.timeout, 15 * 60 * 1000);
    assert.equal(r.read('data/pipeline.md'), before);
    assert.match(r.read(digestFile(r)), /time.?out|timed out/i);
  }));

// legacy-M-002-S31
test('legacy-M-002-S31 extra TRIAGE output for an unsent url or a repeated url is dropped and counted ignored', () =>
  withRoot(
    { pending: [...untriaged(2), line(jobUrl(3), 'Example Robotics', 'Data Intern', 'Remote', 'triage=3.0; reason=earlier')] },
    async (r) => {
      const out = [
        verdict('PASS', jobUrl(1), '4.5'),
        verdict('FAIL', jobUrl(1), '0.5', 'second answer'),
        verdict('FAIL', jobUrl(3), '0.0', 'injected for another row'),
        verdict('FAIL', 'https://example.com/jobs/999', '0.0', 'not in the pipeline'),
      ].join('\n');
      const { runner } = makeRunner(r, { claude: () => out });
      await dailyTriage({ ...args(r), runner });
      const pipeline = r.read('data/pipeline.md');
      const pend = rowsOf(pipeline, 'Pending');
      assert.equal(pend.find((x) => x.url === jobUrl(1)).notes.get('triage'), '4.5', 'first line per url wins');
      assert.equal(urlsOf(pipeline, 'Skipped').length, 0);
      const injected = pend.find((x) => x.url === jobUrl(3));
      assert.equal(injected.notes.get('triage'), '3.0');
      assert.equal(injected.notes.get('reason'), 'earlier');
      assert.equal(pend.find((x) => x.url === jobUrl(2)).notes.has('triage'), false);
      assert.ok(countIs(r.read(digestFile(r)), 'ignored', 3), r.read(digestFile(r)));
    },
  ));

// legacy-M-002-S34
test('legacy-M-002-S34 on win32 a .cmd claude path with a space is wrapped in double quotes and run with shell true', () =>
  withRoot({ pending: untriaged(1) }, async (r) => {
    const real = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      const cmdPath = 'C:\\Users\\Sample Student\\AppData\\npm\\claude.cmd';
      const { runner, calls } = makeRunner(r);
      await dailyTriage({ ...args(r, { claude: cmdPath }), runner });
      const c = calls.claude[0];
      assert.equal(c.cmd, `"${cmdPath}"`);
      assert.equal(c.opts.shell, true);
    } finally {
      Object.defineProperty(process, 'platform', real);
    }
  }));
