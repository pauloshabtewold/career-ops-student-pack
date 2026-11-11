// A list that answers 200 with a body its parser cannot read is skipped with a reason; the other lists still count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as H from '../helpers/research-harness.mjs';

test('extra check: a listings.json that is not an array is skipped and the next list is still added', async () => {
  const s = H.scratch();
  try {
    s.writeCandidates({
      web_searches: 0,
      boards: [],
      github_lists: [
        { repo: 'example-org/list-broken', path: 'listings.json', kind: 'internship' },
        { repo: 'example-org/list-good', path: 'README.md', kind: 'internship' },
      ],
    });
    const f = H.fakeFetch([H.rawRoute('list-broken', '{"not":"an array"}'), H.rawRoute('list-good', H.mdList(H.uniqueRows(5, 'Software', 'good')))]);
    const r = await H.runMain(s, ['--no-search'], { fetch: f.fetch, sleep: H.sleeper().sleep, upstream: H.fakeUpstream({}), preset: H.PRESET });
    assert.equal(r.code, 0, r.errText);
    assert.ok(r.out.some((l) => /^skipped: .*list-broken.*list unreadable/.test(l)), r.text);
    assert.ok(r.out.some((l) => /^added: .*list-good/.test(l)), r.text);
    assert.deepEqual(s.registry().sources.map((x) => x.repo), ['example-org/list-good']);
  } finally {
    s.cleanup();
  }
});
