// M-007 fix round 1, S-6: the five student-facing lines that handed the student a command now offer "I'll ...,
// approve?" with the exact reply. The digest and setup lines are checked through their code; the three schedule lines
// are checked in the source, since reaching them needs a whole triage or daily run. Fake data only, no agent or browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { summaryLines } from '../../lib/digest.mjs';
import { setupFlow } from '../../scripts/setup-flow.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

test('S-6 the digest offers to open the automation Chrome instead of handing over the command', () => {
  const text = summaryLines({ waitingChrome: ['submitting approved applications'], chromeInSchedule: 'yes' }).join('\n');
  assert.match(text, /waiting for Chrome: submitting approved applications; I'll open the automation Chrome and run them, approve\? Type: open my automation Chrome/);
  assert.ok(!/open it with node/.test(text), text);
});

test('S-6 setup offers to move a broken profile.yml aside and rebuild it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pack-m007-wording-'));
  try {
    mkdirSync(join(root, 'config'));
    writeFileSync(join(root, 'config', 'student.yml'), 'timezone: America/Chicago\n');
    writeFileSync(join(root, 'config', 'profile.yml'), 'candidate: [unclosed\n');
    const lines = [];
    await setupFlow({ paths: { root, dataDir: join(root, 'data') }, flags: { slotCmd: '' }, today: '2026-11-03', deps: { say: (l) => lines.push(String(l)) } });
    const line = lines.find((l) => /profile\.yml could not be read/.test(l)) ?? '';
    assert.match(line, /I'll move the broken profile\.yml aside and rebuild it from your answers, approve\? Type: rebuild my profile/);
    assert.ok(!/fix it or move it aside/.test(line), line);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('S-6 the schedule lines offer to reinstall the schedule with the exact reply', () => {
  const src = (f) => readFileSync(join(PACK_ROOT, 'scripts', f), 'utf8');
  const triage = src('daily-triage.mjs');
  assert.ok(/agent changed to \$\{configured\}[^`]*I'll reinstall the schedule for you, approve\? Type: reinstall my schedule/.test(triage), 'agent-changed line');
  assert.ok(/was not found;[^`]*I'll reinstall the schedule \(node student\/scripts\/schedule\.mjs install\), approve\? Type: reinstall my schedule/.test(triage), 'agent-missing line');
  assert.ok(/this run did not triage:[^"]*I'll reinstall the schedule \(node student\/scripts\/schedule\.mjs install\), approve\? Type: reinstall my schedule/.test(src('daily.mjs')), 'older-schedule line');
});
