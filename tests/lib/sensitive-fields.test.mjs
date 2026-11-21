// SSN, card and bank fields on the fill path: resolveFields gives them no value and lists them as blocked, and
// chrome.mjs fillPlan never types into them and exits 5 (needs the user). Fake labels and a fake CDP client only; no
// browser runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const URL_GH = 'https://boards.greenhouse.io/examplerobotics/jobs/1001';
const SENSITIVE = [
  { label: 'Social Security Number', name: 'ssn', type: 'text' },
  { label: 'Card number', name: 'cardnumber', type: 'text' },
  { label: 'CVV', name: 'cvv', type: 'text' },
  { label: 'Expiry', name: 'exp', type: 'text' },
  { label: 'Bank account number', name: 'acct', type: 'text' },
  { label: 'Routing number', name: 'routing', type: 'text' },
  { label: 'Name on card', name: 'ccname', type: 'text', autocomplete: 'cc-name' },
];

test('M-002 resolveFields never fills a sensitive field and lists it as blocked, not as an unknown question', async () => {
  const { resolveFields } = await import('../../scripts/fill-plan.mjs');
  const answers = { questions: { 'social security number': '000-00-0000', 'card number': '4111' } };
  const res = resolveFields({ url: URL_GH, fields: [{ label: 'Email', name: 'email', type: 'email' }, ...SENSITIVE] }, { answers, candidate: { email: 'casey.sample@example.com' } });
  for (const f of SENSITIVE) assert.equal(res.fields.find((x) => x.name === f.name).value, undefined, f.label);
  assert.deepEqual(res.blocked, SENSITIVE.map((f) => f.label));
  assert.deepEqual(res.unknown, []);
  assert.equal(res.fields.find((x) => x.name === 'email').value, 'casey.sample@example.com');
});

function fakeCdp(fields) {
  const calls = [];
  const send = async (method, params = {}) => {
    calls.push({ method, params });
    if (method === 'Target.getTargets') return { targetInfos: [{ type: 'page', url: URL_GH, targetId: 't1' }] };
    if (method === 'Target.attachToTarget') return { sessionId: 's1' };
    if (method === 'Runtime.evaluate') {
      const expr = String(params.expression);
      if (expr.includes('recaptcha')) return { result: { value: null } };
      const sel = fields.find((f) => expr.includes(JSON.stringify(f.selector)));
      if (expr.includes('autocomplete: (el.autocomplete')) return { result: { value: { tag: 'input', type: 'text', autocomplete: sel?.autocomplete ?? '' } } };
      return { result: { value: true } };
    }
    return {};
  };
  return { send, calls };
}

test('M-002 chrome.mjs fillPlan types nothing into SSN, card or bank fields and exits 5 naming them blocked-on-user', async () => {
  const { fillPlan, EXIT } = await import('../../scripts/chrome.mjs');
  const fields = [
    { selector: '#email', label: 'Email', type: 'text', value: 'casey.sample@example.com' },
    { selector: '#ssn', label: 'Social Security Number', type: 'text', value: '000-00-0000' },
    { selector: '#cc', label: 'Payment', type: 'text', value: '4111111111111111', autocomplete: 'cc-number' },
  ];
  const client = fakeCdp(fields);
  const res = await fillPlan(client, { url: URL_GH, fields }, { dataDir: '/nonexistent' });
  assert.equal(res.code, EXIT.needsUser);
  assert.equal(res.filled, 1);
  const typed = client.calls.map((c) => String(c.params.expression ?? '')).join('\n');
  assert.ok(typed.includes('casey.sample@example.com'));
  assert.ok(!typed.includes('000-00-0000') && !typed.includes('4111111111111111'), 'no sensitive value reached the page');
  assert.equal(res.problems.filter((p) => p.startsWith('blocked-on-user:')).length, 2, res.problems.join('\n'));
});
