// M-007 fix round 2, N2-2, in a real automation Chrome on the local mock Greenhouse form only: an item planned while the
// automation Chrome was closed (no form read, so no fields, no letter and no uploads, and the batch line says "form not
// read yet") is approved, chrome.mjs submit refuses it before any click, then chrome.mjs read-form, fill-plan --replan,
// chrome.mjs fill and chrome.mjs submit send it with the typed values, the resume and the cover letter. The model is a
// fake claude on PATH; the resume render is the fake generate-pdf stand-in of live-mock. The browser goes through
// chrome-harness (browser slot gate); BROWSER_SLOT_CMD=false makes the test skip. Fake data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { listBatches, readBatch } from '../../lib/batch-file.mjs';
import { gate, openChrome, runChromeCli, stopAll, ROOT_ENV } from '../helpers/chrome-harness.mjs';
import { startMockAts } from '../helpers/mock-ats-server.mjs';
import { PACK_ROOT, makeRoot } from '../helpers/script-harness.mjs';

const CV = '# Riley Placeholder\n\nriley.placeholder@example.com | 555-0100\n\n## Education\nB.S. Computer Science, Example State University, May 2027\n\n## Experience\n- Software Intern, Example Robotics, Jun 2025 - Aug 2025: built a Python scheduling tool\n\n## Skills\nPython, SQL\n';
const PROFILE = 'candidate:\n  full_name: "Riley Placeholder"\n  email: "riley.placeholder@example.com"\n  phone: "555-0100"\n';
const CONFIG = 'onboarding:\n  complete: true\npresets:\n  - software-cs\ndaily_target: 5\nscore_floor: 3.0\nagent: claude\n';
const PARAGRAPH = 'As a Software Intern at Example Robotics I built a Python scheduling tool, and I would like to keep building tools like it.';
const POSTING = 'Example Robotics hires a Software Engineering Intern to build Python scheduling tools. Requirements: Python and SQL.';
const JOB = 43;

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

test('[e2e] N2-2 an item planned while Chrome was closed: approve -> submit refused -> read-form -> replan -> fill -> submit with the letter', async (t) => {
  const reason = await gate();
  if (reason) {
    t.skip(reason);
    return;
  }
  const ats = await startMockAts();
  const r = fixture();
  const home = mkdtempSync(join(tmpdir(), 'pack-replan-home-'));
  const env = { ...process.env, [ROOT_ENV]: r.root };
  const agentEnv = { ...env, PATH: agentPath(fakeAgentBin(home), process.env), HOME: home, USERPROFILE: home };
  const link = `${ats.url}/greenhouse/form?job=${JOB}`;
  let opened = false;
  try {
    // Planned with the automation Chrome closed: no form was read.
    writeFileSync(join(r.root, 'rows.json'), JSON.stringify([{ url: link, company: 'Example Robotics', title: 'Software Engineering Intern', score: 41, triage: 3.8, jobText: POSTING }]));
    const plan = node('fill-plan.mjs', ['--rows', join(r.root, 'rows.json')], r, agentEnv);
    // The resume render is a browser launch too, so a slot hook that said no there is the same skip as at chrome.mjs open.
    if (plan.code === 4 && /waiting for a browser slot/.test(plan.text)) {
      t.skip('browser slot said no at the resume render');
      return;
    }
    assert.equal(plan.code, 0, plan.text);
    const [id] = listBatches(r.data).filter((b) => readBatch(r.data, b).kind === 'apply');
    assert.ok(id, `an apply batch: ${plan.text}`);
    const item = readBatch(r.data, id).items[0];
    assert.match(item.preview, /^form not read yet/);
    const before = JSON.parse(readFileSync(item.plan, 'utf8'));
    assert.deepEqual([before.fields.length, before.cover], [0, null]);

    const ap = node('batch.mjs', ['approve', id, 'approve all'], r, agentEnv);
    assert.equal(ap.code, 0, ap.text);
    const early = await runChromeCli(['submit', '--batch-id', id, '--item', '1'], { root: r.root, dataDir: r.data, env });
    assert.equal(early.code, 3, early.stdout + early.stderr);
    assert.match(early.stdout + early.stderr, /read the form first/);

    const open = await openChrome({ root: r.root, dataDir: r.data, env });
    opened = true;
    if (open.skip) {
      t.skip(open.skip);
      return;
    }
    assert.equal(open.code, 0, open.stdout + open.stderr);
    const read = await runChromeCli(['read-form', '--url', link], { root: r.root, dataDir: r.data, env });
    assert.equal(read.code, 0, read.stdout + read.stderr);
    const replan = node('fill-plan.mjs', ['--replan', '--batch-id', id, '--item', '1'], r, agentEnv);
    assert.equal(replan.code, 0, replan.text);
    const after = JSON.parse(readFileSync(item.plan, 'utf8'));
    assert.equal(after.link, link);
    assert.ok(after.cover && existsSync(after.cover), `a cover letter after the replan: ${replan.text}`);
    assert.deepEqual(after.uploads.map((u) => u.selector).sort(), ['#cover_letter', '#resume']);

    const fill = await runChromeCli(['fill', '--plan', item.plan], { root: r.root, dataDir: r.data, env });
    assert.equal(fill.code, 0, fill.stdout + fill.stderr);
    const submit = await runChromeCli(['submit', '--batch-id', id, '--item', '1'], { root: r.root, dataDir: r.data, env });
    assert.equal(submit.code, 0, submit.stdout + submit.stderr);

    const [post] = ats.posted();
    assert.equal(post?.job, JOB, JSON.stringify(ats.posted()));
    assert.equal(post.fields.first_name, 'Riley');
    assert.equal(post.fields.email, 'riley.placeholder@example.com');
    assert.ok(post.files.resume?.endsWith('.pdf'), JSON.stringify(post.files));
    assert.ok(post.files.cover_letter, `the cover letter reached the server: ${JSON.stringify(post.files)}`);
  } finally {
    if (opened) await stopAll({ root: r.root, dataDir: r.data, env });
    await ats.close();
    r.cleanup();
    rmSync(home, { recursive: true, force: true });
  }
});
