// Full fake-data cycle for one synthetic student: setup-flow (every message checked for the Next/Type/Why lines),
// scheduled.mjs with a fake agent standing in for claude, the apply batch approved with "approve all except 2", then
// chrome.mjs fill and submit on the local mock ATS form only, and the next digest's applied count. The automation Chrome
// goes through chrome-harness (browser slot gate); BROWSER_SLOT_CMD=false makes it skip without starting a browser.
// No real model, network host, mailbox or launchctl is reached. Fake data only.
// Rulings: a setup message is the output of one setupFlow run (the fresh run and its re-run); the scheduled children
// run for real with a PATH whose only claude is the fake agent; "the digest lists them" is the last `- applied: N` line
// of data/digest/student-<batch date>.md after the next scheduled run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gate, openChrome, runChromeCli, stopAll, ROOT_ENV } from '../helpers/chrome-harness.mjs';
import { startMockAts } from '../helpers/mock-ats-server.mjs';
import { PACK_ROOT, line, makeRoot, pipelineText } from '../helpers/script-harness.mjs';
import { listBatches, readBatch } from '../../lib/batch-file.mjs';
import { readActionLog } from '../../lib/action-log.mjs';
import { jdFileName } from '../../lib/jd-store.mjs';
import { FIELDS_DIR } from '../../scripts/autopilot.mjs';
import { scheduledRun } from '../../scripts/scheduled.mjs';

const CV = '# Riley Placeholder\n\nriley.placeholder@example.com | 555-0100\n\n## Education\nB.S. Computer Science, Example State University, May 2027\n\n## Experience\n- Software Intern, Example Robotics, Jun 2025 - Aug 2025: built a Python scheduling tool\n\n## Skills\nPython, SQL\n';
const PROFILE = 'candidate:\n  full_name: "Riley Placeholder"\n  email: "riley.placeholder@example.com"\n  phone: "555-0100"\n';
const CONFIG = 'onboarding:\n  complete: true\npresets:\n  - software-cs\nautomation: scheduled-discovery\nchrome_in_schedule: no\ndaily_target: 5\nscore_floor: 3.0\nagent: claude\n';
const JOBS = [
  { job: 71, company: 'Example Robotics', triage: '4.7' },
  { job: 72, company: 'Example Analytics', triage: '4.6' },
  { job: 73, company: 'Example Labs', triage: '4.5' },
];
const EXCLUDED = 2;
const APPROVAL = `approve all except ${EXCLUDED}`;
// The mock Greenhouse form fields a session would have read, as fill-plan reads them from the form-fields folder.
const FORM_FIELDS = [
  { label: 'First Name', name: 'first_name', type: 'text', required: true },
  { label: 'Last Name', name: 'last_name', type: 'text', required: true },
  { label: 'Email', name: 'email', type: 'email', required: true },
  { label: 'Phone', name: 'phone', type: 'tel' },
  { label: 'Resume/CV', name: 'resume', type: 'file', required: true },
];
const GUIDED = ['Next:', 'Type:', 'Why:'];

const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const jobOf = (link) => Number(new URL(link).searchParams.get('job'));
const guidedLine = (l) => l.replace(/^[\s>*_-]+/, '').replace(/^\*\*(Next|Type|Why):\*\*/, '$1:');

// A bin folder whose claude answers every headless call with a fixed claude -p JSON reply and reads nothing else.
function fakeAgentBin(dir) {
  const bin = join(dir, 'fake-bin');
  mkdirSync(bin, { recursive: true });
  const reply = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: CV, usage: { input_tokens: 1, output_tokens: 1 } });
  writeFileSync(join(bin, 'fake-agent.mjs'), `import { readFileSync } from 'node:fs';\ntry { readFileSync(0); } catch {}\nprocess.stdout.write(${JSON.stringify(reply)});\n`);
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\nexec node "$(dirname "$0")/fake-agent.mjs" "$@"\n');
  chmodSync(join(bin, 'claude'), 0o755);
  writeFileSync(join(bin, 'claude.cmd'), '@echo off\r\nnode "%~dp0fake-agent.mjs" %*\r\n');
  return bin;
}

