// M-007 fix round 2, S-8 from the personal review: Lever keeps the application form at <posting>/apply and Ashby at
// <posting>/application, so read-form and fill open formUrl(posting). Fake CDP client only; no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formUrl } from '../../lib/ats-fields.mjs';
import { fillPlan, readForm } from '../../scripts/chrome.mjs';

// M-007-fix2-S8a
test('M-007-fix2-S8a formUrl maps Lever to /apply and Ashby to /application and leaves every other link as it is', () => {
  const cases = [
    ['https://jobs.lever.co/examplerobotics/0a1b2c3d-1111-2222-3333-444455556666', 'https://jobs.lever.co/examplerobotics/0a1b2c3d-1111-2222-3333-444455556666/apply'],
    ['https://jobs.eu.lever.co/examplerobotics/0a1b2c3d?lever-source=x', 'https://jobs.eu.lever.co/examplerobotics/0a1b2c3d/apply?lever-source=x'],
    ['https://jobs.lever.co/examplerobotics/0a1b2c3d/', 'https://jobs.lever.co/examplerobotics/0a1b2c3d/apply'],
    ['https://jobs.lever.co/examplerobotics/0a1b2c3d/apply', 'https://jobs.lever.co/examplerobotics/0a1b2c3d/apply'],
    ['https://jobs.lever.co/examplerobotics', 'https://jobs.lever.co/examplerobotics'],
    ['https://jobs.ashbyhq.com/examplelabs/9f8e7d6c-aaaa-bbbb-cccc-ddddeeeeffff', 'https://jobs.ashbyhq.com/examplelabs/9f8e7d6c-aaaa-bbbb-cccc-ddddeeeeffff/application'],
    ['https://jobs.ashbyhq.com/examplelabs/9f8e7d6c/application', 'https://jobs.ashbyhq.com/examplelabs/9f8e7d6c/application'],
    ['https://boards.greenhouse.io/examplerobotics/jobs/7001', 'https://boards.greenhouse.io/examplerobotics/jobs/7001'],
    ['https://job-boards.greenhouse.io/examplerobotics/jobs/7001?gh_jid=7001', 'https://job-boards.greenhouse.io/examplerobotics/jobs/7001?gh_jid=7001'],
    ['http://127.0.0.1:4567/greenhouse/form?job=7', 'http://127.0.0.1:4567/greenhouse/form?job=7'],
    ['not a url', 'not a url'],
  ];
  for (const [given, want] of cases) assert.equal(formUrl(given), want, given);
});

// A fake CDP client that records every page it navigates to and shows a one-field form.
function client() {
  const opened = [];
  const send = async (method, params = {}) => {
    if (method === 'Target.getTargets') return { targetInfos: [] };
    if (method === 'Target.createTarget') return { targetId: 'T1' };
    if (method === 'Target.attachToTarget') return { sessionId: 'S1' };
    if (method === 'Page.navigate') opened.push(params.url);
    if (method === 'Runtime.evaluate') {
      const expr = String(params.expression);
      if (expr.includes("querySelectorAll('input, select, textarea')")) return { result: { value: [{ selector: '#email', id: 'email', name: 'email', type: 'email', label: 'Email' }] } };
      if (expr.includes('location.href')) return { result: { value: opened.at(-1) } };
      return { result: { value: null } };
    }
    return {};
  };
  return { send, waitFor: () => Object.assign(Promise.resolve({}), { cancel: () => {} }), close: () => {}, opened };
}

// M-007-fix2-S8b
test('M-007-fix2-S8b read-form and fill open the Lever form page, not the posting page', async () => {
  const posting = 'https://jobs.lever.co/examplerobotics/0a1b2c3d';
  const read = client();
  await readForm(read, posting);
  assert.deepEqual(read.opened, [`${posting}/apply`]);
  const fill = client();
  await fillPlan(fill, { url: posting, fields: [] }, { dataDir: '/nonexistent' });
  assert.deepEqual(fill.opened, [`${posting}/apply`]);
});
