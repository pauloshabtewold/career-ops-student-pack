// lib/handshake-links.mjs resolveTracked and resolveMessageLinks: a Handshake click-tracking link
// (https://<host>.joinhandshake.com/c/<token>) is asked once with redirect manual and no cookies, and the job id is read
// from the Location it answers with; navigation targets, other hosts and network failures give null. A fake fetch only:
// no network. Fake tokens and job ids only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTrackedLink, resolveMessageLinks, resolveTracked, TRACKED_PER_ALERT } from '../../lib/handshake-links.mjs';

const T = (token) => `https://email.notifications.joinhandshake.com/c/${token}`;
const G = (token) => `https://email.g.joinhandshake.com/c/${token}`;
const SCHOOL = 'https://sampleu.joinhandshake.com';

// map: token -> Location (or an Error to throw). Records each call's url and init.
function fakeFetch(map) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const token = new URL(url).pathname.split('/').pop();
    const loc = map[token];
    if (loc instanceof Error) throw loc;
    return new Response(null, { status: loc ? 302 : 200, headers: loc ? { location: loc } : {} });
  };
  return { fn, calls };
}

test('a tracking link that redirects to a job card gives the job id; one manual GET with no cookies', async () => {
  const f = fakeFetch({ tok1: `${SCHOOL}/job-search/90000001?ref=alert` });
  assert.equal(await resolveTracked(T('tok1'), { fetchFn: f.fn }), '90000001');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].init.redirect, 'manual');
  assert.equal(f.calls[0].init.method, 'GET');
  assert.equal(f.calls[0].init.credentials, 'omit');
  assert.ok(f.calls[0].init.signal, 'a timeout signal is set');
  assert.equal(f.calls[0].init.headers, undefined, 'no cookie header');
});

test('navigation targets, other hosts and failures give null', async () => {
  const f = fakeFetch({ nav1: `${SCHOOL}/inbox`, nav2: `${SCHOOL}/profiles/me`, nav3: `${SCHOOL}/notifications`, nav4: `${SCHOOL}/`, bad: new Error('ECONNRESET') });
  for (const t of ['nav1', 'nav2', 'nav3', 'nav4', 'bad', 'none']) assert.equal(await resolveTracked(G(t), { fetchFn: f.fn }), null, t);
  assert.equal(await resolveTracked('https://email.example.com/c/tok1', { fetchFn: f.fn }), null);
  assert.equal(await resolveTracked('http://email.g.joinhandshake.com/c/tok1', { fetchFn: f.fn }), null);
  assert.equal(isTrackedLink('https://app.joinhandshake.com/stu/jobs/1234567'), false);
  assert.equal(f.calls.length, 6, 'only https tracking links on joinhandshake.com are asked');
});

test('resolveMessageLinks swaps resolved links, keeps the rest and asks at most 25 links per alert', async () => {
  const map = { job1: `${SCHOOL}/job-search/90000002`, nav: `${SCHOOL}/inbox` };
  for (let i = 0; i < 40; i++) map[`many${i}`] = `${SCHOOL}/job-search/9100${String(i).padStart(4, '0')}`;
  const f = fakeFetch(map);
  const msg = { id: 'm1', snippet: `View job: ${T('job1')}`, links: [T('job1'), T('nav'), ...Array.from({ length: 40 }, (_, i) => T(`many${i}`))], jobs: [{ title: 'Intern', link: T('job1') }] };
  const out = await resolveMessageLinks(msg, { fetchFn: f.fn });
  assert.equal(out.links[0], 'https://app.joinhandshake.com/stu/jobs/90000002');
  assert.equal(out.links[1], T('nav'));
  assert.equal(out.jobs[0].link, 'https://app.joinhandshake.com/stu/jobs/90000002');
  assert.match(out.snippet, /stu\/jobs\/90000002/);
  assert.equal(f.calls.length, TRACKED_PER_ALERT, 'a repeated link is asked once and the cap holds');
  assert.equal(msg.links[0], T('job1'), 'the input message is not changed');
});
