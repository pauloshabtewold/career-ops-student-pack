// scripts/schedule.mjs buildFreshTaskScript on a long OneDrive install path: /TR points at a short data\fresh-scan.cmd
// wrapper and stays under schtasks' 261 characters, a percent sign in a path is doubled inside the wrapper, and the task
// gets the daily task's battery settings through Set-ScheduledTask. Builders only; no task is registered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFreshTaskScript, TR_MAX } from '../../scripts/schedule.mjs';

const NODE = 'C:\\Program Files\\nodejs\\node.exe';
const LONG = 'C:\\Users\\samplestudent123\\OneDrive - Example State University\\Documents\\career-ops';
const trOf = (ps) => /\/TR "(.*)"$/m.exec(ps)[1];

test('the hourly task command stays under the schtasks limit on a long OneDrive path', () => {
  const ps = buildFreshTaskScript({ nodePath: NODE, root: LONG });
  assert.ok(trOf(ps).length <= TR_MAX, `${trOf(ps).length} characters`);
  assert.match(trOf(ps), /data\\fresh-scan\.cmd/);
  assert.match(ps, /Set-Content -LiteralPath '[^']*fresh-scan\.cmd' -Value '@"[^']*scheduled\.mjs" --fresh/);
});

test('the hourly task gets the battery settings of the daily task', () => {
  const ps = buildFreshTaskScript({ nodePath: NODE, root: LONG });
  assert.match(ps, /Set-ScheduledTask -TaskName 'career-ops-student-daily-fresh' -Settings \(New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries\)/);
  assert.ok(ps.indexOf('Set-ScheduledTask') > ps.indexOf('schtasks.exe'), 'settings are applied after the task exists');
});

test('a percent sign is doubled in the wrapper and an impossibly long path is refused with a clear message', () => {
  const ps = buildFreshTaskScript({ nodePath: NODE, root: 'C:\\Users\\Sample 100%\\career-ops' });
  assert.match(ps, /-Value '[^']*Sample 100%%/);
  assert.throws(() => buildFreshTaskScript({ nodePath: NODE, root: `C:\\${'a'.repeat(260)}` }), /shorter folder path/);
});
