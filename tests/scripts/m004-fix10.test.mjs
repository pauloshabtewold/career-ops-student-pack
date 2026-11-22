// SYNTHETIC FIXTURE: placeholder people, companies and cv text only.
// M-004 fix 10, "warm prose + hard rails + independent verifier". The model writes each draft's body as prose from
// cv.md; code writes the greeting, an application follow-up's opening and an email's closing, fills the placeholders and
// assembles one final string. Deterministic rails check what is certain on that string; every draft that passes them
// goes to a separate 'outreach-verify' call that lists unsupported claims as strict JSON. These tests pin:
// - every review probe of rounds r4 to r8 reaches the verify prompt verbatim inside the final string, so no
//   deterministic path skips the verifier, and a verdict naming it flags the draft;
// - each malformed verdict fails closed; the redraft and re-verify path stays within 2 drafting and 2 verify calls;
// - each placeholder shape is a rail failure; checked === stored === sent for every draft kind;
// - the honest live replies of round 6 pass the rails; four sample drafts read like a person wrote them.
// The probe sentences are copied in as data from the review probe scripts (r4 to r8). Scratch roots, example.com
// addresses and an injected headless runner: no real model, network, Gmail or LinkedIn. With OUTREACH_SAMPLES_OUT set,
// the sample test also writes the four samples to that file for the reviewer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { clean } from '../../lib/clean-text.mjs';
import * as od from '../../scripts/outreach-drafts.mjs';
import { ACME, ALICE, APP, CV, GLOBEX, INITECH, SOURCES, TITLE, draftIn, person, roundFor } from '../helpers/outreach-verify-harness.mjs';

const NOTION = person('Nina Note', 'Notion');
const RITA_K = person('Rita Reply', INITECH, 'reply', { replyText: 'Thanks for connecting! Have you worked with Kubernetes or done any internships at Google?' });
const RITA_G = person('Rita Reply', INITECH, 'reply', { replyText: 'Did you ever intern anywhere? And what is your GPA?' });

