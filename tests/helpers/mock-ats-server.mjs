// Local Greenhouse-style mock application form for the Chrome e2e tests: 127.0.0.1 on a random port, fake content only.
// GET /greenhouse/form?job=N serves the form for job N (job 1 when absent), and GET / serves the job-1 form; &captcha=1 adds a reCAPTCHA-style widget that
// loads nothing from the network. POST /greenhouse/submit?job=N records { job: N } (submissions()) plus the text fields
// and attached file names it carried (posted()), and answers with a confirmation page.
// Variants, all off by default: &badge=1 adds only an invisible reCAPTCHA badge (as most real Greenhouse forms carry),
// &submitcaptcha=1 makes the submit answer with a visible challenge page and record nothing, &required=1 adds a
// required "School" field no plan fills, so the browser's own validation blocks the submit.
// This is the only place a real Submit click may ever land.
import { createServer } from 'node:http';

export const FORM_TEXT = 'Mock Greenhouse application form 7Q3';

const jobOf = (url) => {
  const n = Number.parseInt(url.searchParams.get('job') ?? '1', 10);
  return Number.isInteger(n) && n > 0 ? n : 1;
};

const field = (id, label, input) => `<p><label for="${id}">${label}</label> ${input}</p>`;

const BADGE =
  '<div class="g-recaptcha" data-sitekey="fake-site-key-0000" data-size="invisible"><div class="grecaptcha-badge" style="width:256px;height:60px;position:fixed;bottom:14px;right:14px">' +
  '<iframe title="reCAPTCHA" src="about:blank#size=invisible" width="256" height="60"></iframe></div></div>';

// A synthetic JSON-LD JobPosting for job N, as real ATS pages carry one; chrome.mjs read-form saves its description as
// the job text (over the 80-word floor).
export const JOB_DESCRIPTION = 'Example Robotics is hiring a Software Engineering Intern for summer 2026, fully remote. You will build internal scheduling and automation tools in Python, write SQL queries against our analytics store, ship small features through code review, write tests for the tools you build, and work with a mentor on one scoped project that you present at the end of the summer. Requirements: pursuing a B.S. in Computer Science or a related field, coursework or projects in Python, and basic SQL. Nice to have: experience with scheduling tools, automation scripts or data dashboards, and clear written communication with a small team.';
export const jobPostingLd = (job) => JSON.stringify({ '@context': 'https://schema.org', '@type': 'JobPosting', title: `Software Engineering Intern (job ${job})`, description: `<p>${JOB_DESCRIPTION}</p>`, hiringOrganization: { '@type': 'Organization', name: 'Example Robotics' } });

export function formHtml(job, { captcha = false, badge = false, submitCaptcha = false, required = false } = {}) {
  const widget = captcha
    ? '<div class="g-recaptcha" id="recaptcha" data-sitekey="fake-site-key-0000"><iframe title="reCAPTCHA" src="about:blank" width="304" height="78"></iframe></div>'
    : badge
      ? BADGE
      : '';
  return [
    `<!doctype html><html><head><meta charset="utf-8"><title>Mock Greenhouse</title><script type="application/ld+json">${jobPostingLd(job)}</script></head><body>`,
    `<h1>${FORM_TEXT}</h1><p>Job ${job}: Software Engineering Intern at Example Robotics</p>`,
    `<form id="application_form" method="post" action="/greenhouse/submit?job=${job}${submitCaptcha ? '&challenge=1' : ''}" enctype="multipart/form-data">`,
    field('first_name', 'First Name', '<input id="first_name" name="first_name" type="text" required>'),
    field('last_name', 'Last Name', '<input id="last_name" name="last_name" type="text" required>'),
    field('email', 'Email', '<input id="email" name="email" type="email" required>'),
    field('phone', 'Phone', '<input id="phone" name="phone" type="tel">'),
    field('resume', 'Resume/CV', '<input id="resume" name="resume" type="file" required>'),
    field('cover_letter', 'Cover Letter', '<input id="cover_letter" name="cover_letter" type="file">'),
    field(
      'work_auth',
      'Are you legally authorized to work in the United States?',
      '<select id="work_auth" name="work_auth"><option value="">Select...</option><option value="Yes">Yes</option><option value="No">No</option></select>',
    ),
    field('question_fav', 'What is your favorite fake board game?', '<input id="question_fav" name="question_fav" type="text">'),
    required ? field('school', 'School', '<input id="school" name="school" type="text" required>') : '',
    widget,
    '<button id="submit_app" type="submit">Submit Application</button>',
    '</form></body></html>',
  ].join('\n');
}

// The parts of a multipart/form-data body: text fields by name, and the file name of every file part that carries bytes.
export function multipartParts(body, contentType) {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(String(contentType ?? ''));
  const fields = {};
  const files = {};
  if (!boundary) return { fields, files };
  for (const part of body.toString('latin1').split(`--${boundary[1] ?? boundary[2]}`)) {
    const split = part.indexOf('\r\n\r\n');
    if (split < 0) continue;
    const head = part.slice(0, split);
    const value = part.slice(split + 4).replace(/\r\n$/, '');
    const name = /name="([^"]*)"/i.exec(head)?.[1];
    if (!name) continue;
    const file = /filename="([^"]*)"/i.exec(head);
    if (file) {
      if (file[1] && value.length) files[name] = file[1];
    } else fields[name] = Buffer.from(value, 'latin1').toString('utf8');
  }
  return { fields, files };
}

export async function startMockAts() {
  const records = [];
  // Every recorded submit with the text fields and attached file names it carried (posted()); submissions() keeps its
  // { job } shape.
  const posts = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const job = jobOf(url);
    if (req.method === 'GET' && (url.pathname === '/greenhouse/form' || url.pathname === '/')) {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      const on = (k) => url.searchParams.get(k) === '1';
      res.end(formHtml(job, { captcha: on('captcha'), badge: on('badge'), submitCaptcha: on('submitcaptcha'), required: on('required') }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/greenhouse/submit') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        if (url.searchParams.get('challenge') === '1') {
          res.setHeader('content-type', 'text/html; charset=utf-8');
          res.end('<!doctype html><html><body><h1>One more step</h1><p>Please verify you are human.</p><iframe title="hCaptcha challenge" src="about:blank" width="400" height="300"></iframe></body></html>');
          return;
        }
        records.push({ job });
        posts.push({ job, ...multipartParts(Buffer.concat(chunks), req.headers['content-type']) });
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.end(`<!doctype html><html><body><h1>Application received</h1><p>Job ${job}</p></body></html>`);
      });
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    formText: FORM_TEXT,
    submissions: () => records.map((r) => ({ ...r })),
    posted: () => posts.map((p) => ({ job: p.job, fields: { ...p.fields }, files: { ...p.files } })),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
