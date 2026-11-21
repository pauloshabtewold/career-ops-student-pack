// Local Greenhouse-style mock application form for the Chrome e2e tests: 127.0.0.1 on a random port, fake content only.
// GET /greenhouse/form?job=N serves the form for job N (job 1 when absent); &captcha=1 adds a reCAPTCHA-style widget that
// loads nothing from the network. POST /greenhouse/submit?job=N records { job: N } and answers with a confirmation page.
// This is the only place a real Submit click may ever land.
import { createServer } from 'node:http';

export const FORM_TEXT = 'Mock Greenhouse application form 7Q3';

const jobOf = (url) => {
  const n = Number.parseInt(url.searchParams.get('job') ?? '1', 10);
  return Number.isInteger(n) && n > 0 ? n : 1;
};

const field = (id, label, input) => `<p><label for="${id}">${label}</label> ${input}</p>`;

export function formHtml(job, { captcha = false } = {}) {
  const widget = captcha
    ? '<div class="g-recaptcha" id="recaptcha" data-sitekey="fake-site-key-0000"><iframe title="reCAPTCHA" src="about:blank" width="304" height="78"></iframe></div>'
    : '';
  return [
    '<!doctype html><html><head><meta charset="utf-8"><title>Mock Greenhouse</title></head><body>',
    `<h1>${FORM_TEXT}</h1><p>Job ${job}: Software Engineering Intern at Example Robotics</p>`,
    `<form id="application_form" method="post" action="/greenhouse/submit?job=${job}" enctype="multipart/form-data">`,
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
    widget,
    '<button id="submit_app" type="submit">Submit Application</button>',
    '</form></body></html>',
  ].join('\n');
}

export async function startMockAts() {
  const records = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const job = jobOf(url);
    if (req.method === 'GET' && url.pathname === '/greenhouse/form') {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(formHtml(job, { captcha: url.searchParams.get('captcha') === '1' }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/greenhouse/submit') {
      req.resume();
      req.on('end', () => {
        records.push({ job });
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
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
