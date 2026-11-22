// Public job-board readers for Greenhouse, Lever and Ashby: each employer publishes its open postings as JSON, so an
// hourly scan reads them with plain HTTP and no model. Requests go through lib/robots.mjs politeFetch (robots.txt, the
// pack's request gap). Shapes follow plugins/github-lists/_resolve.mjs board().

export const BOARD_API = Object.freeze({
  greenhouse: (slug) => `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`,
  lever: (slug) => `https://api.lever.co/v0/postings/${slug}?mode=json`,
  ashby: (slug) => `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
});

const BOARD_HOST = [
  ['greenhouse', /^(?:job-boards|boards)\.greenhouse\.io$/, (p) => p[0]],
  ['lever', /^jobs\.(?:eu\.)?lever\.co$/, (p) => p[0]],
  ['ashby', /^jobs\.ashbyhq\.com$/, (p) => p[0]],
];

// { kind, slug } for a careers URL on one of the three hosts, else null.
export function boardOf(careersUrl) {
  let u;
  try {
    u = new URL(careersUrl);
  } catch {
    return null;
  }
  const parts = u.pathname.split('/').filter(Boolean);
  for (const [kind, host, slug] of BOARD_HOST) {
    if (host.test(u.hostname.toLowerCase()) && slug(parts)) return { kind, slug: slug(parts) };
  }
  return null;
}

const iso = (v) => {
  const ms = typeof v === 'number' ? v : Date.parse(v ?? '');
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : '';
};

// Normalizes a board API body of the given kind into rows with company, title, location and url.
export function parseBoard(kind, body, company) {
  if (kind === 'greenhouse' && Array.isArray(body?.jobs)) {
    return body.jobs.map((j) => ({ company, title: j.title ?? '', location: j.location?.name ?? '', url: j.absolute_url ?? '', posted: iso(j.updated_at ?? j.first_published) }));
  }
  if (kind === 'lever' && Array.isArray(body)) {
    return body.map((j) => ({ company, title: j.text ?? '', location: j.categories?.location ?? '', url: j.hostedUrl ?? '', posted: iso(j.createdAt) }));
  }
  if (kind === 'ashby' && Array.isArray(body?.jobs)) {
    return body.jobs.filter((j) => j.isListed !== false).map((j) => ({ company, title: j.title ?? '', location: j.location ?? '', url: j.jobUrl ?? '', posted: iso(j.publishedAt) }));
  }
  return null;
}

// Reads one board; throws with the board named so the caller can list the failure and go on.
export async function readBoard({ kind, slug, company }, fetchFn) {
  const res = await fetchFn(BOARD_API[kind](slug));
  if (!res.ok) throw new Error(`${kind} board ${slug} answered ${res.status}`);
  const jobs = parseBoard(kind, await res.json(), company);
  if (!jobs) throw new Error(`${kind} board ${slug} returned an unexpected shape`);
  return jobs.filter((j) => j.title && j.url);
}
