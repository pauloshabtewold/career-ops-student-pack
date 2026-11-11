// Run 4b (finance): the github-lists step line counted a list once per pass, called deferred lists "read", and the first-run
// queue view filed rows from lists under "board"; company names came from the job-site address, not the list's cell.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { ingestSteps } from '../../lib/ingest.mjs';
import { queueView } from '../../scripts/first-run.mjs';
import { SIDECAR_HEADER } from '../../lib/sidecar.mjs';
import { serializeTsv, readTsv } from '../../lib/tsv.mjs';
import { urlKey } from '../../lib/url-key.mjs';
import { line, makeRoot, pipelineText, runScript } from '../helpers/script-harness.mjs';

const HEADER = 'date\tname\tfetched\teligible\tunique_new\tparse_errors\tfailed\tdeferred\talready_queued\n';
const registry = (names) => JSON.stringify({ sources: names.map((name) => ({ name, status: 'active', last_read: '2026-11-10', last_ingest: '2026-11-10' })) });

function runStep(dir, passes, listPasses = 6) {
  const seen = [];
  let calls = 0;
  const runner = (cmd, args) => {
    if (basename(args[0]) !== 'plugins.mjs') return '';
    appendFileSync(join(dir, 'student-github-stats.tsv'), passes[Math.min(calls, passes.length - 1)]);
    calls++;
    return 'github-lists ingest: 0 found, 0 new.\n';
  };
  ingestSteps({ root: dir, dataDir: dir, packRoot: dir, today: '2026-11-10', runner, listPasses, step: (name, fn) => { if (name === 'github-lists') seen.push(fn()); } });
  return { out: seen[0], calls };
}

test('bug 1: a list read in several passes is counted once, eligible and deferred from its latest row', () => {
  const dir = mkdtempSync(join(tmpdir(), 'step-truth-'));
  try {
    writeFileSync(join(dir, 'student-github-stats.tsv'), HEADER);
    writeFileSync(join(dir, 'student-github-sources.json'), registry(['a', 'b']));
    const { out } = runStep(dir, [
      '2026-11-10\ta\t50\t20\t5\t0\t0\t15\t1\n2026-11-10\tb\t50\t30\t10\t0\t0\t0\t2\n',
      '2026-11-10\ta\t50\t20\t4\t0\t0\t3\t0\n',
    ], 2);
    assert.match(out.split('\n')[0], /^github-lists: 2 list\(s\) read in 2 runs, 50 eligible postings, 19 new rows, 3 already in queue from another list, 3 waiting for the next run/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('bug 2: passes continue while deferred rows shrink, stop on no progress, and the line names lists with rows waiting', () => {
  const dir = mkdtempSync(join(tmpdir(), 'step-truth-'));
  try {
    writeFileSync(join(dir, 'student-github-stats.tsv'), HEADER);
    writeFileSync(join(dir, 'student-github-sources.json'), registry(['a']));
    const { out, calls } = runStep(dir, [
      '2026-11-10\ta\t50\t20\t5\t0\t0\t15\t0\n',
      '2026-11-10\ta\t50\t20\t5\t0\t0\t9\t0\n',
      '2026-11-10\ta\t50\t20\t5\t0\t0\t9\t0\n',
    ]);
    assert.equal(calls, 3, 'one pass past the last progress, then it stops');
    assert.match(out, /\n1 list\(s\) have rows waiting \(a\), left to the daily run$/);
    assert.match(out, /9 waiting for the next run/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('bug 2: no waiting line when every deferred row was resolved', () => {
  const dir = mkdtempSync(join(tmpdir(), 'step-truth-'));
  try {
    writeFileSync(join(dir, 'student-github-stats.tsv'), HEADER);
    writeFileSync(join(dir, 'student-github-sources.json'), registry(['a']));
    const { out, calls } = runStep(dir, ['2026-11-10\ta\t50\t20\t5\t0\t0\t15\t0\n', '2026-11-10\ta\t50\t20\t5\t0\t0\t0\t0\n']);
    assert.equal(calls, 2);
    assert.ok(!/waiting \(/.test(out), out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('bug 3: merge-post names a list row by the list company cell, not the job-site address', async () => {
  const url = 'https://pnc.wd5.myworkdayjobs.com/External/job/NY/Intern_R1';
  const r = makeRoot();
  try {
    r.write('data/pipeline.md', pipelineText({ pending: [line(url, 'Pnc', 'Finance Intern', 'New York', 'imported=2026-11-10')] }));
    r.write('data/pipeline.staging.md', '');
    r.write('data/applications.md', '# Applications\n');
    r.write('data/blacklist.md', '');
    r.write('data/scan-history.tsv', serializeTsv(['first_seen', 'url', 'portal', 'title', 'company', 'status'], []));
    r.write('data/student-rows.tsv', serializeTsv([...SIDECAR_HEADER], [{ url_key: urlKey(url), url, src: 'github:x-list', imported: '2026-11-10', extid: '', notes: 'company=PNC Financial; Services' }]));
    const out = runScript('merge-post', [], r);
    assert.equal(out.code, 0, out.stderr);
    const text = r.read('data/pipeline.md');
    assert.match(text, /\| PNC Financial; Services \|/);
    assert.ok(!/\| Pnc \|/.test(text));
    assert.equal((await readTsv(r.file('data/student-rows.tsv'))).rows.length, 1);
  } finally {
    r.cleanup();
  }
});

test('bug 4: the queue view labels list rows by the sidecar before merge-post has joined it', () => {
  const url = 'https://jobs.lever.co/acme/1';
  const pipeline = pipelineText({ pending: [line(url, 'Acme', 'Intern', 'NYC', 'imported=2026-11-10'), line('https://jobs.lever.co/b/2', 'B', 'Intern', 'NYC', 'imported=2026-11-10')] });
  const sidecar = serializeTsv([...SIDECAR_HEADER], [{ url_key: urlKey(url), url, src: 'github:x-list', imported: '2026-11-10', extid: '', notes: '' }]);
  const out = queueView(pipeline, null, sidecar);
  assert.ok(out.includes('source github:x-list: 1'), out.join('\n'));
  assert.ok(out.includes('source board: 1'), out.join('\n'));
});
