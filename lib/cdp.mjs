// Stub so the M-001 tests fail on behaviour; M-001 replaces every body.
export const COMMAND_TIMEOUT_MS = 15 * 1000;
export const LOAD_TIMEOUT_MS = 30 * 1000;
export class CdpError extends Error {}

const todo = () => {
  throw new Error('not implemented');
};

export function assertLoopback(url) {
  return todo(url);
}
export async function discoverEndpoint(port, { fetchFn = fetch } = {}) {
  return todo(port, fetchFn);
}
export function connect(wsUrl, { WebSocketImpl = globalThis.WebSocket, timeoutMs = COMMAND_TIMEOUT_MS } = {}) {
  return todo(wsUrl, WebSocketImpl, timeoutMs);
}
export async function openPage(client, url) {
  return todo(client, url);
}
export async function navigate(client, sessionId, url) {
  return todo(client, sessionId, url);
}
export async function evaluate(client, sessionId, expression) {
  return todo(client, sessionId, expression);
}
export const readText = (client, sessionId) => todo(client, sessionId);
export async function readAxTree(client, sessionId) {
  return todo(client, sessionId);
}
export async function withBrowser(port, fn, deps = {}) {
  return todo(port, fn, deps);
}
