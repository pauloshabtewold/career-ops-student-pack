// M-007 fix round 1, M-1, in a real automation Chrome on the local mock Greenhouse form only: chrome.mjs read-form saves
// the form fields with their selectors, fill-plan (no --fields-dir, so its session default data/form-fields) builds a
// plan with those selectors, a cover letter and the resume upload, the batch is approved, chrome.mjs fill types the
// values and attaches both files, and chrome.mjs submit reaches the mock server, which records the typed values and the
// file names. The model is a fake claude on PATH; the resume render is the fake generate-pdf stand-in of live-mock. The
// browser goes through chrome-harness (browser slot gate); BROWSER_SLOT_CMD=false makes the test skip. Fake data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FIELDS_DIR, formFieldsFile } from '../../lib/ats-fields.mjs';
import { listBatches, readBatch } from '../../lib/batch-file.mjs';
import { gate, openChrome, runChromeCli, stopAll, ROOT_ENV } from '../helpers/chrome-harness.mjs';
import { startMockAts } from '../helpers/mock-ats-server.mjs';
import { PACK_ROOT, makeRoot } from '../helpers/script-harness.mjs';

const CV = '# Riley Placeholder\n\nriley.placeholder@example.com | 555-0100\n\n## Education\nB.S. Computer Science, Example State University, May 2027\n\n## Experience\n- Software Intern, Example Robotics, Jun 2025 - Aug 2025: built a Python scheduling tool\n\n## Skills\nPython, SQL\n';
const PROFILE = 'candidate:\n  full_name: "Riley Placeholder"\n  email: "riley.placeholder@example.com"\n  phone: "555-0100"\n';
const CONFIG = 'onboarding:\n  complete: true\npresets:\n  - software-cs\ndaily_target: 5\nscore_floor: 3.0\nagent: claude\n';
// The fake model's only reply: a cover paragraph built from cv.md facts.
const PARAGRAPH = 'As a Software Intern at Example Robotics I built a Python scheduling tool, and I would like to keep building tools like it.';
const JOB = 41;

function fakeAgentBin(dir) {
  const bin = join(dir, 'fake-bin');
  mkdirSync(bin, { recursive: true });
  const reply = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: PARAGRAPH, usage: { input_tokens: 1, output_tokens: 1 } });
  writeFileSync(join(bin, 'fake-agent.mjs'), `import { readFileSync } from 'node:fs';\ntry { readFileSync(0); } catch {}\nprocess.stdout.write(${JSON.stringify(reply)});\n`);
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\nexec node "$(dirname "$0")/fake-agent.mjs" "$@"\n');
  chmodSync(join(bin, 'claude'), 0o755);
  writeFileSync(join(bin, 'claude.cmd'), '@echo off\r\nnode "%~dp0fake-agent.mjs" %*\r\n');
  return bin;
}

function agentPath(bin, env) {
  const hasClaude = (d) => ['claude', 'claude.cmd', 'claude.exe'].some((n) => existsSync(join(d, n)));
  const rest = String(env.PATH ?? env.Path ?? '').split(delimiter).filter((d) => d && !hasClaude(d));
  return [bin, dirname(process.execPath), ...rest].join(delimiter);
}

function fixture() {
  const r = makeRoot({ config: CONFIG });
  r.write('config/profile.yml', PROFILE);
  r.write('cv.md', CV);
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
  return r;
}

const node = (script, args, r, env) => {
  const res = spawnSync(process.execPath, [join(PACK_ROOT, 'scripts', script), ...args, '--root', r.root, '--data-dir', r.data], { cwd: PACK_ROOT, env, encoding: 'utf8', timeout: 120000 });
  return { code: res.status, text: `${res.stdout ?? ''}${res.stderr ?? ''}` };
};

