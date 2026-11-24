// M-007 fix round 1, NITs N-4 and N-5: rank-queue rows carry a track (intern or fulltime, from the title) that the fill
// plan keeps for chrome.mjs submit, and lib/url-key.mjs drops more tracking parameters (lever-origin, trk, refId,
// trackingId) while keeping posting ids. Scratch roots and fake postings only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { urlKey } from '../../lib/url-key.mjs';
import { jobUrl, line, makeRoot, pipelineText, runScript } from '../helpers/script-harness.mjs';

test('N-4 rank-queue --json rows carry track intern or fulltime from the title', () => {
  const r = makeRoot({ config: 'daily_target: 5\nscore_floor: 3.0\n' });
  try {
    r.write('data/pipeline.md', pipelineText({ pending: [line(jobUrl(1), 'Northwind Robotics', 'Data Analyst Intern', 'Remote', 'triage=4.5'), line(jobUrl(2), 'Contoso Analytics', 'Junior Data Analyst', 'Remote', 'triage=4.4')] }));
    const res = runScript('rank-queue', ['--json'], r);
    assert.equal(res.code ?? res.status, 0, res.stderr);
    const rows = JSON.parse(res.stdout);
    assert.deepEqual(rows.map((x) => [x.url, x.track]), [[jobUrl(1), 'intern'], [jobUrl(2), 'fulltime']]);
  } finally {
    r.cleanup();
  }
});

test('N-5 urlKey drops lever-origin, trk, refId and trackingId and keeps the posting id', () => {
  const base = 'https://jobs.lever.co/example/abc123';
  assert.equal(urlKey(`${base}?lever-origin=applied&lever-source=LinkedIn`), base);
  assert.equal(urlKey('https://www.linkedin.com/jobs/view/4100000001/?trk=public_jobs&refId=xyz&trackingId=abc'), 'https://www.linkedin.com/jobs/view/4100000001');
  assert.equal(urlKey('https://boards.greenhouse.io/example/jobs?gh_jid=42&trk=x'), 'https://boards.greenhouse.io/example/jobs?gh_jid=42');
});
