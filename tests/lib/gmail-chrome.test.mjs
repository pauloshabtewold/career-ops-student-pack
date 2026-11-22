// lib/gmail-chrome.mjs: reading a Gmail message through a CDP client with no model call, and sending only for a logged
// approved batch item. No browser starts: readMessage gets a fake CDP client whose Runtime.evaluate runs the page script
// against a fake Gmail message page (body text plus links), and sendEmail gets a fake browser that records any call.
// Fake claude and codex binaries on PATH record any agent start. Synthetic message text and example.com addresses only.
// Rulings: readMessage's result shape is open, so the test reads its JSON for the body text and every link target; the
// email object carries batchId, item, target, company, to, subject and body; sendEmail resolves to an exit code or an
// object with code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { readMessage, sendEmail } from '../../lib/gmail-chrome.mjs';
import { resolvePaths } from '../../lib/paths.mjs';
import { runResult } from '../../lib/run.mjs';
import { makePack, readLog } from '../helpers/budget-harness.mjs';
import { A, ACME, EMAIL, OB, approve, emailCheck, realToday, out } from '../helpers/outreach-harness.mjs';

const BODY = 'Thanks for reaching out. Our campus team posts new roles every Monday, and the details are on the careers page.';
const LINKS = [
  ['careers page', 'https://careers.example.com/students'],
  ['team calendar', 'https://calendar.example.org/campus-team'],
];

const isAnchorSelector = (sel) => /(^|[\s,>+~(])a(?![\w-])/i.test(String(sel)) || /href/i.test(String(sel));

// A fake Gmail message page: one message body element holding the text and the anchors.
function fakeGmailPage(url) {
  const anchors = LINKS.map(([text, href]) => ({
    tagName: 'A',
    href,
    innerText: text,
    textContent: text,
    getAttribute: (n) => (n === 'href' ? href : null),
  }));
  const pick = (sel, many) => (isAnchorSelector(sel) ? (many ? anchors : anchors[0]) : many ? [message] : message);
  const message = {
    tagName: 'DIV',
    innerText: BODY,
    textContent: BODY,
    querySelector: (sel) => (isAnchorSelector(sel) ? anchors[0] : null),
    querySelectorAll: (sel) => (isAnchorSelector(sel) ? anchors : []),
    getElementsByTagName: (t) => (String(t).toLowerCase() === 'a' ? anchors : []),
  };
  const body = { ...message, innerText: `${BODY}\n${LINKS.map(([t]) => t).join('\n')}` };
  const document = {
    title: 'Inbox - Gmail',
    body,
    links: anchors,
    location: { href: url },
    querySelector: (sel) => pick(sel, false),
    querySelectorAll: (sel) => pick(sel, true),
    getElementsByTagName: message.getElementsByTagName,
  };
  return document;
}

function fakeClient() {
  let document = fakeGmailPage('about:blank');
  const send = async (method, params = {}) => {
    if (method === 'Target.createTarget') return { targetId: 'T1' };
    if (method === 'Target.attachToTarget') return { sessionId: 'S1' };
    if (method === 'Page.navigate') {
      document = fakeGmailPage(params.url);
      return { frameId: 'F1' };
    }
    if (method === 'Runtime.evaluate') {
      const value = await new Function('document', 'window', 'location', `return ${params.expression}`)(document, { document, location: document.location }, document.location);
      return { result: { value } };
    }
    return {};
  };
  const waitFor = () => Object.assign(Promise.resolve({}), { cancel: () => {} });
  return { send, waitFor, opened: Promise.resolve(), close: () => {} };
}

// Fake claude and codex binaries that leave a marker file when anything starts them.
function fakeAgents() {
  const dir = mkdtempSync(join(tmpdir(), 'gmail-agents-'));
  const marker = join(dir, 'agent-called');
  for (const name of ['claude', 'codex']) {
    const file = join(dir, name);
    writeFileSync(file, `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, '${name}');\n`);
    chmodSync(file, 0o755);
  }
  const saved = process.env.PATH;
  process.env.PATH = `${dir}${delimiter}${saved}`;
  return {
    called: () => existsSync(marker),
    restore: () => {
      process.env.PATH = saved;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// M-004-S3-osdr
test('M-004-S3-osdr gmail-chrome reads message text and hrefs from the mock Gmail page with zero agent calls', async () => {
  const agents = fakeAgents();
  try {
    const res = await readMessage(fakeClient(), 'https://mail.google.com/mail/u/0/#inbox/FMfcgzSample0001');
    const json = JSON.stringify(res);
    assert.ok(json.includes(BODY), `the body text is returned: ${json}`);
    for (const [, href] of LINKS) assert.ok(json.includes(href), `link target ${href} is returned: ${json}`);
    assert.equal(agents.called(), false, 'no agent was started');
  } finally {
    agents.restore();
  }
});

// M-004-S8-osdr
test('M-004-S8-osdr gmail.send without an approved batch item exits 3 and gmail-chrome sends nothing', async () => {
  const today = realToday();
  const p = await makePack();
  try {
    approve(p, '1,2,3', { today });
    const ok = emailCheck(p, A, ACME, 1, { today });
    assert.equal(ok.code, 0, `an approved item passes: ${out(ok)}`);
    const unlisted = emailCheck(p, A, ACME, 4, { today });
    assert.equal(unlisted.code, 3, `item 4 is not in the approved batch: ${out(unlisted)}`);
    const bare = emailCheck(p, A, ACME, null, { today });
    assert.equal(bare.code, 3, `no --batch-id and --item: ${out(bare)}`);

    let browserCalls = 0;
    const browser = async () => {
      browserCalls += 1;
      throw new Error('the browser must not open');
    };
    const email = { batchId: OB, item: 4, target: A, company: ACME, to: EMAIL[A], subject: 'Hello from a student', body: 'Thanks for connecting.' };
    const res = await sendEmail({ paths: resolvePaths({ root: p.root, dataDir: p.dataDir }), port: 9, email, date: today, runner: runResult, browser });
    const code = typeof res === 'number' ? res : res?.code;
    assert.equal(code, 3, `sendEmail stops on the budget refusal: ${JSON.stringify(res)}`);
    assert.equal(browserCalls, 0, 'gmail-chrome never opened the browser');
    assert.ok(!(await readLog(p)).some((r) => r.action === 'gmail.send'), 'no gmail.send row was logged');
  } finally {
    p.cleanup();
  }
});
