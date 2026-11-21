// scripts/setup-flow.mjs on a fresh fixture install: every step it can do itself runs, and it stops only at the
// sign-in step with a Next/Type/Why block. Resume build, ATS check, automation Chrome and schedule are injected fakes,
// so no browser and no agent runs. Fake person only.
// deps used here (ruling): { buildResume, atsCheck, chrome, schedule, say }.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as yaml from 'js-yaml';

const CV = '# Jordan Testwell\n\njordan.testwell@example.com | 555-0100\n\n## Education\nB.S. Computer Science, Example State University, May 2027\n\n## Experience\n- Software Intern, Example Robotics, Jun 2025 - Aug 2025\n\n## Skills\nPython, SQL\n';

function freshInstall() {
  const root = mkdtempSync(join(tmpdir(), 'pack-setup-flow-'));
  mkdirSync(join(root, 'config'));
  writeFileSync(join(root, 'config', 'student.yml'), 'timezone: America/Chicago\nonboarding:\n  complete: true\npresets:\n  - software-cs\n');
  writeFileSync(join(root, 'config', 'profile.yml'), 'candidate:\n  full_name: "Jordan Testwell"\n  email: "jordan.testwell@example.com"\n');
  writeFileSync(join(root, 'cv.md'), CV);
  const dataDir = join(root, 'data');
  return { root, dataDir, paths: { root, dataDir, configDir: join(root, 'config'), modesDir: join(root, 'modes') }, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function fakeDeps(r) {
  const rec = { build: [], chrome: [], schedule: [], lines: [] };
  return {
    rec,
    deps: {
      buildResume: async (opts) => {
        rec.build.push(opts);
        const out = join(r.dataDir, 'resume');
        mkdirSync(out, { recursive: true });
        writeFileSync(join(out, 'resume.html'), '<html><body><h1>Jordan Testwell</h1></body></html>');
        writeFileSync(join(out, 'resume.pdf'), '%PDF-1.4\n%%EOF\n');
        return { html: join(out, 'resume.html'), pdf: join(out, 'resume.pdf') };
      },
      atsCheck: async () => ({ ok: true, problems: [] }),
      chrome: async (...args) => (rec.chrome.push(args), { code: 0 }),
      schedule: async (...args) => (rec.schedule.push(args), { code: 0 }),
      say: (...a) => rec.lines.push(a.join(' ')),
    },
  };
}

// M-002-S1-osdr
test('M-002-S1-osdr setup-flow on a fresh fixture install builds the resume and writes defaults itself and stops only at the sign-in step with a Next/Type/Why block', async () => {
  const { setupFlow, readSetupState } = await import('../../scripts/setup-flow.mjs');
  const r = freshInstall();
  try {
    const { rec, deps } = fakeDeps(r);
    await setupFlow({ paths: r.paths, flags: {}, today: '2026-11-03', deps });
    assert.equal(rec.build.length, 1, 'the resume is built by the flow itself');
    assert.ok(existsSync(join(r.dataDir, 'setup-state.json')), 'setup state written');
    const state = readSetupState(r.dataDir);
    assert.ok(state.resume, JSON.stringify(state));
    for (const site of ['LinkedIn', 'Gmail', 'Handshake']) assert.ok(!state.signins?.[site], `${site} sign-in is left to the student`);
    assert.equal(rec.schedule.length, 0, 'the flow stops at the sign-in step, before the schedule');

    const lines = rec.lines.flatMap((l) => l.split('\n')).filter((l) => l.trim());
    const next = lines.filter((l) => l.startsWith('Next:'));
    assert.equal(next.length, 1, lines.join('\n'));
    assert.match(next[0], /sign in/i);
    assert.equal(lines.filter((l) => l.startsWith('Type:')).length, 1, lines.join('\n'));
    assert.equal(lines.filter((l) => l.startsWith('Why:')).length, 1, lines.join('\n'));
  } finally {
    r.cleanup();
  }
});

// M-002-S33-osdr
test('M-002-S33-osdr setup-flow run with BROWSER_SLOT_CMD set writes that command to config browser.slot_cmd', async () => {
  const { setupFlow } = await import('../../scripts/setup-flow.mjs');
  const r = freshInstall();
  const saved = process.env.BROWSER_SLOT_CMD;
  process.env.BROWSER_SLOT_CMD = 'sh /fake/slot-check.sh';
  try {
    const { deps } = fakeDeps(r);
    await setupFlow({ paths: r.paths, flags: {}, today: '2026-11-03', deps });
    const config = yaml.load(readFileSync(join(r.root, 'config', 'student.yml'), 'utf8'));
    assert.equal(config.browser?.slot_cmd, 'sh /fake/slot-check.sh');
    assert.equal(config.timezone, 'America/Chicago', 'other keys kept');
  } finally {
    if (saved === undefined) delete process.env.BROWSER_SLOT_CMD;
    else process.env.BROWSER_SLOT_CMD = saved;
    r.cleanup();
  }
});