// Every claim probe of reviews r4 to r7 (the fix 9 list).
const PROBES = [
  // r4/r5 (fix 7)
  'Hi Alice, I interned at Acme Example last summer and loved it.', 'Hi Alice, I worked at Acme Example on the data team.',
  'I was a Software Engineering Intern at Globex Example before.', 'I worked as a Software Engineering Intern last year.',
  'I also worked as a Data Engineer at Initech Example.', 'I applied to Acme Example, where I interned last summer.',
  'I applied for the Software Engineering Intern position, where I worked last summer.', 'Thanks, Acme Example, where I interned last summer, was great.',
  "I'm curious about the work at Acme Example, where I interned last summer.", "I'm curious about the data team at Acme Example who trained me.",
  "I'm curious about returning to the data team at Acme Example.", "I'm curious about getting back to the team at Acme Example.",
  "I'd love to return to the team at Acme Example.", 'Hello Globex Example hiring team, I interned with you last summer.',
  'I applied for the Software Engineering Intern role after interning there.', 'My internship at Acme Example taught me a lot.',
  'Acme Example hired me last summer.', "Acme Example's data team is where I interned.", 'It would be great to be back at Acme Example.',
  'I applied to Acme Example again after my summer at Acme Example.', "I've applied for the Software Engineering Intern role I held at Globex Example in 2025.",
  'Acme Example, where I interned last summer, is my top choice.', "I'd love to join Acme Example, where I interned last summer.",
  'I interned at HP last summer.', 'I worked at IBM on the data team.', 'I mentored 14 students last year.', 'I grew signups by 11% at my club.',
  'I hold a CS degree.', 'I build AI models in my spare time.', 'I am finishing my MBA this spring.', 'I do ML research.',
  // r6 (fix 8)
  'Having interned at {company} last summer, I would love to learn more.', "As {company}'s summer intern, I would like to stay in touch.",
  'As a {title} at {company} last summer, I would like to follow up.', "I'm glad to have interned at {company}.", "I'm excited to have worked with the {company} data team.",
  'I really enjoyed working at {company} last summer.', 'I successfully interned at {company}.', 'Interning at {company} last summer showed me what good code review looks like.',
  'Last summer at {company} was the best part of my degree.', 'Our team partnered with {company} on a campus project.', 'My team and I shipped a feature for {company} last summer.',
  'I, too, interned at {company}.', "I'm thrilled to still be part of {company}.", 'Working at {company} taught me Python.', 'I applied my Python skills at {company} last summer.',
  "I submitted a pull request to {company}'s open source repo.", 'I wanted to thank {company} for hosting me last summer.', "I reached the finals of {company}'s hackathon.",
  'I heard about {company} from my manager there.', "I'm interested in {company} because I used to work there.", 'I decided to follow up since I spent a summer at {company}.',
  'I hoped {company} remembered my internship.', 'I would love to rejoin the work at {company}.', 'I got to work with your team last summer.',
  'I know {company} well. I interned there last summer.', 'I enjoyed working with your team last summer.', 'It was great working with you all on the data team.',
  'I interned with your team in 2026.', 'I loved my summer there and want to learn more about {company}.', "I'm curious about the work at {company}. There I interned for a summer.",
  'I was on your team last year.', 'I interned at AE last summer.', 'I hold an MBA.', 'I build ML models at Sample Labs.', 'I interned at Initrode Example last summer.',
  'I studied at Example Tech, not just Example State University.', 'I know Kubernetes and Rust well.', 'I was a TA at {company}.', 'I applied on 11/14.',
  // r7
  "I'm curious about the work at {company}. I interned with them last summer.", '{company} is hiring, and I know them well: I interned with them last summer.',
  "It's where I interned last summer.", 'They hired me as an intern last summer.', 'I interned at the company last summer.', 'I interned for you last summer.',
  'I worked under you on the data team last summer.', 'You hired me last summer, so I wanted to reconnect.', 'You were my manager during my internship.',
  'I was one of your interns last summer.', 'I interned on your engineering team last summer.', 'I was on your data team last summer.',
  'As your former intern, I would love to reconnect.', 'Your engineers mentored me last summer.', "I interned with y'all last summer.",
  "I developed {company}'s product last summer.", "I designed {company}'s mission statement.", "{company}'s product is something I helped design.",
  "I wrote the docs for {company}'s products.", 'I supported your work at {company} last summer.', 'I applied to {company} last year and got an offer.',
  'I applied with {company} last year and was hired.', 'I held the {title} role last summer.', 'I was offered the {title} position last spring.',
  'I completed the {title} internship last summer.', 'The people at {company} were so welcoming last summer.', 'I learned so much from the people at {company} last summer.',
  'I miss the people at {company}.', '{company} could have a position for me since I already know the codebase.', 'I had lunch with you at {company} last week.',
  'I loved the work at {company} last summer.', 'I read about {company} in my offer letter.', "I'd been interning there.", 'Having spent a summer with your team, I would love to reconnect.',
  'As an intern on your team, I learned a lot.', 'I used to intern with the people at {company}.', "I'm interested in {company} because I interned there.",
  '{company} is hiring former interns like me.', 'Interned with your team last summer and loved it.', 'I have been working with your team since June.',
  'I interned at acme example last summer.', 'I interned at ACME EXAMPLE last summer.', 'I interned at Acme-Example last summer.', 'I interned at AcmeExample last summer.',
  'I met folks from A.E. at a fair.', 'I was a software engineering intern at globex example.', 'I applied for the role on november 14.',
  'Happy to share that our team won first.', "I'd love to share that my Campus Bus Tracker took first.", 'Can I share that I graduated first?',
  'I was your first intern, remember?', 'Was I your first intern hire?', 'I built 14 apps at Sample Labs.', 'I use Kubernetes and Rust daily.', 'I interned at initrode last summer.',
];

