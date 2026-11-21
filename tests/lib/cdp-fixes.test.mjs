// lib/cdp.mjs openPage against a fake client: a failed navigation closes the tab it created.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage } from '../../lib/cdp.mjs';

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
