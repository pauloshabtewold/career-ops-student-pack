// Assumed: scripts/schedule.mjs exports
//   buildPlist({ nodePath, root, time }) -> plist XML text; time is 'HH:MM'
//   buildTaskScript({ nodePath, root, time }) -> PowerShell text
// and runs as a CLI: `schedule.mjs install|remove|status [--time HH:MM] [--dry-run] [--root R]`.
// --dry-run prints the artifact for the current platform and never starts launchctl or powershell.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { buildPlist, buildTaskScript } from '../../scripts/schedule.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const NODE = '/opt/example node/bin/node';
const ROOT = '/Users/sample student/career-ops';

// M-008-S1
test('M-008-S1 buildPlist holds the label, absolute node path, WorkingDirectory and daily script', () => {
  const xml = buildPlist({ nodePath: NODE, root: ROOT, time: '07:30' });
  assert.match(xml, /^<\?xml/);
  assert.match(xml, /<key>Label<\/key>\s*<string>com\.career-ops\.student\.daily<\/string>/);
  assert.ok(xml.includes(`<string>${NODE}</string>`), 'absolute node path is its own argument');
  assert.match(xml, /<string>[^<]*student[\\/]scripts[\\/]scheduled\.mjs<\/string>/);
  assert.match(xml, new RegExp(`<key>WorkingDirectory</key>\\s*<string>${ROOT.replace(/[/\\]/g, '[/\\\\]')}</string>`));
});

// M-008-S1
test('M-008-S1 buildPlist sets StartCalendarInterval Hour and Minute from the configured time', () => {
  const xml = buildPlist({ nodePath: NODE, root: ROOT, time: '07:30' });
  assert.match(xml, /<key>StartCalendarInterval<\/key>/);
  assert.match(xml, /<key>Hour<\/key>\s*<integer>7<\/integer>/);
  assert.match(xml, /<key>Minute<\/key>\s*<integer>30<\/integer>/);
  const other = buildPlist({ nodePath: NODE, root: ROOT, time: '21:05' });
  assert.match(other, /<key>Hour<\/key>\s*<integer>21<\/integer>/);
  assert.match(other, /<key>Minute<\/key>\s*<integer>5<\/integer>/);
});

// M-008-S1
test('M-008-S1 buildPlist puts stdout and stderr logs under data/logs', () => {
  const xml = buildPlist({ nodePath: NODE, root: ROOT, time: '07:30' });
  const out = /<key>StandardOutPath<\/key>\s*<string>([^<]+)<\/string>/.exec(xml);
  const err = /<key>StandardErrorPath<\/key>\s*<string>([^<]+)<\/string>/.exec(xml);
  assert.ok(out && err, 'both log keys present');
  for (const p of [out[1], err[1]]) {
    assert.ok(p.startsWith(ROOT), p);
    assert.match(p, /data[\\/]logs[\\/]/);
  }
});

const WIN_NODE = 'C:\\Program Files\\nodejs\\node.exe';
const WIN_ROOT = 'C:\\Users\\Sample Student\\career-ops';

// M-008-S2
test('M-008-S2 buildTaskScript registers career-ops-student-daily with the battery and catch-up switches', () => {
  const ps = buildTaskScript({ nodePath: WIN_NODE, root: WIN_ROOT, time: '07:30' });
  assert.match(ps, /Register-ScheduledTask/);
  assert.match(ps, /-TaskName\s+['"]?career-ops-student-daily['"]?/);
  assert.match(ps, /-Force/);
  assert.match(ps, /New-ScheduledTaskSettingsSet/);
  for (const sw of ['-StartWhenAvailable', '-AllowStartIfOnBatteries', '-DontStopIfGoingOnBatteries']) {
    assert.ok(ps.includes(sw), sw);
  }
  assert.match(ps, /New-ScheduledTaskTrigger\s+-Daily\s+-At\s+['"]?07:30['"]?/);
});

// M-008-S2
test('M-008-S2 buildTaskScript quotes the absolute node and root paths that contain spaces', () => {
  const ps = buildTaskScript({ nodePath: WIN_NODE, root: WIN_ROOT, time: '07:30' });
  const esc = (s) => s.replace(/[\\.]/g, '\\$&');
  assert.match(ps, /New-ScheduledTaskAction/);
  assert.match(ps, new RegExp(`-Execute\\s+['"]${esc(WIN_NODE)}['"]`));
  assert.match(ps, new RegExp(`-WorkingDirectory\\s+['"]${esc(WIN_ROOT)}['"]`));
  assert.match(ps, /scheduled\.mjs/);
  assert.match(ps, /data[\\/]+logs/);
});

// M-008-S3
test('M-008-S3 install --dry-run prints the artifact and starts no launchctl or powershell process', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'sched-'));
  try {
    const bin = join(tmp, 'bin');
    const home = join(tmp, 'home');
    const marker = join(tmp, 'spawned.txt');
    mkdirSync(bin);
    mkdirSync(home);
    for (const name of ['launchctl', 'powershell', 'powershell.exe', 'pwsh']) {
      const f = join(bin, name);
      writeFileSync(f, `#!/bin/sh\necho ${name} >> "${marker}"\n`);
      chmodSync(f, 0o755);
    }
    const out = spawnSync(process.execPath, [join(PACK_ROOT, 'scripts', 'schedule.mjs'), 'install', '--dry-run', '--time', '07:30', '--root', tmp], {
      cwd: PACK_ROOT,
      encoding: 'utf8',
      timeout: 60000,
      env: { ...process.env, HOME: home, USERPROFILE: home, PATH: `${bin}${delimiter}${process.env.PATH}` },
    });
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /com\.career-ops\.student\.daily|career-ops-student-daily/);
    assert.ok(out.stdout.includes(tmp), 'artifact names the root');
    assert.equal(existsSync(marker), false, 'no launchctl or powershell process was started');
    assert.equal(existsSync(join(home, 'Library', 'LaunchAgents')), false, 'dry run writes no plist');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
