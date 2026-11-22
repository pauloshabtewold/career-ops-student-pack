// scripts/schedule.mjs, M-003 second fix round: the macOS hourly fresh-scan plist names stdout and stderr log files like
// the daily one, and the Windows hourly task script prints a marker once schtasks has created the task, before
// Set-ScheduledTask, so a settings failure is not reported as a failed create. Builders only; no schedule is loaded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFreshPlist, buildFreshTaskScript, HOURLY_CREATED } from '../../scripts/schedule.mjs';

test('the hourly plist writes stdout and stderr to data/logs', () => {
  const xml = buildFreshPlist({ nodePath: '/opt/example node/bin/node', root: '/Users/sample student/career-ops' });
  assert.match(xml, /<key>StandardOutPath<\/key>\s*<string>\/Users\/sample student\/career-ops\/data\/logs\/student-fresh\.out\.log<\/string>/);
  assert.match(xml, /<key>StandardErrorPath<\/key>\s*<string>\/Users\/sample student\/career-ops\/data\/logs\/student-fresh\.err\.log<\/string>/);
});

test('the hourly task script marks the created task before applying its settings', () => {
  const ps = buildFreshTaskScript({ nodePath: 'C:\\Program Files\\nodejs\\node.exe', root: 'C:\\Users\\Sample Student\\career-ops' });
  const marker = ps.indexOf(`Write-Output '${HOURLY_CREATED}'`);
  assert.ok(marker > ps.indexOf('schtasks.exe'), 'after the create');
  assert.ok(marker < ps.indexOf('Set-ScheduledTask'), 'before the settings');
});