// PATH for the scheduled children: the fake agent first, node next, and no folder that holds a real claude.
function agentPath(bin, env) {
  const hasClaude = (d) => ['claude', 'claude.cmd', 'claude.exe'].some((n) => existsSync(join(d, n)));
  const rest = String(env.PATH ?? env.Path ?? '').split(delimiter).filter((d) => d && !hasClaude(d));
  return [bin, dirname(process.execPath), ...rest].join(delimiter);
}

function fixture(ats) {
  const r = makeRoot({ config: CONFIG });
  r.write('config/profile.yml', PROFILE);
  r.write('cv.md', CV);
  // Stand-in for upstream generate-pdf.mjs (plan CC-M-007-001 FAKE_PDF): visible HTML text as a one-page PDF with a
  // real text layer, so the resume render needs no browser.
  const miniPdf = pathToFileURL(join(PACK_ROOT, 'tests', 'helpers', 'mini-pdf.mjs')).href;
  r.write('generate-pdf.mjs', [
    "import { readFileSync, writeFileSync } from 'node:fs';",
    `import { makePdf } from '${miniPdf}';`,
    'const [html, pdf] = process.argv.slice(2);',
    "const visible = readFileSync(html, 'utf8').replace(/<(style|script)[\\s\\S]*?<\\/\\1>/g, '').replace(/<\\/(h1|h2|h3|p|li)>/g, '\\n');",
    "const lines = visible.replace(/<[^>]+>/g, '').replace(/&bull;/g, '-').replace(/&amp;/g, '&').split('\\n').map((l) => l.trim()).filter(Boolean);",
    'writeFileSync(pdf, makePdf([lines]));',
    '',
  ].join('\n'));
  const rows = JOBS.map((j) => ({ ...j, url: `${ats.url}/greenhouse/form?job=${j.job}` }));
  r.write('data/pipeline.md', pipelineText({ pending: rows.map((j) => line(j.url, j.company, 'Software Engineering Intern', 'Remote', `triage=${j.triage}`)) }));
  mkdirSync(join(r.data, FIELDS_DIR), { recursive: true });
  for (const j of rows) writeFileSync(join(r.data, FIELDS_DIR, jdFileName(j.url).replace(/\.txt$/, '.json')), JSON.stringify(FORM_FIELDS));
  // The job text triage saves for each row (data/jds/<key>.txt); the fixture's triage is faked, so it is seeded here.
  mkdirSync(join(r.data, 'jds'), { recursive: true });
  for (const j of rows) writeFileSync(join(r.data, 'jds', jdFileName(j.url)), `${j.company} is hiring a Software Engineering Intern (remote, summer 2026). You will build internal tools in Python, write SQL queries against our analytics store, ship small features with code review, and work with a mentor on one scoped project. Requirements: pursuing a B.S. in Computer Science or a related field, coursework or projects in Python, basic SQL. Nice to have: scheduling or automation tools.\n`);
  return r;
}

// Setup steps that would build files, open Chrome or install a schedule are fakes; each run's say() lines are one message.
async function setupMessages(r, today) {
  const { setupFlow } = await import('../../scripts/setup-flow.mjs');
  const paths = { root: r.root, dataDir: r.data, configDir: join(r.root, 'config'), modesDir: join(r.root, 'modes') };
  const messages = [];
  for (let run = 0; run < 2; run++) {
    const lines = [];
    const deps = {
      buildResume: async () => {
        const out = join(r.data, 'resume');
        mkdirSync(out, { recursive: true });
        writeFileSync(join(out, 'resume.html'), '<html><body><h1>Riley Placeholder</h1></body></html>');
        writeFileSync(join(out, 'resume.pdf'), '%PDF-1.4\n%%EOF\n');
        return { html: join(out, 'resume.html'), pdf: join(out, 'resume.pdf') };
      },
      atsCheck: async () => ({ ok: true, problems: [] }),
      chrome: async () => ({ code: 0 }),
      schedule: async () => ({ code: 0 }),
      say: (...a) => lines.push(a.join(' ')),
    };
    await setupFlow({ paths, flags: {}, today, deps });
    messages.push(lines.join('\n'));
  }
  return messages;
}

