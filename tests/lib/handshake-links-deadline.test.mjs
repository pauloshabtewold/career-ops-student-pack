// lib/handshake-links.mjs resolveMessageLinks, M-003 third fix round: with a deadline, no tracking-link lookup starts
// after it, even inside one message. Fake fetch, fake clock, fake tokens; no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMessageLinks } from '../../lib/handshake-links.mjs';

const T = (token) => `https://email.notifications.joinhandshake.com/c/${token}`;

test('lookups stop at the deadline inside one message and the later links stay unchanged', async () => {
  let t = 0;
  const gets = [];
  const fetchFn = async (url) => {
    gets.push(url);
    t += 10000;
    return new Response(null, { status: 302, headers: { location: 'https://sampleu.joinhandshake.com/job-search/90000099' } });
  };
  const out = await resolveMessageLinks({ id: 'm1', links: [T('a'), T('b'), T('c'), T('d')] }, { fetchFn, deadline: 25000, now: () => t });
  assert.deepEqual(gets, [T('a'), T('b'), T('c')]);
  assert.equal(out.links[3], T('d'));
  assert.match(out.links[0], /90000099/);
});