// Review r8 probes (claims a slot grammar let through), as the model body.
const R8 = [
  [ALICE, 'Does {company} still use the pipeline built during the internship?'], [ALICE, 'Did you see the {company} internship on the profile?'],
  [ALICE, 'Is the data team still using the dashboard from the summer internship?'], [ALICE, 'Did the team ever ship the feature the summer intern built?'],
  [ALICE, 'Is the offer from {company} still open?'], [ALICE, 'Is the offer from Acme Example still open?'], [ALICE, 'Would the hiring manager at {company} vouch for the summer project?'],
  [ALICE, 'Would a stanford graduate with a google internship fit the team?'], [ALICE, 'Have you had a chance to look at the kubernetes project on the profile?'],
  [ALICE, 'What did the team think of the pull request merged into the {company} repo?'], [ALICE, 'Is the mentor from the {company} internship still on the team?'],
  [ALICE, "Does it help that the note's author holds a stanford degree?"], [ALICE, 'Did the referral from the manager reach you?'],
  [RITA_K, 'Yes, absolutely.'], [RITA_G, 'Yes, definitely, and happy to share more.'], [RITA_K, 'Yes, comfortable with kubernetes.'], [RITA_K, 'Yes, Google is on the resume.'],
  [ALICE, 'Happy to share notes from the globex internship.'], [ALICE, 'Happy to share the stanford transcript anytime.'], [ALICE, 'Happy to walk through the initrode dashboard sometime.'],
  [ALICE, 'Fluent in rust and go.'], [ALICE, 'Rust is a daily tool.'], [ALICE, 'Stanford grads tend to enjoy this kind of work.'], [ALICE, "Proud recipient of the dean's award."],
  [ALICE, "Dean's list every semester, so happy to share grades."], [ALICE, 'Happy to share the google offer details.'], [ALICE, 'A stanford degree and a google internship are on the resume.'],
  [ALICE, 'The resume shows a google internship and a stanford degree.'], [ALICE, 'Comfortable with production on-call work and incident reviews.'],
  [ALICE, 'I\u2019m a stanford grad.'], [ALICE, 'I\u02bcm a stanford grad.'], [ALICE, '\u0406 hold a stanford degree.'], [ALICE, '\uff29 hold a stanford degree.'],
  [ALICE, 'Happy to chat, and \u0406 hold a stanford degree.'], [ALICE, 'Me\u200b and the team say hi.'], [ALICE, 'W\u0435 love the mission.'],
  [ALICE, 'Hired as an intern by the globex data team.'], [ALICE, 'Coded the initrode mobile app.'], [ALICE, 'Fixed bugs in the initrode checkout flow.'],
  [ALICE, 'Owned the initrode billing service.'], [ALICE, 'Aced every data structures exam.'], [ALICE, 'Loved the summer on the data team.'],
  [ALICE, 'Used rust and go daily on the data team.'], [ALICE, 'Won the hackathon at initrode.'], [ALICE, 'Placed at the top of the class.'],
  [APP, 'Hired as an intern by the initrode data team.'], [APP, 'The resume shows a stanford degree and a google internship.'],
  [person('Rita Reply', INITECH, 'reply', { replyText: 'Thanks! Did you ever intern at Google or use Kubernetes?' }), 'Would it help that Google was the internship host?'],
  [person('Rita Reply', INITECH, 'reply', { replyText: 'Thanks! Did you ever intern at Google or use Kubernetes?' }), 'Does Kubernetes experience from the Google internship matter for the team?'],
  [ALICE, 'Interned at {company} last summer.'], [ALICE, 'Former {company} intern.'], [ALICE, 'Part of your data team.'], [ALICE, 'Knows your codebase well.'],
  [ALICE, 'Holds an MBA.'], [ALICE, 'Big fan of acme example since the internship.'],
];

// Contact probes run as a follow-up, the one contact kind with no length cap and no first-message referral rail, so only
// the verifier can hold them (the code path from the body to the verifier is the same for every kind).
const NORA = person('Nora Nudge', ACME, 'follow-up');
const jobOf = (text) => (/\{title\}|Software Engineering Intern|11\/14|november 14|globex example/i.test(text) ? APP : /notion/i.test(text) ? { ...NOTION, action: 'follow-up' } : NORA);
// The probe as it must appear in the final string: the code takes off a leading greeting and fills the placeholders.
const expected = (text, job) => {
  const body = clean(text).replace(/^(?:hi|hello)\b[^,\n]*,\s*/i, '').replace(/^\p{Ll}/u, (c) => c.toUpperCase());
  return od.fillPlaceholders(body, job).normalize('NFKC');
};
const ALL_PROBES = () => [...PROBES.map((t) => [jobOf(t), t]), ...R8.map(([job, t]) => [job === ALICE ? NORA : job, t])];

test('fix 10 G every r4 to r8 probe reaches the verify prompt verbatim, inside the exact final string, and a verdict naming it flags the draft', async () => {
  assert.equal(PROBES.length, 125, 'the r4 to r7 list');
  for (const [job, text] of ALL_PROBES()) {
    const want = expected(text, job);
    const flagIt = (prompt) => JSON.stringify({ unsupported: draftIn(prompt)?.includes(want) ? [want] : [] });
    const out = await roundFor(job, { drafts: [text], verdict: flagIt });
    assert.ok(out.verifies.length >= 1, `the verifier ran: ${text} (flags: ${JSON.stringify(out.res.flagged)})`);
    const draft = draftIn(out.verifies[0].prompt);
    assert.ok(draft.includes(want), `verbatim in the verified draft: ${want}\n---\n${draft}`);
    assert.equal(draft, od.checkDraft(text, job, { sources: SOURCES }).text, 'the verified draft is the exact final string');
    if (job.replyText) assert.ok(out.verifies[0].prompt.includes(job.replyText), 'the contact question is in the verify prompt');
    assert.equal(out.items.length, 0, `flagged and kept out: ${text}`);
    assert.equal(out.res.flagged.length, 1);
    assert.ok(out.res.flagged[0].flags.join('; ').includes(want), 'the flag quotes the claim for the student');
    assert.ok(out.drafting.length <= 2 && out.verifies.length <= 2, 'budget');
  }
});

test('fix 10 G the same probes are batched only when the verifier passes them: no deterministic claim rule is left', async () => {
  let batched = 0;
  for (const [job, text] of ALL_PROBES()) {
    const out = await roundFor(job, { drafts: [text] });
    if (out.items.length) batched += 1;
    else assert.fail(`a probe was held without the verifier: ${text}: ${JSON.stringify(out.res.flagged)}`);
  }
  assert.equal(batched, ALL_PROBES().length);
});

