// lib/cdp.mjs openPage and navigate against a fake client: a failed navigation closes the tab it created, and a page
// that never fires load still counts as loaded once DOMContentLoaded fired.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, navigate, CdpError } from '../../lib/cdp.mjs';

function fakeClient(navigateResult) {
  const sent = [];
  return {
    sent,
    async send(method, params) {
      sent.push({ method, params });
      if (method === 'Target.createTarget') return { targetId: 'T-fake-9' };
      if (method === 'Target.attachToTarget') return { sessionId: 'S-fake-9' };
      if (method === 'Page.navigate') return navigateResult();
      return {};
    },
    waitFor() {
      const p = new Promise(() => {});
      p.cancel = () => {};
      return p;
    },
  };
}

test('S3 openPage closes its tab when navigation reports an error', async () => {
  const client = fakeClient(() => ({ errorText: 'net::ERR_NAME_NOT_RESOLVED' }));
  await assert.rejects(() => openPage(client, 'http://127.0.0.1:9/missing'), /ERR_NAME_NOT_RESOLVED/);
  const close = client.sent.find((m) => m.method === 'Target.closeTarget');
  assert.deepEqual(close?.params, { targetId: 'T-fake-9' });
});

test('S3 openPage closes its tab when navigation throws', async () => {
  const client = fakeClient(() => {
    throw new Error('fake Page.navigate timed out');
  });
  await assert.rejects(() => openPage(client, 'http://127.0.0.1:9/slow'), /timed out/);
  assert.ok(client.sent.some((m) => m.method === 'Target.closeTarget'));
});

test('S3 openPage leaves the tab open when navigation succeeds', async () => {
  const client = fakeClient(() => ({ frameId: 'F1' }));
  assert.deepEqual(await openPage(client, 'http://127.0.0.1:9/page#x'), { targetId: 'T-fake-9', sessionId: 'S-fake-9' });
  assert.equal(client.sent.some((m) => m.method === 'Target.closeTarget'), false);
});

// A client whose waitFor mirrors lib/cdp.mjs: a listener set, a timer per wait, cancel() removing both. fire lists the
// events the page emits right after Page.navigate; listeners shows what is still registered afterwards.
function eventClient({ navigateResult = { frameId: 'F1', loaderId: 'L1' }, fire = [] } = {}) {
  const listeners = new Set();
  const emit = (method) => {
    for (const fn of [...listeners]) fn({ method, sessionId: 'S1', params: {} });
  };
  return {
    listeners,
    async send(method) {
      if (method !== 'Page.navigate') return {};
      if (navigateResult instanceof Error) throw navigateResult;
      setTimeout(() => fire.forEach(emit), 0);
      return navigateResult;
    },
    waitFor(method, sessionId, ms) {
      let fn;
      let timer;
      const done = new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          listeners.delete(fn);
          reject(new CdpError(`cdp: no ${method} within ${ms} ms`));
        }, ms);
        fn = (msg) => {
          if (msg.method !== method || msg.sessionId !== sessionId) return;
          clearTimeout(timer);
          listeners.delete(fn);
          resolve(msg.params);
        };
        listeners.add(fn);
      });
      done.cancel = () => {
        clearTimeout(timer);
        listeners.delete(fn);
      };
      return done;
    },
  };
}

const settle = () => new Promise((r) => setTimeout(r, 40));

test('navigate resolves when load never fires but DOMContentLoaded did', async () => {
  const client = eventClient({ fire: ['Page.domContentEventFired'] });
  await navigate(client, 'S1', 'http://127.0.0.1:9/jobs', { loadTimeoutMs: 20 });
  assert.equal(client.listeners.size, 0);
});

test('navigate rejects with the load timeout when neither load nor DOMContentLoaded fires', async () => {
  const client = eventClient();
  await assert.rejects(
    () => navigate(client, 'S1', 'http://127.0.0.1:9/jobs', { loadTimeoutMs: 20 }),
    (err) => err instanceof CdpError && err.message === 'cdp: no Page.loadEventFired within 20 ms',
  );
  await settle();
  assert.equal(client.listeners.size, 0);
});

test('navigate resolves on load and leaves no listener registered', async () => {
  const client = eventClient({ fire: ['Page.loadEventFired'] });
  await navigate(client, 'S1', 'http://127.0.0.1:9/page', { loadTimeoutMs: 20 });
  assert.equal(client.listeners.size, 0);
  await settle();
});

test('navigate throws on errorText and leaves no listener registered', async () => {
  const client = eventClient({ navigateResult: { errorText: 'net::ERR_NAME_NOT_RESOLVED' } });
  await assert.rejects(() => navigate(client, 'S1', 'http://127.0.0.1:9/missing', { loadTimeoutMs: 20 }), /ERR_NAME_NOT_RESOLVED/);
  assert.equal(client.listeners.size, 0);
  await settle();
});
