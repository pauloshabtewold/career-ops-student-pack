// scripts/chrome.mjs linkRefs (read --links): the page script keeps only job and company links before a cap of 200, so
// header and filter links never push job cards past the cap. A fake CDP client runs the page script against a fake
// document; no browser starts. Fake LinkedIn job ids only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkRefs, REF_SELECTOR } from '../../scripts/chrome.mjs';

const anchors = [
  ...Array.from({ length: 60 }, (_, i) => ({ innerText: `Nav ${i}`, href: `https://www.linkedin.com/feed/${i}` })),
  ...Array.from({ length: 150 }, (_, i) => [
    { innerText: `Intern ${i}\n`, href: `https://www.linkedin.com/jobs/view/41000${String(i).padStart(5, '0')}/` },
    { innerText: `Example Co ${i}`, href: `https://www.linkedin.com/company/example-${i}/` },
  ]).flat(),
];

function fakeClient() {
  const seen = [];
  const document = {
    querySelectorAll: (sel) => {
      seen.push(sel);
      return sel === REF_SELECTOR ? anchors.filter((a) => /\/jobs\/view\/|\/company\//.test(a.href)) : anchors;
    },
  };
  const send = async (method, { expression }) => ({ result: { value: new Function('document', `return ${expression}`)(document) } });
  return { client: { send }, seen };
}

test('read --links keeps job and company links only, capped at 200', async () => {
  const { client, seen } = fakeClient();
  const refs = await linkRefs(client, 's1');
  assert.deepEqual(seen, [REF_SELECTOR]);
  assert.equal(refs.length, 200);
  assert.equal(refs[0], '[1] Intern 0 -> https://www.linkedin.com/jobs/view/4100000000/');
  assert.ok(refs.every((r) => /\/jobs\/view\/|\/company\//.test(r)));
});