// Malformed verifier replies: each fails closed (flagged, never batched, no redraft on an unreadable verdict; fix 11 N1
// re-verifies the same draft once).
const MALFORMED = {
  'non-JSON': 'Looks fine to me, nothing unsupported.',
  'code-fenced JSON with extra prose': 'Here is the result:\n```json\n{"unsupported": []}\n```',
  '"unsupported" missing': '{"claims": []}',
  '"unsupported" a string': '{"unsupported": "none"}',
  'two objects': '{"unsupported": []}\n{"unsupported": []}',
};
for (const [kind, reply] of Object.entries(MALFORMED)) {
  test(`fix 10 E a malformed verdict fails closed: ${kind}`, async () => {
    const out = await roundFor(ALICE, { drafts: ["I'm a CS student and curious how your team works. What does a typical week look like for you?"], verdict: () => reply });
    assert.equal(out.items.length, 0, 'never batched');
    // Fix 11 N1: one re-verify of the same draft within the 2-verify budget, then the flag; still no redraft.
    assert.equal(out.verifies.length, 2);
    assert.equal(out.drafting.length, 1);
    assert.match(out.res.flagged[0].flags.join('; '), /did not answer in the required JSON/);
    assert.equal(od.parseVerdict(reply), null);
  });
}

test('fix 10 E parseVerdict: only one JSON object (bare or alone in one json fence) with an array of strings is read', () => {
  assert.deepEqual(od.parseVerdict('{"unsupported": []}'), []);
  assert.deepEqual(od.parseVerdict(' {"unsupported": ["interned at Acme"]} '), ['interned at Acme']);
  assert.deepEqual(od.parseVerdict('```json\n{"unsupported": ["x"]}\n```'), ['x']);
  for (const bad of ['', 'null', '[]', '{"unsupported": null}', '{"unsupported": [1]}', '{"unsupported": [""]}', '{"unsupported": {}}', 'Sure. {"unsupported": []}', '{"unsupported": []} Done.', '```\n{"unsupported": []}\n```\nok']) {
    assert.equal(od.parseVerdict(bad), null, bad);
  }
});

const INVENTED = "I interned on your platform team last summer and built your Kubernetes clusters. What is the team working on now?";
const HONEST = "I'm a CS student who automated a weekly report at my internship. What kind of problems does your team spend the most time on?";
const kube = (prompt) => JSON.stringify({ unsupported: draftIn(prompt).includes('Kubernetes') ? ['built your Kubernetes clusters', 'interned on your platform team last summer'] : [] });

test('fix 10 E an unsupported claim gets one redraft quoting it, then a second verdict; an honest redraft is batched', async () => {
  const out = await roundFor(ALICE, { drafts: [INVENTED, HONEST], verdict: kube });
  assert.equal(out.drafting.length, 2);
  assert.equal(out.verifies.length, 2);
  assert.match(out.drafting[1].prompt, /found statements it does not support:\n- "built your Kubernetes clusters"\n- "interned on your platform team last summer"\nRemove or correct these; use only facts from the resume\./);
  assert.deepEqual(out.res.flagged, []);
  assert.equal(out.items[0].message, `Hi Alice,\n\n${HONEST}`);
  assert.equal(draftIn(out.verifies[1].prompt), out.items[0].message);
});

test('fix 10 E budget: claims still listed after the redraft flag the draft with the quoted claims; never more than 2 + 2 calls', async () => {
  const out = await roundFor(ALICE, { drafts: [INVENTED], verdict: kube });
  assert.equal(out.drafting.length, 2);
  assert.equal(out.verifies.length, 2);
  assert.equal(out.items.length, 0);
  assert.match(out.res.flagged[0].flags[0], /^claims your cv\.md does not support: "built your Kubernetes clusters"; "interned on your platform team last summer"$/);
  assert.ok(out.said.some((s) => s.includes('Alice Alpha') && s.includes('built your Kubernetes clusters')), 'listed for the student');
  // A rail failure uses the redraft: a later unsupported claim is flagged with no third drafting call.
  const railThenClaim = await roundFor(ALICE, { drafts: ['Big fan of the {team_name} work. What is new?', INVENTED], verdict: kube });
  assert.equal(railThenClaim.drafting.length, 2);
  assert.equal(railThenClaim.verifies.length, 1);
  assert.equal(railThenClaim.items.length, 0);
  // Two rail failures: no verify call at all, flagged.
  const rails = await roundFor(ALICE, { drafts: ['Big fan of the {team_name} work. What is new?'] });
  assert.equal(rails.drafting.length, 2);
  assert.equal(rails.verifies.length, 0);
  assert.match(rails.drafting[1].prompt, /Your last draft broke these rules:\n- placeholder-like text "\{team_name\}"/);
  assert.equal(rails.items.length, 0);
});

