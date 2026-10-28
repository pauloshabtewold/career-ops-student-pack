// Assumed CLI: node scripts/merge-post.mjs [--dry-run] --root R --data-dir D --today T. Files under data/:
// pipeline.md, pipeline.staging.md, applications.md (markdown table), blacklist.md (urls anywhere in text),
// scan-history.tsv (column order read from its header, columns url first_seen portal title company status),
// student-rows.tsv (sidecar from lib/sidecar.mjs). Dropped rows are removed outright. Flagged rows keep their url text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRoot, runScript, line, pipelineText, urlsOf, rowsOf, sectionText, jobUrl, TODAY } from '../helpers/script-harness.mjs';
import { SIDECAR_HEADER } from '../../lib/sidecar.mjs';
import { serializeTsv, readTsv } from '../../lib/tsv.mjs';
import { urlKey } from '../../lib/url-key.mjs';

const APPS = [
  '# Applications',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
  '| 1 | 2026-09-01 | Example Robotics | Software Engineer - Intern | 4.2/5 | Applied | n | [1](r1.md) | |',
  '',
].join('\n');
const HISTORY_HEADER = ['first_seen', 'url', 'portal', 'title', 'company', 'status'];
const WD = (company, req) => `https://${company}.wd1.myworkdayjobs.com/en-US/External/job/Austin-TX/Software-Engineer-Intern_${req}`;

function setup({ pending = [], staging = [], flagged = [], sidecar = [], blacklist = '' } = {}) {
  const r = makeRoot();
  r.write('data/pipeline.md', pipelineText({ pending, flagged }));
  r.write('data/pipeline.staging.md', staging.length ? `${staging.join('\n')}\n` : '');
  r.write('data/applications.md', APPS);
  r.write('data/blacklist.md', blacklist);
  r.write('data/scan-history.tsv', serializeTsv(HISTORY_HEADER, []));
  if (sidecar.length) r.write('data/student-rows.tsv', serializeTsv([...SIDECAR_HEADER], sidecar));
  return r;
}
const sc = (url, o) => ({ url_key: urlKey(url), url, src: '', imported: '', extid: '', notes: '', ...o });
const merge = (r, extra = []) => {
  const out = runScript('merge-post', extra, r);
  assert.equal(out.code, 0, out.stderr);
  return out;
};

// M-004-S9
test('M-004-S9 staging rows are appended to Pending, logged to scan history and the staging file is truncated', async () => {
  const r = setup({ staging: [line(jobUrl(1), 'Example Robotics', 'Data Intern', 'Austin, TX', 'src=handshake; imported=2026-10-27; posted~3d')] });
  try {
    merge(r);
    const rows = rowsOf(r.read('data/pipeline.md'), 'Pending');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].notes.get('src'), 'handshake');
    assert.equal(r.read('data/pipeline.staging.md').trim(), '');
    const hist = await readTsv(r.file('data/scan-history.tsv'));
    assert.deepEqual(hist.header, HISTORY_HEADER);
    assert.equal(hist.rows.length, 1);
    assert.equal(hist.rows[0].url, jobUrl(1));
    assert.equal(hist.rows[0].title, 'Data Intern');
    assert.equal(hist.rows[0].company, 'Example Robotics');
    assert.equal(hist.rows[0].first_seen, TODAY);
  } finally {
    r.cleanup();
  }
});

// M-004-S9
test('M-004-S9 URL duplicates against pipeline, applications and blacklist are not appended', () => {
  const r = setup({
    pending: [line(jobUrl(1), 'Example Robotics', 'Data Intern')],
    blacklist: `- ${jobUrl(3)}\n`,
    staging: [
      line(jobUrl(1), 'Example Robotics', 'Data Intern'),
      line(jobUrl(3), 'Sample Labs', 'Platform Intern'),
      line(jobUrl(4), 'Sample Labs', 'Backend Intern'),
    ],
  });
  try {
    merge(r);
    assert.deepEqual(urlsOf(r.read('data/pipeline.md'), 'Pending').sort(), [jobUrl(1), jobUrl(4)].sort());
  } finally {
    r.cleanup();
  }
});

