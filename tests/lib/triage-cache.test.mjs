// lib/triage-cache.mjs through scripts/daily-triage.mjs (T1 on by default): a row whose job text hashes the same as at its
// last triage is not sent again, while a row whose text changed has its triage note cleared and is resent. Two runs on one
// scratch root; the runner is injected (fake fetch-jd and claude), so no agent starts. Fake companies only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { args, jobUrl, line, makeRunner, makeTriageRoot, sentUrls, verdict } from '../helpers/triage-harness.mjs';
import { rowsOf } from '../helpers/script-harness.mjs';

const allSent = (calls) => sentUrls(calls.claude.map((c) => c.opts.input).join('\n'));

// M-003-S4-osdr
test('M-003-S4-osdr a row with an unchanged job-text hash is skipped while a changed hash is resent', async () => {
  const { textHash, CACHE_FILE } = await import('../../lib/triage-cache.mjs');
  assert.equal(CACHE_FILE, 'triage-cache.tsv');
  assert.match(String(textHash('Example posting text')), /^[0-9a-f]{64}$/, 'a sha256 hex digest');
  assert.equal(textHash('Example posting text'), textHash('Example posting text'));
  assert.notEqual(textHash('Example posting text'), textHash('Example posting text, revised'));

  const { dailyTriage } = await import('../../scripts/daily-triage.mjs');
  const r = makeTriageRoot({
    pending: [
      line(jobUrl(1), 'Example Robotics', 'Software Engineering Intern', 'Remote', 'src=handshake'),
      line(jobUrl(2), 'Sample Labs', 'Data Engineering Intern', 'Remote', 'src=handshake'),
    ],
  });
  try {
    const first = makeRunner(r, {
      fetch: (url) => `Original posting for ${url}. Open to current students. Python preferred.`,
      claude: (_a, opts) => [...sentUrls(opts.input)].map((u) => verdict('PASS', u, '4.0')).join('\n'),
    });
    await dailyTriage({ ...args(r), runner: first.runner });
    assert.deepEqual([...allSent(first.calls)].sort(), [jobUrl(1), jobUrl(2)]);

    const second = makeRunner(r, {
      fetch: (url) => (url === jobUrl(2) ? `Revised posting for ${url}. Now also asks for SQL. Open to current students.` : `Original posting for ${url}. Open to current students. Python preferred.`),
      claude: (_a, opts) => [...sentUrls(opts.input)].map((u) => verdict('PASS', u, '3.8')).join('\n'),
    });
    await dailyTriage({ ...args(r), runner: second.runner });
    const resent = allSent(second.calls);
    assert.equal(resent.has(jobUrl(1)), false, 'the unchanged posting is not sent to the model again');
    assert.equal(resent.has(jobUrl(2)), true, 'the changed posting is resent');
    const pend = rowsOf(r.read('data/pipeline.md'), 'Pending');
    assert.equal(pend.find((x) => x.url === jobUrl(1)).notes.get('triage'), '4.0', 'the unchanged row keeps its first verdict');
    assert.equal(pend.find((x) => x.url === jobUrl(2)).notes.get('triage'), '3.8', 'the changed row carries the new verdict');
  } finally {
    r.cleanup();
  }
});