// D. Placeholder shapes (r7 S3, r8 S1): each is a rail failure on the final string.
const SHAPES = ['{company }', '{COMPANY}', '{company_name}', '{{ company }}', '{{company}}', '<company>', '${company}', '\uff5bcompany\uff5d', '(company name)', '[Company Name]', '&lt;company&gt;',
  '{applied_date}', '[Company]', '{Company}', '{ company }', 'the ___ team', 'XXX', '(Company)', '%company%', '$company', '@company', '#company', ':company', '\u2774company\u2775', '\ufe5bcompany\ufe5c',
  '\u2983company\u2984', 'company_name', 'first_name', 'job_title', '(your name)', '(insert company)', 'COMPANY NAME', 'TBD', '\u3010company\u3011', '\u300acompany\u300b', '{title}', '%s'];

test('fix 10 D every placeholder shape is a rail failure; ordinary words, parentheses and filled names pass', () => {
  for (const shape of SHAPES) {
    const r = od.checkDraft(`I'd love to learn about the ${shape} work. What is new?`, ALICE, { sources: SOURCES });
    assert.match(r.flags.join('; '), /placeholder-like text/, shape);
  }
  for (const ok of ['the company culture', 'my role (summer 2026)', 'the data team', 'name a tool', 'the title role', 'a #1 priority', 'a date night', 'an @-mention']) {
    assert.deepEqual(od.checkDraft(`I'd love to learn about ${ok}. What is new at {company}?`, ALICE, { sources: SOURCES }).flags, [], ok);
  }
});

test('fix 10 D the other rails: Subject line, blank-line runs, length caps, links and addresses, referral ask, empty body', async () => {
  const f = (t, job = ALICE) => od.checkDraft(t, job, { sources: SOURCES }).flags.join('; ');
  assert.match(f('Thanks for connecting.\nSubject: hello\nWhat is new?'), /Subject line/);
  assert.equal(od.checkDraft('Subject: Following up\n\nI think the role fits.', APP, { sources: SOURCES }).text.includes('Subject'), false, 'a leading Subject line is taken off');
  assert.match(f('Thanks.\n\n\nWhat is new?'), /more than one blank line/);
  assert.match(f(`${'very '.repeat(60)}good. What is new?`), /opener of \d+ characters exceeds the 299 limit/);
  assert.match(f('Your posts on testing are a great read and I would like to connect.', person('Carl Connect', 'Wayne Example', 'connect', { noteChars: 40 })), /note of \d+ characters exceeds the 40 limit/);
  assert.match(f('See https://portfolio.example.net/sam for more. What is new?'), /link or email address your data does not hold: https:\/\/portfolio\.example\.net\/sam/);
  assert.match(f('Write me at sam.p@example.org. What is new?'), /sam\.p@example\.org/);
  assert.match(f('My site is samplace.dev. What is new?'), /samplace\.dev/);
  assert.equal(f('Write me at sam@example.com any time. What is new?'), '', 'the profile email is the student\'s own');
  assert.match(f('Would you be open to referring me? What is new?'), /referral in a first message/);
  assert.match(f('Best regards,\nSam Placeholder'), /no body/);
  const twice = await roundFor(person('Carl Connect', 'Wayne Example', 'connect'), { drafts: [`${'Your work looks great. '.repeat(12)}`, 'Your posts on Python tools are a great read.'] });
  assert.equal(twice.drafting.length, 2);
  assert.match(twice.drafting[1].prompt, /note of \d+ characters exceeds the 200 limit/);
  assert.equal(twice.items[0].message, 'Hi Carl, your posts on Python tools are a great read.');
});

test('fix 10 D the final string is NFKC-normalized before the rails and stored that way (r8 M3)', async () => {
  const out = await roundFor(ALICE, { drafts: ['\uff29 hold a stanford degree. What is new at \uff21cme?'] });
  assert.equal(out.items[0].message, 'Hi Alice,\n\nI hold a stanford degree. What is new at Acme?');
  assert.equal(draftIn(out.verifies[0].prompt), out.items[0].message);
});

// E. checked === stored === sent, for every draft kind (r8 N2).
const KIND_CASES = [
  [ALICE, "I'm a CS student who automated a weekly report at my internship. What does your team spend the most time on?"],
  [person('Carl Connect', 'Wayne Example', 'connect'), 'Your posts on Python tools are a great read, and I would like to connect.'],
  [person('Nora Nudge', 'Umbrella Example', 'follow-up'), 'Just a quick nudge on my note in case it got buried. Would a short chat in the next few weeks work?'],
  [person('Rita Reply', INITECH, 'reply', { replyText: 'When do you graduate?' }), 'Thanks for asking! I graduate in May 2027. Which teams at {company} take interns?'],
  [person('Gina Globex', GLOBEX, 'referral-ask'), 'Really enjoyed the conversation about the platform team. Would you be comfortable referring me for an open role at {company}? It is completely fine to say no.'],
  [APP, 'The focus on practical internal tools stands out, and I built something similar at my internship. I am happy to send code samples.'],
];

