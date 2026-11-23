// M-007 fix round 1, M-3: scripts/gmail.mjs send and reply, the session entry to lib/gmail-chrome.mjs. The browser is a
// fake that records any call and answers 'sent' (send) or a message (reply); budget.mjs runs for real on a scratch pack.
// No Gmail page, browser or agent is reached. Synthetic names and example.com addresses only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { writeBatches } from '../../lib/batch-file.mjs';
import { emailOf, main } from '../../scripts/gmail.mjs';
import { makePack, readLog } from '../helpers/budget-harness.mjs';
import { A, ACME, EMAIL, OB, approve, realToday } from '../helpers/outreach-harness.mjs';

const TEXT = 'Hello Contact,\n\nThanks for the chat about the campus team.\n\nBest regards,\nSam Placeholder';

async function pack(items = '1') {
  const p = await makePack();
  const [id] = writeBatches(p.dataDir, {
    date: OB.slice(0, 10),
    kind: 'outreach',
    items: [1, 2].map(() => ({ company: ACME, role: `${A} (warm-opener, email to ${EMAIL[A]})`, score: null, preview: TEXT, link: '', message: TEXT, action: 'warm-opener', channel: 'email', target: A, to: EMAIL[A], subject: 'Hello' })),
  });
  assert.equal(id, OB);
  approve(p, items, { today: realToday() });
  return p;
}

const recorder = (answer) => {
  const calls = [];
  return { calls, browser: async (port) => (calls.push(port), answer) };
};

const cli = (p, args, deps) => {
  const said = [];
  return main([...args, '--root', p.root, '--data-dir', p.dataDir], { chromeState: async () => ({ port: 9 }), say: (l) => said.push(String(l)), ...deps }).then((code) => ({ code, text: said.join('\n') }));
};

test('M-3 gmail.mjs send on an approved email item exits 0 and logs gmail.pending before gmail.send', async () => {
  const p = await pack('1');
  try {
    const b = recorder('sent');
    const res = await cli(p, ['send', '--batch-id', OB, '--item', '1'], { browser: b.browser });
    assert.equal(res.code, 0, res.text);
    assert.equal(b.calls.length, 1, 'one compose-and-send');
    const actions = (await readLog(p)).map((r) => r.action).filter((a) => a.startsWith('gmail.'));
    assert.deepEqual(actions, ['gmail.pending', 'gmail.send']);
    assert.ok(existsSync(join(p.dataDir, 'threads')) && readdirSync(join(p.dataDir, 'threads')).length === 1, 'the sent email is kept in the thread file');
  } finally {
    p.cleanup();
  }
});

test('M-3 gmail.mjs send on an item left out of the approval exits 3 and never opens the browser', async () => {
  const p = await pack('1');
  try {
    const b = recorder('sent');
    const res = await cli(p, ['send', '--batch-id', OB, '--item', '2'], { browser: b.browser });
    assert.equal(res.code, 3, res.text);
    assert.equal(b.calls.length, 0, 'no click');
    assert.ok(!(await readLog(p)).some((r) => r.action.startsWith('gmail.')), 'nothing logged');
  } finally {
    p.cleanup();
  }
});

test('M-3 gmail.mjs exits 7 when the automation Chrome is not running, and 2 without its ids', async () => {
  const p = await pack('1');
  try {
    const res = await cli(p, ['send', '--batch-id', OB, '--item', '1'], { chromeState: async () => null, browser: async () => assert.fail('no browser') });
    assert.equal(res.code, 7, res.text);
    await assert.rejects(cli(p, ['send', '--batch-id', OB], {}), /send needs --batch-id ID --item N/);
  } finally {
    p.cleanup();
  }
});

test('M-3 gmail.mjs reply keeps the reply in the thread file and logs it as linkedin.reply', async () => {
  const p = await pack('1');
  try {
    const b = recorder({ text: 'Happy to talk next week.', hrefs: [], id: '18c0ffee00000001', from: EMAIL[A] });
    const res = await cli(p, ['reply', '--url', 'https://mail.google.com/mail/u/0/#inbox/18c0ffee00000001', '--target', A, '--company', ACME], { browser: b.browser });
    assert.equal(res.code, 0, res.text);
    const replies = (await readLog(p)).filter((r) => r.action === 'linkedin.reply');
    assert.equal(replies.length, 1);
    assert.equal(replies[0].target, A);
  } finally {
    p.cleanup();
  }
});

test('M-3 emailOf: an application follow-up names its application, a contact follow-up is a nudge', () => {
  assert.deepEqual(emailOf('b', 1, { action: 'application-follow-up', target: 'https://jobs.example.com/1', company: ACME }), { batchId: 'b', item: 1, target: 'https://jobs.example.com/1', company: ACME, followup: { target: 'https://jobs.example.com/1', company: ACME } });
  assert.equal(emailOf('b', 1, { action: 'follow-up', target: A, company: ACME }).nudge, true);
  assert.equal(emailOf('b', 1, { action: 'warm-opener', target: A, company: ACME }).nudge, undefined);
});
