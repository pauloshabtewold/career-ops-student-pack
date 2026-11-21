// lib/ats-text.mjs singleColumn: CSS columns in an inline style attribute are caught like those in a style block.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { singleColumn } from '../../lib/ats-text.mjs';

const flagged = (html) => singleColumn(html).some((m) => m.includes('CSS columns'));

test('inline columns and column-count in a style attribute are multi-column', () => {
  for (const html of [
    '<main style="columns: 2">Jordan Testwell</main>',
    '<main style="columns:2 200px">Jordan Testwell</main>',
    '<main style="column-count: 2">Jordan Testwell</main>',
    "<main style='columns: 200px 3'>Jordan Testwell</main>",
    '<main style="color: black; column-count: 12">Jordan Testwell</main>',
    '<style>main { columns: 2; }</style><main>Jordan Testwell</main>',
  ]) assert.ok(flagged(html), html);
});

test('one column passes', () => {
  for (const html of [
    '<main style="columns: 1">Jordan Testwell</main>',
    '<main style="column-count: 1">Jordan Testwell</main>',
    '<main style="columns: 200px">Jordan Testwell</main>',
    '<main style="color: black">Two columns of text were never used here.</main>',
  ]) assert.deepEqual(singleColumn(html), [], html);
});