test('fix 10 E checked === stored === verified for every draft kind, and === sent for the email', async () => {
  for (const [job, body] of KIND_CASES) {
    const checked = od.checkDraft(body, job, { sources: SOURCES });
    assert.deepEqual(checked.flags, [], job.action);
    const due = job.action === 'referral-ask' ? job : job;
    const out = await roundFor(due, { drafts: [body], send: job.channel === 'email' });
    assert.equal(out.items.length, 1, `${job.action}: ${JSON.stringify(out.res.flagged)}`);
    assert.equal(out.items[0].message, checked.text, `${job.action} stored === checked`);
    assert.equal(draftIn(out.verifies[0].prompt), checked.text, `${job.action} verified === checked`);
    if (job.channel === 'email') assert.equal(out.sentBody, checked.text, 'sent === checked');
  }
});

// The honest live replies of round 6 (ev/r6, synthetic student), as the model wrote them.
const R6 = [
  ['2a warm-opener', ALICE, "Hi {first_name}, I'm a CS student who recently automated a weekly report at an internship, and it got me curious about how teams at {company} handle everyday workflow problems like that. What kind of problems does your work involve most often?"],
  ['2a connect', person('Carl Connect', 'Wayne Example', 'connect', { noteChars: 300 }), "Hi {first_name}, I'm a computer science student at Example State University who builds with Python and JavaScript. I'd enjoy connecting and following the work you and the team at {company} are doing."],
  ['2a follow-up', person('Nora Nudge', 'Umbrella Example', 'follow-up'), "Hi {first_name}, just a quick nudge on my earlier note in case it got buried. I'm a computer science student graduating in May 2027, and I'd love to learn more about the work at {company}. Would you be open to a short chat sometime in the next couple of weeks?"],
  ['2a reply', person('Rita Reply', INITECH, 'reply', { replyText: 'Thanks for connecting! When do you graduate, and which team interests you?' }), "Thanks for getting back to me, {first_name}! I graduate in May 2027 with a computer science degree from Example State University.\n\nI don't have a specific team in mind yet. I'm most interested in software engineering work where I can use Python, JavaScript and SQL. This past summer I interned at Sample Labs and built a Python script that cut a weekly report from 2 hours to 10 minutes, and I'd love to keep doing that kind of practical problem solving at {company}.\n\nIf you can tell me which teams might be a good fit for someone with my background, I'd be glad to learn more about them. Is there a team you would suggest I look at first?"],
  ['2a application-follow-up', APP, 'I wanted to follow up on my application for the {title} role at {company}, which I submitted on {applied_date}. I remain very interested in the position.\n\nI think I would be a good fit because during my software engineering internship at Sample Labs, I built a Python script that cut a weekly report from 2 hours to 10 minutes. I enjoyed finding a practical way to save a team time, and I would like to bring that approach to your team.\n\nIf there is anything else I can send, such as code samples or a transcript, I would be happy to provide it. There is no rush, and I understand you may still be reviewing applications.'],
  ['2b connect', person('Carl Connect', 'Wayne Example', 'connect', { noteChars: 300 }), "Hi {first_name}, I'm a CS student at Example State University and built a Python script as an intern that cut a weekly report from 2 hours to 10 minutes. I'd like to follow the work at {company}."],
  ['2b follow-up', person('Nora Nudge', 'Umbrella Example', 'follow-up'), "Just wanted to gently bring my earlier note back to the top of your inbox, {first_name}. I'm a computer science student with a software engineering internship behind me, and I'm still very interested in what the team at {company} is working on.\n\nWould you be open to a quick 15 minute chat in the next couple of weeks?"],
  ['2b reply', person('Rita Reply', INITECH, 'reply', { replyText: 'Which kind of team interests you?' }), "Thanks for getting back to me, {first_name}. I'm most interested in software engineering work, ideally a team at {company} that builds and improves tools or data-driven products. I did a software engineering internship last summer where I wrote a Python script that cut a weekly report from 2 hours to 10 minutes, and I enjoyed that kind of practical problem solving.\n\nI graduate in May 2027. If you can tell me which teams at {company} might be a good fit, I'd love to learn more. Would a short call sometime soon work for you?"],
  ['2b application-follow-up', APP, 'I wanted to follow up on my application for the {title} role at {company}, which I submitted on {applied_date}. I believe I would be a good fit because during my summer internship at Sample Labs I built a Python script that cut a weekly report from 2 hours to 10 minutes, and I enjoy finding practical ways to make work faster and simpler.\n\nIf there is anything else I can send, such as code samples or more details about my projects, I would be glad to share it. There is no rush, and I understand you may still be reviewing applications.'],
  ['3a warm-opener', ALICE, "Hi {first_name}, I'm a computer science student who recently built a small Python script that turned a 2 hour weekly report into 10 minutes, and that got me curious about how teams at {company} approach automation. What kind of problems does your team spend the most time on?"],
  ['3a connect', person('Carl Connect', 'Wayne Example', 'connect', { noteChars: 300 }), "Hi {first_name}, I'm a CS student at Example State University and a former software engineering intern. I'm interested in the work {company} does and would like to connect and follow your updates."],
  ['3a follow-up', person('Nora Nudge', 'Umbrella Example', 'follow-up'), "Hi {first_name}, just a quick nudge on my earlier note. I'm a computer science student graduating in May 2027, and I'd love to learn more about the kinds of early-career roles {company} hires for. Would you be open to a short chat, or is there a better person for me to reach out to?"],
  ['3a reply', person('Rita Reply', INITECH, 'reply', { replyText: 'When do you graduate?' }), "Thanks for getting back to me, {first_name}! I graduate in May 2027 with a computer science degree from Example State University. I'm most interested in software engineering roles at {company}, since that's what I did this past summer as an intern, where I built a Python script that cut a weekly report from 2 hours to 10 minutes. I'm also open to whichever team you think would be a good fit for my background in Python, JavaScript and SQL. Is there a team you'd suggest I look at?"],
  ['3a application-follow-up', APP, 'I wanted to follow up on my application for the {title} position at {company}, which I submitted on {applied_date}. I remain very interested in the role.\n\nI believe I would be a good fit because of my internship at Sample Labs, where I built a Python script that cut a weekly report from 2 hours to 10 minutes. I enjoyed finding a practical way to save people time, and I would like to bring that approach to your team.\n\nIf there is anything else I can send, such as code samples or a transcript, I would be happy to share it. There is no rush at all, and I understand you are likely reviewing many applications.'],
  ['3b application-follow-up', APP, 'I wanted to follow up on my application for the {title} role at {company}, which I submitted on {applied_date}. I am still very interested in the position.\n\nOne reason I think I would be a good fit is my internship experience at Sample Labs, where I built a Python script that cut a weekly report from 2 hours to 10 minutes. I enjoyed finding a practical way to save time for the team, and I would be glad to bring that approach to the work at {company}.\n\nIf there is anything else I can send, such as code samples or more details about my projects, please let me know. There is no rush at all, and I understand you may still be reviewing applications.'],
];

