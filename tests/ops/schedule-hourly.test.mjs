// scripts/schedule.mjs hourly fresh-scan entry next to the daily one: buildFreshPlist (launchd StartInterval 3600) and
// buildFreshTaskScript (schtasks /SC HOURLY) start scheduled.mjs --fresh, and install writes both entries. The install
// part runs on macOS only, with a fake launchctl on PATH and a temp HOME, so no real schedule is loaded; on other hosts
// only the builders are checked (a win32 install would register a real scheduled task).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const NODE = '/opt/example node/bin/node';
const ROOT = '/Users/sample student/career-ops';
const WIN_NODE = 'C:\\Program Files\\nodejs\\node.exe';
const WIN_ROOT = 'C:\\Users\\Sample Student\\career-ops';

// M-003-S3-osdr
test('M-003-S3-osdr schedule install writes both the daily and the hourly entry', async () => {
  const sched = await import('../../scripts/schedule.mjs');
  assert.equal(sched.FRESH_LABEL, 'com.career-ops.student.daily.fresh');
  assert.equal(sched.FRESH_TASK_NAME, 'career-ops-student-daily-fresh');
  assert.equal(typeof sched.buildFreshPlist, 'function', 'schedule.mjs exports buildFreshPlist');
  assert.equal(typeof sched.buildFreshTaskScript, 'function', 'schedule.mjs exports buildFreshTaskScript');

  const xml = sched.buildFreshPlist({ nodePath: NODE, root: ROOT });
  assert.match(xml, /<key>Label<\/key>\s*<string>com\.career-ops\.student\.daily\.fresh<\/string>/);
  assert.match(xml, /<key>StartInterval<\/key>\s*<integer>3600<\/integer>/);
  assert.doesNotMatch(xml, /StartCalendarInterval/);
  assert.ok(xml.includes(`<string>${NODE}</string>`));
  assert.match(xml, /<string>[^<]*student[\\/]scripts[\\/]scheduled\.mjs<\/string>/);
  assert.match(xml, /<string>--fresh<\/string>/);

  const ps = sched.buildFreshTaskScript({ nodePath: WIN_NODE, root: WIN_ROOT });
  assert.match(ps, /career-ops-student-daily-fresh/);
  assert.match(ps, /\/SC\s+HOURLY/i);
  assert.match(ps, /scheduled\.mjs/);
  assert.match(ps, /--fresh/);

  if (process.platform !== 'darwin') return;
  const tmp = mkdtempSync(join(tmpdir(), 'sched-hourly-'));
  try {
    const home = join(tmp, 'home');
    const bin = join(tmp, 'bin');
    const root = join(tmp, 'career-ops');
    const agents = join(home, 'Library', 'LaunchAgents');
    for (const d of [bin, join(root, 'config'), agents]) mkdirSync(d, { recursive: true });
    symlinkSync(PACK_ROOT, join(root, 'student'), 'dir');
    writeFileSync(join(root, 'config', 'student.yml'), 'timezone: America/Chicago\nautomation: scheduled-discovery\n');
    writeFileSync(join(bin, 'launchctl'), `#!/bin/sh\necho "$@" >> ${JSON.stringify(join(tmp, 'launchctl.log'))}\nexit 0\n`);
    chmodSync(join(bin, 'launchctl'), 0o755);
    const res = spawnSync(process.execPath, [join(PACK_ROOT, 'scripts', 'schedule.mjs'), 'install', '--time', '07:30', '--root', root], {
      cwd: PACK_ROOT,
      encoding: 'utf8',
      timeout: 60000,
      env: { ...process.env, HOME: home, USERPROFILE: home, PATH: `${bin}${delimiter}${process.env.PATH}` },
    });
    assert.equal(res.status, 0, res.stdout + res.stderr);
    const daily = join(agents, 'com.career-ops.student.daily.plist');
    const fresh = join(agents, 'com.career-ops.student.daily.fresh.plist');
    assert.ok(existsSync(daily), 'the daily entry is written');
    assert.ok(existsSync(fresh), 'the hourly fresh-scan entry is written');
    assert.match(readFileSync(daily, 'utf8'), /StartCalendarInterval/);
    const freshXml = readFileSync(fresh, 'utf8');
    assert.match(freshXml, /<key>StartInterval<\/key>\s*<integer>3600<\/integer>/);
    assert.match(freshXml, /<string>--fresh<\/string>/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