test('[e2e] M-1 read-form on the mock form -> fill-plan -> plan with selectors, letter and resume -> fill -> submit carries the typed values', async (t) => {
  const reason = await gate();
  if (reason) {
    t.skip(reason);
    return;
  }
  const ats = await startMockAts();
  const r = fixture();
  const home = mkdtempSync(join(tmpdir(), 'pack-read-form-home-'));
  // Chrome runs with the real HOME (as in live-mock): a fresh HOME can stall its first navigation on macOS. Only the
  // script children that may call a model get the fake-agent PATH and the scratch HOME.
  const env = { ...process.env, [ROOT_ENV]: r.root };
  const agentEnv = { ...env, PATH: agentPath(fakeAgentBin(home), process.env), HOME: home, USERPROFILE: home };
  const formUrl = `${ats.url}/greenhouse/form?job=${JOB}`;
  let opened = false;
  try {
    const open = await openChrome({ root: r.root, dataDir: r.data, env });
    opened = true;
    if (open.skip) {
      t.skip(open.skip);
      return;
    }
    assert.equal(open.code, 0, open.stdout + open.stderr);

    const read = await runChromeCli(['read-form', '--url', formUrl], { root: r.root, dataDir: r.data, env });
    assert.equal(read.code, 0, read.stdout + read.stderr);
    const saved = JSON.parse(readFileSync(formFieldsFile(join(r.data, FIELDS_DIR), formUrl), 'utf8'));
    assert.equal(saved.url, formUrl);
    assert.ok(saved.fields.every((f) => f.selector), JSON.stringify(saved.fields));
    assert.ok(['first_name', 'last_name', 'email', 'resume', 'cover_letter'].every((id) => saved.fields.some((f) => f.id === id)), JSON.stringify(saved.fields));
    assert.deepEqual(ats.submissions(), [], 'read-form sends nothing');

    writeFileSync(join(r.root, 'rows.json'), JSON.stringify([{ url: formUrl, company: 'Example Robotics', title: 'Software Engineering Intern', score: 46, triage: 4.6 }]));
    const plan = node('fill-plan.mjs', ['--rows', join(r.root, 'rows.json')], r, agentEnv);
    assert.equal(plan.code, 0, plan.text);
    const [id] = listBatches(r.data).filter((b) => readBatch(r.data, b).kind === 'apply');
    assert.ok(id, `an apply batch: ${plan.text}`);
    const item = readBatch(r.data, id).items[0];
    const p = JSON.parse(readFileSync(item.plan, 'utf8'));
    const typed = Object.fromEntries(p.fields.filter((f) => !f.slot && f.value !== undefined).map((f) => [f.selector, f.value]));
    assert.equal(typed['#first_name'], 'Riley');
    assert.equal(typed['#last_name'], 'Placeholder');
    assert.equal(typed['#email'], 'riley.placeholder@example.com');
    assert.ok(p.cover && existsSync(p.cover), `cover letter written: ${plan.text}`);
    assert.deepEqual(p.uploads.map((u) => u.selector).sort(), ['#cover_letter', '#resume']);

    const ap = node('batch.mjs', ['approve', id, 'approve all'], r, agentEnv);
    assert.equal(ap.code, 0, ap.text);
    const fill = await runChromeCli(['fill', '--plan', item.plan], { root: r.root, dataDir: r.data, env });
    assert.equal(fill.code, 0, fill.stdout + fill.stderr);
    const submit = await runChromeCli(['submit', '--batch-id', id, '--item', '1'], { root: r.root, dataDir: r.data, env });
    assert.equal(submit.code, 0, submit.stdout + submit.stderr);

    const [post] = ats.posted();
    assert.equal(post?.job, JOB, JSON.stringify(ats.posted()));
    assert.equal(post.fields.first_name, 'Riley');
    assert.equal(post.fields.last_name, 'Placeholder');
    assert.equal(post.fields.email, 'riley.placeholder@example.com');
    assert.equal(post.fields.phone, '555-0100');
    assert.ok(post.files.resume?.endsWith('.pdf'), JSON.stringify(post.files));
    assert.ok(post.files.cover_letter, `the cover letter reached the server: ${JSON.stringify(post.files)}`);
  } finally {
    if (opened) await stopAll({ root: r.root, dataDir: r.data, env });
    await ats.close();
    r.cleanup();
    rmSync(home, { recursive: true, force: true });
  }
});
