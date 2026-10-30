// merge-post takes today from the config timezone unless --today is given.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createClock } from '../../lib/clock.mjs';
import { makeRoot, script, line, pipelineText, jobUrl, PACK_ROOT } from '../helpers/script-harness.mjs';

function setup(configText) {
  const r = makeRoot();
  r.write('config/student.yml', configText);
  r.write('data/pipeline.md', pipelineText({}));
  r.write('data/pipeline.staging.md', `${line(jobUrl(1), 'Example Robotics', 'Data Intern', 'Austin, TX', 'src=handshake')}\n`);
  r.write('data/applications.md', '# Applications\n');
  r.write('data/blacklist.md', '');
  r.write('data/scan-history.tsv', 'first_seen\turl\tportal\ttitle\tcompany\tstatus\n');
  return r;
}

const merge = (r, extra, env = {}) => {
  const out = spawnSync(process.execPath, [script('merge-post'), '--root', r.root, '--data-dir', r.data, ...extra], { cwd: PACK_ROOT, encoding: 'utf8', env: { ...process.env, ...env } });
  return { code: out.status, stderr: out.stderr ?? '' };
};
const firstSeen = (r) => r.read('data/scan-history.tsv').trim().split('\n').slice(1).map((l) => l.split('\t')[0]);

// M-001-S2
test('M-001-S2 first_seen is the config-timezone date, not the host-zone date', () => {
  const r = setup('timezone: Pacific/Pago_Pago\n');
  try {
    const zone = { timezone: 'Pacific/Pago_Pago' };
    const before = createClock(zone).today();
    const out = merge(r, [], { TZ: 'Pacific/Kiritimati' });
    const after = createClock(zone).today();
    assert.equal(out.code, 0, out.stderr);
    const [seen] = firstSeen(r);
    assert.ok(seen === before || seen === after, `first_seen ${seen}, expected ${before} or ${after}`);
    assert.notEqual(seen, createClock({ timezone: 'Pacific/Kiritimati' }).today());
  } finally {
    r.cleanup();
  }
});

// M-001-S8
test('M-001-S8 --today keeps that date and never reads an unparsable student.yml', () => {
  const r = setup('timezone: [unclosed\n  : : :\n');
  try {
    const out = merge(r, ['--today', '2026-03-10']);
    assert.equal(out.code, 0, out.stderr);
    assert.deepEqual(firstSeen(r), ['2026-03-10']);
  } finally {
    r.cleanup();
  }
});
