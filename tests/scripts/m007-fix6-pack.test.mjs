// M-007 fix round 6: the shared application-form qualification rule v2. A signup-button form never qualifies, even with
// a resume upload (S-13) or as a Create alert / Get notified / Contact sales form (N-28); the attribute marketing check
// matches whole tokens of id, class and name only, so wrapper words such as MarketingLayout, has-sticky-footer or
// job-updates never drop a real form (N-26); a footer counts only as a <footer> element or role=contentinfo; a select is
// never an identity field. Fake DOM, fake CDP client; no browser, network or model call. Fake data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import * as cdp from '../../lib/cdp.mjs';

// A small DOM for the page scripts (as in the fix4 and fix5 tests).
function el(tag, attrs = {}, children = []) {
  const node = { tagName: tag.toUpperCase(), attrs, children, parentElement: null, required: false, placeholder: attrs.placeholder ?? '', autocomplete: '' };
  node.id = attrs.id ?? '';
  node.name = attrs.name ?? '';
  node.type = attrs.type ?? (tag === 'input' ? 'text' : tag === 'button' ? 'submit' : tag);
  node.innerText = attrs.text ?? '';
  node.value = attrs.value ?? '';
  for (const c of children) c.parentElement = node;
  node.getAttribute = (k) => (k in attrs ? attrs[k] : null);
  const matches = (x, sel) => sel.split(',').map((s) => s.trim()).some((s) => {
    const m = /^([a-z]*)(?:#([\w-]+))?(?:\[(\w+)=(?:"([^"]*)"|([\w-]+))\])?$/.exec(s);
    if (!m) return false;
    if (m[1] && x.tagName !== m[1].toUpperCase()) return false;
    if (m[2] && x.attrs.id !== m[2]) return false;
    if (!m[3]) return true;
    const want = m[4] ?? m[5];
    return m[3] === 'type' ? x.type === want : x.attrs[m[3]] === want;
  });
  const all = (x) => x.children.flatMap((c) => [c, ...all(c)]);
  node.querySelectorAll = (sel) => all(node).filter((x) => matches(x, sel));
  node.querySelector = (sel) => node.querySelectorAll(sel)[0] ?? null;
  node.closest = (sel) => {
    for (let x = node; x; x = x.parentElement) if (matches(x, sel)) return x;
    return null;
  };
  node.contains = (other) => {
    for (let x = other; x; x = x.parentElement) if (x === node) return true;
    return false;
  };
  return node;
}
function domCtx(bodyChildren) {
  const html = el('html', {}, [el('body', {}, bodyChildren)]);
  const body = html.children[0];
  const document = { body, querySelectorAll: (s) => body.querySelectorAll(s), querySelector: (s) => body.querySelector(s) };
  return { document, CSS: { escape: (s) => String(s) } };
}
const vmClient = (ctx) => ({ send: async (method, params) => ({ result: { value: method === 'Runtime.evaluate' ? runInNewContext(params.expression, ctx) : undefined } }) });
const input = (id, type = 'text', extra = {}) => el('input', { id, name: id, type, ...extra });
const btn = (id, type, text = '') => el('button', type ? { id, type, text } : { id, text });
const read = (kids) => cdp.readApplicationForm(vmClient(domCtx(kids)), 'S1');
const none = (res, name) => {
  assert.equal(res.form, null, `${name}: ${JSON.stringify(res)}`);
  assert.equal(res.submit, null, `${name}: no submit is saved`);
};

// M-007-fix6-S13
test('M-007-fix6-S13 a talent-community form with a resume upload and a Join button does not qualify and saves no submit', async () => {
  none(await read([el('main', {}, [el('form', { id: 'tc' }, [input('full_name'), input('tc_email', 'email'), input('tc_resume', 'file'), btn('join', 'submit', 'Join our talent community')])])]), 'typed Join');
  none(await read([el('main', {}, [el('form', { id: 'tc' }, [input('full_name'), input('tc_email', 'email'), input('cv_link', 'url', { placeholder: 'Resume or CV link' }), btn('join', undefined, 'Join the talent network')])])]), 'untyped Join with a resume link');
  none(await read([el('main', {}, [el('form', { id: 'acct' }, [input('a_email', 'email'), input('pw', 'password'), btn('su', 'submit', 'Sign up')])])]), 'a password form whose button signs up');
});

// M-007-fix6-N28
test('M-007-fix6-N28 Create alert, Get notified, Contact sales and request-a-demo forms do not qualify', async () => {
  const shapes = {
    'Create alert': [input('first_name'), input('ca_email', 'email'), input('keywords'), btn('ca', 'submit', 'Create alert')],
    'Create job alert': [input('first_name'), input('ca_email', 'email'), btn('ca', 'submit', 'Create job alert')],
    'Get notified': [input('full_name'), input('gn_email', 'email'), btn('gn', 'submit', 'Get notified')],
    'Contact sales': [input('full_name'), input('cs_email', 'email'), input('cs_phone', 'tel'), input('company'), btn('cs', 'submit', 'Contact sales')],
    'Request a demo': [input('full_name'), input('rd_email', 'email'), el('input', { id: 'rd', type: 'submit', value: 'Request a demo' })],
  };
  for (const [name, kids] of Object.entries(shapes)) none(await read([el('main', {}, [el('form', { id: 'f' }, kids)])]), name);
});

// M-007-fix6-N26a
test('M-007-fix6-N26a a real application form in MarketingLayout / has-sticky-footer / job-updates wrappers with a Marketing Manager aria-label still qualifies', async () => {
  const res = await read([el('div', { class: 'MarketingLayout' }, [el('div', { class: 'has-sticky-footer job-updates', 'aria-label': 'Apply for Marketing Manager' }, [
    el('h2', { text: 'Join our team' }),
    el('form', { id: 'application_form', name: 'marketing-manager-apply' }, [input('first_name'), input('last_name'), input('email', 'email'), input('phone', 'tel'), btn('send', 'submit', 'Submit application')]),
  ])])]);
  assert.equal(res.form, '#application_form', JSON.stringify(res));
  assert.equal(res.submit, '#send');
});

// M-007-fix6-N26b
test('M-007-fix6-N26b the attribute check matches whole tokens (camelCase and separators split) and adjacent pairs only', async () => {
  const two = (attrs) => [el('div', attrs, [el('form', { id: attrs.formId ?? 'f' }, [input('first_name'), input('m_email', 'email'), btn('go', 'submit', 'Submit')])])];
  for (const attrs of [{ class: 'newsletter-block' }, { class: 'site-subscription' }, { id: 'signupBox' }, { class: 'talentCommunity' }, { class: 'talent_network' }, { class: 'job-alerts' }, { class: 'sign-up' }, { class: 'mailing-list' }, { formId: 'mktoForm_1042' }, { formId: 'hsForm_77' }, { class: 'hubspot' }]) {
    none(await read(two(attrs)), JSON.stringify(attrs));
  }
  for (const attrs of [{ class: 'footer-ish updates marketing' }, { class: 'subscriptionless' }, { id: 'signupsheet' }, { class: 'talent-pool community' }]) {
    const res = await read(two(attrs));
    assert.equal(res.form, '#f', `${JSON.stringify(attrs)} is not marketing: ${JSON.stringify(res)}`);
  }
  const resume = await read([el('div', { class: 'newsletter' }, [el('form', { id: 'r' }, [input('full_name'), input('r_email', 'email'), input('resume_url', 'url', { placeholder: 'Resume link' }), btn('go', 'submit', 'Submit')])])]);
  assert.equal(resume.form, '#r', 'a resume link overrides the attribute check');
});

// M-007-fix6-N26c
test('M-007-fix6-N26c a form inside <footer> or role=contentinfo with two identity fields does not qualify; a select is never an identity field', async () => {
  none(await read([el('footer', {}, [el('form', { id: 'ft' }, [input('first_name'), input('ft_email', 'email'), btn('go', 'submit', 'Submit')])])]), 'footer element');
  none(await read([el('div', { role: 'contentinfo' }, [el('form', { id: 'ci' }, [input('first_name'), input('ci_email', 'email'), btn('go', 'submit', 'Submit')])])]), 'role=contentinfo');
  none(await read([el('main', {}, [el('form', { id: 'sel' }, [input('s_email', 'email'), el('select', { id: 'category_name', name: 'category_name' }), btn('go', 'submit', 'Submit')])])]), 'email beside a select');
});

// M-007-fix6-ATS
test('M-007-fix6-ATS Greenhouse, Lever and Ashby application forms still qualify with their submit', async () => {
  const gh = await read([el('main', {}, [el('form', { id: 'application-form' }, [input('first_name'), input('last_name'), input('email', 'email'), input('phone', 'tel'), input('resume', 'file'), btn('gh_submit', 'submit', 'Submit application')])])]);
  assert.deepEqual([gh.form, gh.submit], ['#application-form', '#gh_submit']);
  const lever = await read([el('form', { id: 'lever' }, [input('resume-upload-input', 'file', { name: 'resume' }), input('n', 'text', { name: 'name' }), input('e', 'email', { name: 'email' }), btn('btn-submit', 'button', 'Submit application')])]);
  assert.deepEqual([lever.form, lever.submit], ['#lever', '#btn-submit']);
  const ashby = await read([el('main', {}, [el('form', { id: 'ashby_application' }, [input('_systemfield_name'), input('_systemfield_email', 'email'), input('_systemfield_resume', 'file'), btn('ashby_submit', 'submit', 'Submit Application')])])]);
  assert.deepEqual([ashby.form, ashby.submit], ['#ashby_application', '#ashby_submit']);
});
