// Stub for M-004: Gmail in the automation profile through chrome.mjs. The implementer replaces these bodies.
import { withBrowser } from './cdp.mjs';
import { runResult } from './run.mjs';

export const GMAIL = 'https://mail.google.com/mail/u/0/';
export const searchUrl = (query) => {
  void query;
  throw new Error('gmail-chrome: not implemented');
};
export const composeUrl = ({ to, subject, body }) => {
  void to, subject, body;
  throw new Error('gmail-chrome: not implemented');
};
export async function listMessages(client, query) {
  void client, query;
  throw new Error('gmail-chrome: not implemented');
}
export async function readMessage(client, url) {
  void client, url;
  throw new Error('gmail-chrome: not implemented');
}
export async function sendEmail({ paths, port, email, date, runner = runResult, browser = withBrowser }) {
  void paths, port, email, date, runner, browser;
  throw new Error('gmail-chrome: not implemented');
}
export async function readInbox({ dataDir, port, query, date, browser = withBrowser }) {
  void dataDir, port, query, date, browser;
  throw new Error('gmail-chrome: not implemented');
}