test('fix 10 G the honest round 6 live replies pass the rails with no flag; the application and the date are stated once, the name once', () => {
  for (const [src, job, text] of R6) {
    const r = od.checkDraft(text, job, { sources: SOURCES });
    assert.deepEqual(r.flags, [], `${src}: ${r.text}`);
    const first = od.placeholderValues(job).first_name;
    if (first) assert.equal(r.text.split(first).length - 1, 1, `${src}: the name once: ${r.text}`);
    if (job === APP) {
      assert.equal(r.text.match(/November 14, 2026/g).length, 1, `${src}: the date once`);
      assert.ok(!/follow up on my application/.test(r.text), `${src}: no restated application: ${r.text}`);
      assert.equal(r.text.match(/thank/gi).length, 1, `${src}: one thanks`);
    }
  }
});

test('fix 10 B the drafting prompt: fixed rules and cv.md first (cacheable), article-digest.md when present, contact data last, no date', async () => {
  const a = od.draftPrompt({ ...ALICE, cv: CV });
  const b = od.draftPrompt({ ...APP, cv: CV });
  const prefix = a.slice(0, a.indexOf('Task:'));
  assert.ok(b.startsWith(prefix) && prefix.includes(CV.trim()), 'one cached prefix for every kind holds the cv');
  assert.match(prefix, /Write the body only\. Code adds the greeting/);
  assert.ok(a.indexOf('Contact: Alice Alpha at Acme Example') > a.indexOf('Task:'));
  assert.ok(!/2026-11-14|November 14|\{applied_date\}/.test(b), b);
  const out = await roundFor(ALICE, { drafts: [HONEST], extraFiles: { 'article-digest.md': '# Digest\n\nWrote a campus newspaper piece on bus routes.\n' } });
  assert.match(out.drafting[0].prompt, /ARTICLE DIGEST \(article-digest\.md, also a source of facts\):\n# Digest/);
  // Fix 11 B: each block sits in its own fence with a per-call tag.
  assert.match(out.verifies[0].prompt, /ARTICLE DIGEST \(article-digest\.md\):\n<<<DIGEST-([0-9a-f]+)>>>\n# Digest[\s\S]*?\n<<<END-DIGEST-\1>>>/);
});

test('fix 10 E and H the verify call: step outreach-verify with the draft kind\'s feature, resume first, the draft last', async () => {
  const out = await roundFor(ALICE, { drafts: [HONEST] });
  const v = out.verifies[0];
  assert.equal(v.step, 'outreach-verify');
  assert.equal(v.feature, 'M7');
  assert.equal(out.drafting[0].step, 'outreach-warm-opener');
  assert.ok(v.prompt.indexOf('RESUME (cv.md):') < v.prompt.indexOf('DRAFT:'));
  assert.ok(v.prompt.includes(CV.trim()));
  assert.match(v.prompt, /\{"unsupported": \["<exact quote from the draft>", \.\.\.\]\}/);
  assert.match(v.prompt, /Questions to the reader, wishes, interest, plans/);
  // Fix 11 B: the fence tag is new per call, so the shared prefix is the rules up to the RESUME fence; with one tag the
  // prefix through the resume is the same for every draft.
  const other = od.verifyPrompt({ cv: CV, job: APP, draft: 'x' });
  const rules = v.prompt.slice(0, v.prompt.indexOf('<<<RESUME-'));
  assert.ok(other.startsWith(rules), 'the same rules prefix for every draft');
  const one = (job) => od.verifyPrompt({ cv: CV, job, draft: 'x', tag: '0a1b2c3d' });
  assert.ok(one(APP).startsWith(one(ALICE).slice(0, one(ALICE).indexOf('READER'))), 'the same prefix through the resume for one tag');
  assert.match(other, /Reader: Hiring team at Globex Example, role: Software Engineering Intern/);
});

// F. Sample drafts from realistic prose replies (ev/r5 and ev/r6 honest replies, adapted to body-only shape).
const SAMPLES = [
  ['warm opener', ALICE, "Thanks for connecting! I'm a CS student, and at my internship this summer I automated a weekly report that used to take a couple of hours, which got me curious about how teams at {company} handle everyday workflow problems. What kind of problems does your work involve most often?"],
  ['reply suggestion', person('Rita Reply', INITECH, 'reply', { replyText: 'Thanks for connecting! When do you graduate, and which team interests you?' }), "Thanks for getting back to me so quickly! I graduate in May 2027 with a computer science degree from Example State University.\n\nI don't have one team in mind yet. I'm most interested in software engineering work where I can use Python and SQL; this past summer I interned at Sample Labs and wrote a small script that turned a two-hour weekly report into a ten-minute one, and I'd love to keep doing that kind of practical work. Is there a team at {company} you would suggest I look at?"],
  ['referral ask', person('Gina Globex', GLOBEX, 'referral-ask'), "Really enjoyed our conversation about the platform team, and your advice on keeping side projects small was a big help. I'm planning to apply to an open role on that team. Would you be comfortable referring me? It is completely fine to say no, and I'm grateful for the time either way."],
  ['application follow-up', APP, 'I remain very interested in the position. The focus on practical internal tools stands out to me: during my internship at Sample Labs I wrote a Python script that cut a weekly report from hours to minutes, and I enjoyed making a team\'s week a little easier.\n\nIf code samples or anything else would help, I would be glad to send them.'],
];

test('fix 10 F four sample drafts from prose replies read like a person wrote them (written out for the reviewer)', (t) => {
  const cvLines = CV.split('\n').map((l) => l.replace(/^[-#\s]+/, '').trim()).filter((l) => l.length >= 30);
  const out = [];
  for (const [name, job, body] of SAMPLES) {
    const sampleJob = job;
    const r = od.checkDraft(body, sampleJob, { sources: SOURCES });
    assert.deepEqual(r.flags, [], name);
    const first = od.placeholderValues(sampleJob).first_name;
    if (first) assert.equal(r.text.split(first).length - 1, 1, `${name}: the name once`);
    assert.ok((r.text.match(/\bthank/gi) ?? []).length <= 1, `${name}: one thanks at most`);
    for (const line of cvLines) assert.ok(!r.text.includes(line.slice(0, 40)), `${name}: no pasted cv line: ${line}`);
    assert.ok(!/\bAlso:|A bit about me:|B\.S\.$/m.test(r.text), `${name}: no stacked fact frames`);
    assert.ok(!/[{}]/.test(r.text));
    out.push(`--- ${name}\n${r.text}\n`);
    t.diagnostic(`--- ${name}\n${r.text}`);
  }
  const file = process.env.OUTREACH_SAMPLES_OUT;
  if (file) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, out.join('\n'));
  }
  assert.equal(od.checkDraft(SAMPLES[3][2], APP, { sources: SOURCES }).text.match(/I applied for the Software Engineering Intern role at Globex Example on November 14, 2026/g).length, 1);
});
