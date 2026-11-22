// lib/ats-text.mjs text-layer checks on extracted PDF text and the single-column source check. Synthetic text only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const failed = (r) => (Array.isArray(r) ? r.length > 0 : r === false || r?.ok === false);
const passed = (r) => (Array.isArray(r) ? r.length === 0 : r === true || r?.ok === true);
const page = (style, body) => `<html><head><style>${style}</style></head><body><h1>Casey Sample</h1>${body}</body></html>`;
const TWO_BLOCKS = '<div class="a"><h2>Experience</h2><p>Fake Intern, Example Corp</p></div><div class="b"><h2>Skills</h2><p>Python, SQL</p></div>';

// M-002-S43-osdr
test('M-002-S43-osdr a text layer with two source words run together fails gluedWords and a source word split by a space fails splitWords', async () => {
  const { atsTextProblems, splitWords } = await import('../../lib/ats-text.mjs');
  const words = ['Built', 'internal', 'dashboards', 'with', 'React'];
  const glued = atsTextProblems('Built internal dashboardswith React', { words });
  assert.ok(glued.some((p) => /glued|together/i.test(String(p))), `glued words reported: ${JSON.stringify(glued)}`);
  assert.deepEqual(atsTextProblems('Built internal dashboards with React', { words }), []);

  assert.deepEqual(splitWords('Built inter nal dashboards with React', words), ['internal']);
  assert.deepEqual(splitWords('Built internal dashboards with React', words), []);
});

// M-002-S44-osdr
test('M-002-S44-osdr a resume source laid out in two CSS columns or a two-track grid or a table fails the single-column check while the template passes it', async () => {
  const { singleColumn } = await import('../../lib/ats-text.mjs');
  assert.ok(failed(singleColumn(page('body { column-count: 2; }', TWO_BLOCKS))), 'CSS columns');
  assert.ok(failed(singleColumn(page('.wrap { display: grid; grid-template-columns: 1fr 2fr; }', `<div class="wrap">${TWO_BLOCKS}</div>`))), 'two-track grid');
  assert.ok(failed(singleColumn(page('.a { float: left; width: 40%; }', TWO_BLOCKS))), 'float');
  assert.ok(failed(singleColumn(page('', `<table><tr><td>${TWO_BLOCKS}</td><td>Projects</td></tr></table>`))), 'table');
  assert.ok(passed(singleColumn(page('.wrap { display: grid; grid-template-columns: 1fr; }', `<div class="wrap">${TWO_BLOCKS}</div>`))), 'a one-track grid is single column');
  const template = readFileSync(join(PACK_ROOT, 'templates', 'resume', 'resume.template.html'), 'utf8');
  assert.ok(passed(singleColumn(template)), 'the shipped template passes');
});
