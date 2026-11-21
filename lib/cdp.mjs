// Chrome DevTools protocol client on Node's global WebSocket, so the automation profile is driven with no package.
// Only a loopback endpoint is accepted: the debugging port grants full control of a signed-in browser, and a remote host
// would mean someone else's browser or a forwarded port.
const LOOPBACK = '127.0.0.1';
export const COMMAND_TIMEOUT_MS = 15 * 1000;
export const LOAD_TIMEOUT_MS = 30 * 1000;

// Raised for every CDP failure: refused endpoint, command error, timeout, page script exception.
export class CdpError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CdpError';
  }
}

// Returns url unchanged when its host is 127.0.0.1; throws CdpError otherwise.
export function assertLoopback(url) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new CdpError(`cdp: not a url: ${url}`);
  }
  if (host !== LOOPBACK) throw new CdpError(`cdp: refusing endpoint host ${host}; only ${LOOPBACK} is allowed`);
  return url;
}

const httpBase = (port) => `http://${LOOPBACK}:${port}`;

// The browser-level endpoint (webSocketDebuggerUrl) from /json/version.
export async function discoverEndpoint(port, { fetchFn = fetch } = {}) {
  const res = await fetchFn(assertLoopback(`${httpBase(port)}/json/version`), { signal: AbortSignal.timeout(COMMAND_TIMEOUT_MS) });
  if (!res.ok) throw new CdpError(`cdp: /json/version answered ${res.status}`);
  const info = await res.json();
  return { browser: info.Browser ?? '', wsUrl: assertLoopback(info.webSocketDebuggerUrl) };
}

// Routes each frame: a reply settles its pending command, anything else goes to the event listeners. A frame that is not
// JSON is dropped, because a throw inside a WebSocket listener would surface as an uncaught exception and end the run.
function makeDispatcher(pending, listeners) {
  return (ev) => {
    let msg;
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    if (msg?.id && pending.has(msg.id)) {
      const { resolve, reject, timer, method } = pending.get(msg.id);
      clearTimeout(timer);
      pending.delete(msg.id);
      if (msg.error) reject(new CdpError(`cdp: ${method} failed: ${msg.error.message}`));
      else resolve(msg.result ?? {});
      return;
    }
    for (const fn of listeners) fn(msg);
  };
}

function makeSend({ ws, pending, opened, isClosed, timeoutMs }) {
  let nextId = 1;
  return async (method, params = {}, sessionId) => {
    await opened;
    if (isClosed()) throw new CdpError('cdp: socket closed');
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new CdpError(`cdp: ${method} timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer, method });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  };
}

// The returned promise carries cancel(), which stops the wait and its timer without settling the promise.
const makeWaitFor = (listeners) => (method, sessionId, ms = LOAD_TIMEOUT_MS) => {
  let fn;
  let timer;
  const done = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      listeners.delete(fn);
      reject(new CdpError(`cdp: no ${method} within ${ms} ms`));
    }, ms);
    fn = (msg) => {
      if (msg.method !== method || (sessionId && msg.sessionId !== sessionId)) return;
      clearTimeout(timer);
      listeners.delete(fn);
      resolve(msg.params ?? {});
    };
    listeners.add(fn);
  });
  done.cancel = () => {
    clearTimeout(timer);
    listeners.delete(fn);
  };
  return done;
};

// Opens one socket; send() numbers each command and resolves with its result or rejects on error or timeout.
export function connect(wsUrl, { WebSocketImpl = globalThis.WebSocket, timeoutMs = COMMAND_TIMEOUT_MS } = {}) {
  assertLoopback(wsUrl);
  if (!WebSocketImpl) throw new CdpError('cdp: this Node has no global WebSocket; Node 22 or newer is needed');
  const ws = new WebSocketImpl(wsUrl);
  const pending = new Map();
  const listeners = new Set();
  let closed = false;
  const failAll = (err) => {
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(err);
    }
    pending.clear();
  };
  ws.addEventListener('message', makeDispatcher(pending, listeners));
  ws.addEventListener('close', () => {
    closed = true;
    failAll(new CdpError('cdp: socket closed'));
  });
  const opened = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true });
    ws.addEventListener('error', () => reject(new CdpError(`cdp: cannot open ${wsUrl}`)), { once: true });
  });
  const send = makeSend({ ws, pending, opened, isClosed: () => closed, timeoutMs });
  const close = () => {
    if (!closed) ws.close();
    closed = true;
    failAll(new CdpError('cdp: socket closed'));
  };
  return { send, waitFor: makeWaitFor(listeners), close, opened };
}

// Opens a page target, attaches a flat session and navigates it; returns the session id and target id. The tab is closed
// again when any later step fails, since the caller never receives its id to clean up.
export async function openPage(client, url) {
  const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' });
  try {
    const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });
    await client.send('Page.enable', {}, sessionId);
    if (url) await navigate(client, sessionId, url);
    return { targetId, sessionId };
  } catch (err) {
    await client.send('Target.closeTarget', { targetId }).catch(() => {});
    throw err;
  }
}

// Registers the load listener before sending Page.navigate so a fast load event is not missed.
export async function navigate(client, sessionId, url) {
  const loaded = client.waitFor('Page.loadEventFired', sessionId);
  let res;
  try {
    res = await client.send('Page.navigate', { url }, sessionId);
  } catch (err) {
    loaded.cancel?.();
    throw err;
  }
  if (res.errorText) {
    loaded.cancel?.();
    throw new CdpError(`cdp: cannot load ${url}: ${res.errorText}`);
  }
  // Chrome omits loaderId for a same-document navigation, which fires no load event.
  if (!res.loaderId) {
    loaded.cancel?.();
    return;
  }
  await loaded;
}

// Runs expression in the page and returns its value; a page exception becomes a CdpError.
export async function evaluate(client, sessionId, expression) {
  const res = await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (res.exceptionDetails) throw new CdpError(`cdp: page script failed: ${res.exceptionDetails.text ?? 'exception'}`);
  return res.result?.value;
}

export const readText = (client, sessionId) => evaluate(client, sessionId, 'document.body ? document.body.innerText : ""');

// Accessibility nodes trimmed to role, name and value; ignored nodes and nodes with neither name nor value are dropped.
export async function readAxTree(client, sessionId) {
  await client.send('Accessibility.enable', {}, sessionId);
  const { nodes = [] } = await client.send('Accessibility.getFullAXTree', {}, sessionId);
  return nodes
    .filter((n) => !n.ignored)
    .map((n) => ({ role: n.role?.value ?? '', name: n.name?.value ?? '', value: n.value?.value ?? '' }))
    .filter((n) => n.name || n.value);
}

// Runs fn with a connected browser client and closes the socket on every exit path.
export async function withBrowser(port, fn, deps = {}) {
  const { wsUrl } = await discoverEndpoint(port, deps);
  const client = connect(wsUrl, deps);
  try {
    await client.opened;
    return await fn(client);
  } finally {
    client.close();
  }
}
