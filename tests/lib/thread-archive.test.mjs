// lib/thread-archive.mjs: one plain-text conversation file per contact under the data folder, appended on every send
// and reply read, with no model call. Synthetic contacts and a scratch data folder only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { archiveMessage, threadFile, threadSlug } from '../../lib/thread-archive.mjs';

const scratch = () => mkdtempSync(join(tmpdir(), 'threads-'));

test('one file per contact keyed by name and company, slug-safe and case-insensitive', () => {
  assert.equal(threadSlug('Contact Alpha', 'Acme Example'), 'contact-alpha-acme-example');
  assert.equal(threadSlug('CONTACT alpha', 'acme example'), threadSlug('Contact Alpha', 'Acme Example'));
  assert.equal(threadSlug('../../etc', 'A/B\\C'), 'etc-a-b-c');
  assert.equal(threadSlug('', ''), 'unknown-unknown');
});

test('a send and a reply append to the same thread in order, and a reply read twice is kept once', () => {
  const dir = scratch();
  try {
    const who = { name: 'Contact Alpha', company: 'Acme Example' };
    archiveMessage(dir, { ...who, direction: 'sent', channel: 'email', text: 'Hello, thanks for connecting.', ts: '2026-03-10T12:00:00.000Z' });
    archiveMessage(dir, { ...who, direction: 'received', channel: 'linkedin', text: 'Happy to chat.', ts: '2026-03-11T12:00:00.000Z' });
    archiveMessage(dir, { ...who, direction: 'received', channel: 'linkedin', text: 'Happy to chat.', ts: '2026-03-12T12:00:00.000Z' });
    archiveMessage(dir, { name: 'Contact Alpha', company: 'Globex Example', direction: 'sent', channel: 'linkedin', text: 'Hi there.' });
    const text = readFileSync(threadFile(dir, who.name, who.company), 'utf8');
    assert.ok(text.startsWith('# Thread: Contact Alpha at Acme Example'));
    assert.ok(text.indexOf('Hello, thanks') < text.indexOf('Happy to chat.'));
    assert.equal(text.split('Happy to chat.').length - 1, 1, 'the second read adds nothing');
    assert.deepEqual(readdirSync(join(dir, 'threads')).sort(), ['contact-alpha-acme-example.txt', 'contact-alpha-globex-example.txt']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an empty message writes nothing and a bad direction throws', () => {
  const dir = scratch();
  try {
    archiveMessage(dir, { name: 'Contact Beta', company: 'Acme Example', direction: 'sent', channel: 'email', text: '  ' });
    assert.equal(existsSync(join(dir, 'threads')), false);
    assert.throws(() => archiveMessage(dir, { name: 'Contact Beta', company: 'Acme Example', direction: 'sideways', channel: 'email', text: 'x' }), /direction/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