// M-004-S9
test('M-004-S9 sidecar src, imported and extid join Pending notes where missing', () => {
  const r = setup({
    pending: [
      line(jobUrl(1), 'Example Robotics', 'Data Intern'),
      line(jobUrl(2), 'Sample Labs', 'Backend Intern', 'Remote', 'src=manual'),
    ],
    sidecar: [
      sc(jobUrl(1), { src: 'github:list-a', imported: '2026-10-20', extid: 'x1' }),
      sc(jobUrl(2), { src: 'github:list-a', imported: '2026-10-21' }),
    ],
  });
  try {
    merge(r);
    const rows = rowsOf(r.read('data/pipeline.md'), 'Pending');
    const a = rows.find((x) => x.url === jobUrl(1)).notes;
    assert.equal(a.get('src'), 'github:list-a');
    assert.equal(a.get('imported'), '2026-10-20');
    assert.equal(a.get('extid'), 'x1');
    const b = rows.find((x) => x.url === jobUrl(2)).notes;
    assert.equal(b.get('src'), 'manual');
    assert.equal(b.get('imported'), '2026-10-21');
  } finally {
    r.cleanup();
  }
});

// M-004-S9
test('M-004-S9 rows whose company and title are already in applications.md or Pending are dropped, case and punctuation folded', () => {
  const r = setup({
    pending: [
      line(jobUrl(1), 'EXAMPLE ROBOTICS', 'Software Engineer Intern'),
      line(jobUrl(2), 'Sample Labs', 'Backend Intern'),
      line(jobUrl(3), 'Fresh Co', 'Data Intern'),
    ],
    staging: [line(jobUrl(4), 'sample labs', 'Backend  Intern!'), line(jobUrl(5), 'Other Co', 'Data Intern')],
  });
  try {
    merge(r);
    assert.deepEqual(urlsOf(r.read('data/pipeline.md'), 'Pending').sort(), [jobUrl(2), jobUrl(3), jobUrl(5)].sort());
  } finally {
    r.cleanup();
  }
});

// M-004-S10
test('M-004-S10 needs-url and aggregator-host rows go to Flagged', () => {
  const agg = 'https://www.indeed.com/viewjob?jk=abc123';
  const zip = 'https://www.ziprecruiter.com/c/Example/Job/Data-Intern';
  const r = setup({
    pending: [line(jobUrl(1), 'Example Robotics', 'Data Intern')],
    staging: [
      '- [ ] needs-url | Sample Labs | Platform Intern | Remote | note: src=handshake; imported=2026-10-27',
      line(agg, 'Agg Co', 'Systems Intern'),
      line(zip, 'Zip Co', 'Network Intern'),
      line(jobUrl(2), 'Plain Co', 'Cloud Intern'),
    ],
  });
  try {
    merge(r);
    const text = r.read('data/pipeline.md');
    assert.deepEqual(urlsOf(text, 'Pending').sort(), [jobUrl(1), jobUrl(2)].sort());
    const flagged = sectionText(text, 'Flagged');
    assert.match(flagged, /needs-url \| Sample Labs \| Platform Intern/);
    assert.ok(flagged.includes(agg));
    assert.ok(flagged.includes(zip));
    assert.ok(!sectionText(text, 'Pending').includes('needs-url'));
  } finally {
    r.cleanup();
  }
});

// M-004-S10
test('M-004-S10 a Workday repost with a new requisition id is skipped', () => {
  const r = setup({
    pending: [line(WD('examplecorp', 'R1001'), 'Example Corp', 'Software Engineer Intern', 'Austin, TX')],
    staging: [
      line(WD('examplecorp', 'R2002'), 'Example Corp', 'Software Engineer Intern', 'Austin, TX'),
      line(WD('samplecorp', 'R3003'), 'Sample Corp', 'Software Engineer Intern', 'Austin, TX'),
    ],
  });
  try {
    merge(r);
    const text = r.read('data/pipeline.md');
    assert.deepEqual(urlsOf(text, 'Pending').sort(), [WD('examplecorp', 'R1001'), WD('samplecorp', 'R3003')].sort());
    assert.ok(!text.includes('R2002'));
  } finally {
    r.cleanup();
  }
});

// M-004-S9
test('M-004-S9 --dry-run prints changes and leaves every file unchanged', () => {
  const r = setup({ staging: [line(jobUrl(1), 'Example Robotics', 'Data Intern')] });
  try {
    const files = ['data/pipeline.md', 'data/pipeline.staging.md', 'data/scan-history.tsv'];
    const before = files.map((f) => r.read(f));
    const out = merge(r, ['--dry-run']);
    assert.ok(out.stdout.trim().length > 0);
    assert.deepEqual(files.map((f) => r.read(f)), before);
  } finally {
    r.cleanup();
  }
});