async function scheduled(r, env) {
  const runner = (cmd, args, opts) => execFileSync(cmd, args, { ...opts, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const out = [];
  const code = await scheduledRun({ root: r.root, packRoot: PACK_ROOT, passThrough: ['--root', r.root, '--data-dir', r.data], dataDir: r.data, runner, out: (l) => out.push(String(l)) });
  return { code, out: out.join('\n') };
}

function approve(r, id) {
  const res = spawnSync(process.execPath, [join(PACK_ROOT, 'scripts', 'batch.mjs'), 'approve', id, APPROVAL, '--root', r.root, '--data-dir', r.data], { cwd: PACK_ROOT, encoding: 'utf8', timeout: 60000 });
  return { code: res.status, text: `${res.stdout ?? ''}${res.stderr ?? ''}` };
}

const logRows = async (r) => (existsSync(join(r.data, 'action-log.tsv')) ? readActionLog(join(r.data, 'action-log.tsv')) : []);

// The whole cycle. Returns null after t.skip(reason) when the gate or the browser slot says no; the gate runs first,
// so a machine without Chrome builds no fixture and starts nothing.
async function runCycle(t, { env = process.env, onSetup = () => {} } = {}) {
  const reason = await gate({ env });
  if (reason) {
    t.skip(reason);
    return null;
  }
  const ats = await startMockAts();
  const r = fixture(ats);
  const home = mkdtempSync(join(tmpdir(), 'pack-live-mock-home-'));
  const childEnv = { ...env, PATH: agentPath(fakeAgentBin(home), env), HOME: home, USERPROFILE: home, [ROOT_ENV]: r.root };
  let opened = false;
  try {
    const today = localToday();
    const messages = await setupMessages(r, today);
    // Checked before any browser step, so a run that skips at the browser slot still checks the setup messages.
    onSetup(messages);

    const first = await scheduled(r, childEnv);
    assert.equal(first.code, 0, first.out);
    // The resume render is a browser launch too, so a slot hook that said no there is the same skip as at chrome.mjs open.
    const slot = first.out.match(/waiting for a browser slot \(hook exit (\d+)\)/);
    if (slot) {
      t.skip(`browser slot hook exit ${slot[1]} (resume render)`);
      return null;
    }
    const batches = listBatches(r.data).map((id) => readBatch(r.data, id)).filter((b) => b.kind === 'apply');
    assert.equal(batches.length, 1, `one apply batch from the scheduled run:\n${first.out}`);
    const batch = batches[0];
    assert.equal(batch.items.length, JOBS.length, `every pipeline row is in the batch: ${JSON.stringify(batch.items.map((i) => i.link))}`);

    const ap = approve(r, batch.id);
    assert.equal(ap.code, 0, ap.text);
    const approvedItems = batch.items.map((_, i) => i + 1).filter((n) => n !== EXCLUDED);

    const open = await openChrome({ root: r.root, dataDir: r.data, env });
    opened = true;
    if (open.skip) {
      t.skip(open.skip);
      return null;
    }
    assert.equal(open.code, 0, open.stdout + open.stderr);

    const submits = [];
    for (const n of approvedItems) {
      const item = batch.items[n - 1];
      const fill = await runChromeCli(['fill', '--plan', item.plan], { root: r.root, dataDir: r.data, env });
      assert.equal(fill.code, 0, `fill item ${n}: ${fill.stdout}${fill.stderr}`);
      submits.push({ n, ...(await runChromeCli(['submit', '--batch-id', batch.id, '--item', String(n)], { root: r.root, dataDir: r.data, env })) });
    }
    // The excluded item's form is filled too, so only the approval stands between it and the Submit click.
    const out = batch.items[EXCLUDED - 1];
    if (out.plan) await runChromeCli(['fill', '--plan', out.plan], { root: r.root, dataDir: r.data, env });
    const excludedSubmit = await runChromeCli(['submit', '--batch-id', batch.id, '--item', String(EXCLUDED)], { root: r.root, dataDir: r.data, env });
    const received = ats.submissions().map((s) => s.job);

    await stopAll({ root: r.root, dataDir: r.data, env });
    opened = false;
    const next = await scheduled(r, childEnv);
    const digestFile = join(r.data, 'digest', `student-${batch.date}.md`);
    const digest = existsSync(digestFile) ? readFileSync(digestFile, 'utf8') : '';
    return { r, batch, approvedItems, messages, submits, excludedSubmit, received, digest, next, log: await logRows(r) };
  } finally {
    if (opened) await stopAll({ root: r.root, dataDir: r.data, env });
    await ats.close();
    r.cleanup();
    rmSync(home, { recursive: true, force: true });
  }
}

// M-007-S1-osdr
test('[e2e] M-007-S1-osdr full fake-student cycle: every setup message carries Next, Type and Why, only approved items reach the mock server and the digest lists them', async (t) => {
  const checkSetup = (messages) => {
    assert.equal(messages.length, 2);
    for (const [i, m] of messages.entries()) {
      const lines = m.split('\n').map(guidedLine);
      for (const p of GUIDED) assert.ok(lines.some((l) => l.startsWith(p)), `setup message ${i + 1} has no ${p} line:\n${m}`);
    }
  };
  const c = await runCycle(t, { onSetup: checkSetup });
  if (!c) return;
  const approval = c.log.filter((x) => x.action === 'batch.approve' && x.detail.includes(`batch=${c.batch.id};`));
  assert.equal(approval.length, 1, 'one logged approval');
  assert.match(approval[0].detail, /items=1,3(;|$)/);
  for (const s of c.submits) assert.equal(s.code, 0, `submit item ${s.n}: ${s.stdout}${s.stderr}`);
  const expected = [JOBS[0].job, JOBS[2].job];
  assert.deepEqual([...c.received].sort((a, b) => a - b), expected, 'exactly the approved items reached the mock server');
  assert.deepEqual(c.approvedItems.map((n) => jobOf(c.batch.items[n - 1].link)).sort((a, b) => a - b), expected);
  const applied = [...c.digest.matchAll(/^- applied: (\d+)/gm)].map((m) => Number(m[1]));
  assert.ok(applied.length >= 1, `the digest has an applied line:\n${c.digest}`);
  assert.equal(applied.at(-1), 2, `the digest counts the 2 submitted applications:\n${c.digest}`);
});

// M-007-S3-osdr
test('[e2e] M-007-S3-osdr the e2e cycle skips with a named reason when no Chrome binary exists', async () => {
  const empty = mkdtempSync(join(tmpdir(), 'pack-live-mock-nochrome-'));
  const root = mkdtempSync(join(tmpdir(), 'pack-live-mock-root-'));
  mkdirSync(join(root, 'config'));
  writeFileSync(join(root, 'config', 'student.yml'), 'timezone: America/Chicago\n');
  // Linux finds Chrome only on PATH, so an empty PATH is a machine without a Chrome binary on every host OS.
  const saved = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { ...saved, value: 'linux' });
  const skips = [];
  let result;
  try {
    const env = { PATH: empty, BROWSER_SLOT_CMD: 'true', [ROOT_ENV]: root };
    result = await runCycle({ skip: (why) => skips.push(why) }, { env });
  } finally {
    Object.defineProperty(process, 'platform', saved);
    rmSync(empty, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
  assert.equal(result, null, 'the cycle does not run');
  assert.equal(skips.length, 1, `one skip: ${JSON.stringify(skips)}`);
  assert.match(skips[0], /Chrome binary/i, `the reason names the missing binary: ${skips[0]}`);
});

// M-007-S4-osdr
test('[e2e] M-007-S4-osdr an unapproved item in the cycle never reaches the mock server', async (t) => {
  const c = await runCycle(t);
  if (!c) return;
  const excludedJob = jobOf(c.batch.items[EXCLUDED - 1].link);
  assert.equal(excludedJob, JOBS[EXCLUDED - 1].job);
  assert.notEqual(c.excludedSubmit.code, 0, `submit of the excluded item is refused: ${c.excludedSubmit.stdout}${c.excludedSubmit.stderr}`);
  assert.ok(!c.received.includes(excludedJob), `job ${excludedJob} never reached the mock server: ${JSON.stringify(c.received)}`);
  const spent = c.log.filter((x) => x.action === 'apply.submit' && x.detail.includes(`batch=${c.batch.id};`) && /item=2(;|$)/.test(x.detail));
  assert.deepEqual(spent, [], 'no apply.submit row for the excluded item');
});
