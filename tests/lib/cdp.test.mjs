// lib/cdp.mjs: the loopback-only endpoint rule and the socket frame dispatcher, driven through a fake WebSocket.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertLoopback, discoverEndpoint, connect, openPage, readText } from '../../lib/cdp.mjs';

// A WebSocket stand-in: opens on the next tick and answers each command by method. Before every answer it sends one
// frame that is not JSON, so a dispatcher that parses without a guard throws from its listener.
class FakeSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];

  constructor(url) {
    super();
    this.url = url;
    this.readyState = FakeSocket.CONNECTING;
    this.listenerErrors = [];
    FakeSocket.instances.push(this);
    setTimeout(() => {
      this.readyState = FakeSocket.OPEN;
      this.emit('open', new Event('open'));
    }, 0);
  }

  emit(type, event) {
    this.dispatchEvent(event);
    const handler = this[`on${type}`];
    if (typeof handler === 'function') {
      try {
        handler.call(this, event);
      } catch (err) {
        this.listenerErrors.push(err);
      }
    }
  }

  frame(data) {
    this.emit('message', new MessageEvent('message', { data }));
  }

  send(raw) {
    const msg = JSON.parse(String(raw));
    const results = {
      'Target.createTarget': { targetId: 'T-fake-1' },
      'Target.attachToTarget': { sessionId: 'S-fake-1' },
      'Runtime.evaluate': { result: { type: 'string', value: 'Fake page text for the frame test' } },
    };
    setTimeout(() => {
      this.frame('<<not json at all');
      const reply = { id: msg.id, result: results[msg.method] ?? {} };
      if (msg.sessionId) reply.sessionId = msg.sessionId;
      this.frame(JSON.stringify(reply));
    }, 0);
  }

  close() {
    this.readyState = FakeSocket.CLOSED;
    this.emit('close', new Event('close'));
  }
}

const jsonResponse = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

// M-001-S7-osdr
test('M-001-S7-osdr cdp.mjs refuses an endpoint whose host is not 127.0.0.1', async () => {
  assert.doesNotThrow(() => assertLoopback('ws://127.0.0.1:9222/devtools/browser/abc'));
  assert.throws(() => assertLoopback('ws://10.1.2.3:9222/devtools/browser/abc'), /10\.1\.2\.3/);
  assert.throws(() => assertLoopback('ws://localhost:9222/devtools/browser/abc'), /localhost/);

  const fetchFn = async () => jsonResponse({ Browser: 'Chrome/130.0.0.0', webSocketDebuggerUrl: 'ws://evil.example:9222/devtools/browser/abc' });
  await assert.rejects(() => discoverEndpoint(9222, { fetchFn }), /evil\.example/);

  FakeSocket.instances = [];
  await assert.rejects(async () => connect('ws://192.168.0.9:9222/devtools/browser/abc', { WebSocketImpl: FakeSocket }), /192\.168\.0\.9/);
  assert.equal(FakeSocket.instances.length, 0, 'no socket is opened to a non-loopback host');
});

// M-001-S22-osdr
test('M-001-S22-osdr a non-JSON frame on the CDP socket is dropped without an uncaught exception and a pending command still resolves', async () => {
  const uncaught = [];
  const onUncaught = (err) => uncaught.push(err);
  process.on('uncaughtException', onUncaught);
  FakeSocket.instances = [];
  try {
    const client = await connect('ws://127.0.0.1:9222/devtools/browser/fake', { WebSocketImpl: FakeSocket, timeoutMs: 5000 });
    await openPage(client, 'http://127.0.0.1:9/page');
    const text = await readText(client, 'S-fake-1');
    assert.equal(text, 'Fake page text for the frame test');
    await new Promise((r) => setTimeout(r, 0));
    const listenerErrors = FakeSocket.instances.flatMap((s) => s.listenerErrors);
    assert.deepEqual([...uncaught, ...listenerErrors].map(String), []);
    for (const s of FakeSocket.instances) s.close();
  } finally {
    process.off('uncaughtException', onUncaught);
  }
});
