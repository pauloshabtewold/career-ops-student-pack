// discover-github-lists takes today from the config timezone when --today is not given.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { main } from '../../scripts/discover-github-lists.mjs';
import { createClock } from '../../lib/clock.mjs';
import * as H from '../helpers/feed-harness.mjs';

const INSTANT = new Date('2026-10-30T02:00:00Z');
const SOURCES = 'student-github-sources.json';
const mdList = `| Company | Role | Location | Application | Date Posted |
| --- | --- | --- | --- | --- |
| [Example Robotics](https://example.com/r) | Software Engineer Intern - Summer 2027 | Austin, TX | [Apply](https://boards.greenhouse.io/examplerobotics/jobs/1) | 2026-10-20 |
`;
const handlers = () => [
  [(u) => u.startsWith('https://api.github.com/search/repositories'), () => H.json({ items: [{ full_name: 'example-org/list-1', default_branch: 'main', pushed_at: '2026-10-25T10:00:00Z', html_url: 'https://github.com/example-org/list-1' }] })],
  [(u) => /^https:\/\/raw\.githubusercontent\.com\/example-org\/list-1\//.test(u), () => H.text(mdList)],
];

async function runDiscover(timezone) {
  const s = H.scratch();
  try {
    mkdirSync(join(s.dir, 'config'), { recursive: true });
    writeFileSync(join(s.dir, 'config', 'student.yml'), `timezone: "${timezone}"\n`);
    H.writeJson(join(s.data, SOURCES), {
      sources: [{ name: 'seed', repo: 'example-org/seed', path: 'README.md', format: 'markdown-table', kind: 'internship', status: 'active', added: '2026-01-01', last_push: '2026-10-29', last_unique: '2026-10-29', failed_parses: 0 }],
    });
    H.writeJson(join(s.data, 'student-cycle.json'), H.CYCLE);
    const stub = H.stubFetch(handlers());
    const code = await main(['--root', s.dir, '--data-dir', s.data], { fetch: stub.fetch, sleep: async () => {}, preset: H.PRESET, now: () => INSTANT });
    assert.equal(code, 0);
    const trials = JSON.parse(readFileSync(join(s.data, SOURCES), 'utf8')).sources.filter((e) => e.status === 'trial');
    return trials.map((t) => t.added);
  } finally {
    s.cleanup();
  }
}

// M-001-S1
test('M-001-S1 without --today the config timezone decides the date', async () => {
  assert.deepEqual(await runDiscover('America/Los_Angeles'), ['2026-10-29']);
});

// M-001-S9
test('M-001-S9 an empty config timezone computes today in the host zone', async () => {
  const before = process.env.TZ;
  process.env.TZ = 'Pacific/Pago_Pago';
  try {
    const expected = createClock({ nowFn: () => INSTANT }).today();
    assert.equal(expected, '2026-10-29');
    assert.deepEqual(await runDiscover(''), [expected]);
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
});
