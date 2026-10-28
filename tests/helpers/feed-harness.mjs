// Shared fixtures for the feed tests: scratch data dirs, a recording fetch stub with in-flight tracking,
// synthetic list files for each parser format, and a cycle/preset pair.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const TODAY = '2026-10-27';
export const LOCK = '\u{1F512}';
export const ARROW = '↳';

export const CYCLE = {
  computed_at: '2026-10-27T12:00:00.000Z',
  today: TODAY,
  phase: 'recruiting',
  terms: [{ name: 'Summer', year: 2027, start: '2027-06-01' }],
  newgrad_years: [2027],
  internship_years: [2027],
  experience_ceiling_years: 2,
};

export const PRESET = {
  early_career: 'intern|new grad|university|graduate',
  title_rules: { include: ['software|data|engineer'], exclude: ['sales', 'recruiter'] },
  search_terms: ['summer 2027 internships', 'new grad 2027'],
};

export function scratch(prefix = 'feeds-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const data = join(dir, 'data');
  mkdirSync(data, { recursive: true });
  return { dir, data, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export const writeJson = (file, obj) => writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`);
export const readText = (file) => readFileSync(file, 'utf8');
export const tsvLines = (file) => (existsSync(file) ? readText(file).split('\n').filter(Boolean).map((l) => l.split('\t')) : []);
export const listDir = (dir) => readdirSync(dir).sort();

// handlers: array of [predicate(url) -> bool, responder(url, init) -> Response | Promise<Response>].
// Unmatched URLs answer 404. delayMs keeps requests in flight so concurrency is observable.
export function stubFetch(handlers = [], { delayMs = 0 } = {}) {
  const calls = [];
  let inFlight = 0;
  const state = { maxInFlight: 0 };
  async function fetch(input, init = {}) {
    const url = String(input?.url ?? input);
    calls.push({ url, init });
    inFlight++;
    state.maxInFlight = Math.max(state.maxInFlight, inFlight);
    try {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      for (const [match, respond] of handlers) if (match(url)) return await respond(url, init);
      return new Response('not found', { status: 404 });
    } finally {
      inFlight--;
    }
  }
  return { fetch, calls, state, urls: () => calls.map((c) => c.url) };
}

export const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
export const text = (body, status = 200) => new Response(body, { status });

export function sleeper() {
  const calls = [];
  return { sleep: async (ms) => void calls.push(ms), calls };
}

// ---- synthetic list files (one per parser format) ----

export const SIMPLIFY_JSON = JSON.stringify([
  { company_name: 'Example Robotics', title: 'Software Engineer Intern - Summer 2027', locations: ['Austin, TX'], url: 'https://boards.greenhouse.io/examplerobotics/jobs/101', date_posted: 1758000000, active: true, is_visible: true },
  { company_name: 'Sample Labs', title: 'Data Intern - Summer 2027', locations: ['Remote'], url: 'https://jobs.lever.co/samplelabs/aaa-111', date_posted: 1758000000, active: true, is_visible: true },
  { company_name: 'Closed Co', title: 'Software Intern - Summer 2027', locations: ['Boston, MA'], url: 'https://example.com/closed', date_posted: 1758000000, active: false, is_visible: true },
  { company_name: 'Hidden Co', title: 'Software Intern - Summer 2027', locations: ['Boston, MA'], url: 'https://example.com/hidden', date_posted: 1758000000, active: true, is_visible: false },
  { company_name: 'Nourl Co', title: 'Software Intern - Summer 2027', locations: ['Boston, MA'], url: '', date_posted: 1758000000, active: true, is_visible: true },
]);
export const SIMPLIFY_JSON_EXPECTED = [
  { company: 'Example Robotics', title: 'Software Engineer Intern - Summer 2027', location: 'Austin, TX', date: '2025-09-16', url: 'https://boards.greenhouse.io/examplerobotics/jobs/101', kind: 'internship' },
  { company: 'Sample Labs', title: 'Data Intern - Summer 2027', location: 'Remote', date: '2025-09-16', url: 'https://jobs.lever.co/samplelabs/aaa-111', kind: 'internship' },
];

const tr = (...cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
export const HTML_TABLE = `<table>
<thead><tr><th>Company</th><th>Role</th><th>Location</th><th>Application</th><th>Date Posted</th></tr></thead>
<tbody>
${tr('<strong><a href="https://example.com/robotics">Example Robotics</a></strong>', 'Software Engineer Intern', 'Austin, TX', '<a href="https://boards.greenhouse.io/examplerobotics/jobs/201">Apply</a> <a href="https://simplify.jobs/p/abc">Simplify</a>', '2026-09-15')}
${tr(ARROW, 'Data Engineer Intern', 'Remote', '<a href="https://boards.greenhouse.io/examplerobotics/jobs/202">Apply</a>', '2026-09-16')}
${tr('Sample Labs', 'Software Intern', 'Denver, CO', `${LOCK}`, '2026-09-17')}
${tr(ARROW, 'Platform Intern', 'Denver, CO', 'Closed', '2026-09-17')}
${tr('Nourl Co', 'Software Intern', 'Remote', '', '2026-09-18')}
${tr('Second Co', 'Backend Intern', 'Chicago, IL', '<a href="https://jobs.lever.co/secondco/bbb-222">Apply</a>', '2026-09-19')}
</tbody></table>`;
export const HTML_TABLE_EXPECTED = [
  { company: 'Example Robotics', title: 'Software Engineer Intern', location: 'Austin, TX', date: '2026-09-15', url: 'https://boards.greenhouse.io/examplerobotics/jobs/201', kind: 'internship' },
  { company: 'Example Robotics', title: 'Data Engineer Intern', location: 'Remote', date: '2026-09-16', url: 'https://boards.greenhouse.io/examplerobotics/jobs/202', kind: 'internship' },
  { company: 'Second Co', title: 'Backend Intern', location: 'Chicago, IL', date: '2026-09-19', url: 'https://jobs.lever.co/secondco/bbb-222', kind: 'internship' },
];

export const MARKDOWN_TABLE = `# Example list

| Company | Role | Location | Application | Date Posted |
| --- | --- | --- | --- | --- |
| [Example Robotics](https://example.com/robotics) | Software Engineer, New Grad 2027 | Austin, TX | [Apply](https://boards.greenhouse.io/examplerobotics/jobs/301) | 2026-09-15 |
| ${ARROW} | Data Engineer, New Grad 2027 | Remote | [Apply](https://boards.greenhouse.io/examplerobotics/jobs/302) | 2026-09-16 |
| Sample Labs | Software Engineer, New Grad 2027 | Denver, CO | ${LOCK} | 2026-09-17 |
| Nourl Co | Software Engineer, New Grad 2027 | Remote | | 2026-09-18 |
| Second Co | Backend Engineer, New Grad 2027 | Chicago, IL | [Apply](https://jobs.lever.co/secondco/ccc-333) | 2026-09-19 |
`;
export const MARKDOWN_TABLE_EXPECTED = [
  { company: 'Example Robotics', title: 'Software Engineer, New Grad 2027', location: 'Austin, TX', date: '2026-09-15', url: 'https://boards.greenhouse.io/examplerobotics/jobs/301', kind: 'newgrad' },
  { company: 'Example Robotics', title: 'Data Engineer, New Grad 2027', location: 'Remote', date: '2026-09-16', url: 'https://boards.greenhouse.io/examplerobotics/jobs/302', kind: 'newgrad' },
  { company: 'Second Co', title: 'Backend Engineer, New Grad 2027', location: 'Chicago, IL', date: '2026-09-19', url: 'https://jobs.lever.co/secondco/ccc-333', kind: 'newgrad' },
];

export const FIELD_MAP = { company: 'org', title: 'position', location: 'where', url: 'link', date: 'posted' };
export const JSON_ARRAY = JSON.stringify([
  { org: 'Example Robotics', position: 'Software Engineer Intern - Summer 2027', where: 'Austin, TX', link: 'https://boards.greenhouse.io/examplerobotics/jobs/401', posted: '2026-09-15' },
  { org: 'Sample Labs', position: 'Data Intern - Summer 2027', where: 'Remote', link: 'https://jobs.lever.co/samplelabs/ddd-444', posted: '2026-09-16' },
  { org: 'Nourl Co', position: 'Software Intern - Summer 2027', where: 'Remote', link: '', posted: '2026-09-17' },
  null,
]);
export const JSON_ARRAY_EXPECTED = [
  { company: 'Example Robotics', title: 'Software Engineer Intern - Summer 2027', location: 'Austin, TX', date: '2026-09-15', url: 'https://boards.greenhouse.io/examplerobotics/jobs/401', kind: 'internship' },
  { company: 'Sample Labs', title: 'Data Intern - Summer 2027', location: 'Remote', date: '2026-09-16', url: 'https://jobs.lever.co/samplelabs/ddd-444', kind: 'internship' },
];

export const CSV_FIELD_MAP = { company: 'Employer', title: 'Position', location: 'Place', url: 'Link', date: 'Posted' };
export const CSV = [
  'Employer,Position,Place,Link,Posted',
  '"Example Robotics, Inc.","Software ""Platform"" Intern - Summer 2027","Austin, TX",https://boards.greenhouse.io/examplerobotics/jobs/501,2026-09-15',
  'Sample Labs,Data Intern - Summer 2027,Remote,https://jobs.lever.co/samplelabs/eee-555,2026-09-16',
  'Nourl Co,Software Intern - Summer 2027,Remote,,2026-09-17',
  '',
].join('\r\n');
export const CSV_EXPECTED = [
  { company: 'Example Robotics, Inc.', title: 'Software "Platform" Intern - Summer 2027', location: 'Austin, TX', date: '2026-09-15', url: 'https://boards.greenhouse.io/examplerobotics/jobs/501', kind: 'internship' },
  { company: 'Sample Labs', title: 'Data Intern - Summer 2027', location: 'Remote', date: '2026-09-16', url: 'https://jobs.lever.co/samplelabs/eee-555', kind: 'internship' },
];
