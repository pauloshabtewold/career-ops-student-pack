// Job ids from Handshake alert link targets. Alert mail wraps each job link in a tracking redirect, so the id can sit in
// the path (jobs/<id>, stu/jobs/<id>, job-search/<id>) or inside a percent-encoded or base64 redirect target. Links are
// read as text from the message body. The one exception is Handshake's own opaque click-tracking link
// (https://<host>.joinhandshake.com/c/<token>), which holds no id: resolveTracked asks it once, with no cookies and
// without following the redirect, and reads the id from the Location it answers with.
const ID_PATH = /joinhandshake\.com\/(?:stu\/)?(?:jobs|job-search)\/(\d+)/;
const MAX_DEPTH = 3;

const tryDecodeURI = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

// base64 and base64url segments long enough to hold a URL; decoded text counts only when it is printable.
function base64Candidates(text) {
  const out = [];
  for (const m of String(text).matchAll(/[A-Za-z0-9_-]{24,}={0,2}/g)) {
    const decoded = Buffer.from(m[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    if (/^[\x20-\x7e]+$/.test(decoded)) out.push(decoded);
  }
  return out;
}

// Returns the digits of the job id, or null.
export function extractHandshakeId(href, depth = 0) {
  if (!href || depth > MAX_DEPTH) return null;
  const text = String(href);
  const direct = ID_PATH.exec(text) ?? ID_PATH.exec(tryDecodeURI(text)) ?? ID_PATH.exec(tryDecodeURI(tryDecodeURI(text)));
  if (direct) return direct[1];
  for (const decoded of base64Candidates(tryDecodeURI(text))) {
    const id = extractHandshakeId(decoded, depth + 1);
    if (id) return id;
  }
  return null;
}

// Every distinct id found in a list of link targets, in order.
export function handshakeIdsIn(links = []) {
  return [...new Set(links.map((l) => extractHandshakeId(l)).filter(Boolean))];
}

export const TRACKED_PER_ALERT = 25;
const TRACK_TIMEOUT_MS = 10 * 1000;
const STU_JOB_URL = 'https://app.joinhandshake.com/stu/jobs/';

// True for a Handshake click-tracking link: https, a joinhandshake.com host, a /c/ path.
export function isTrackedLink(href) {
  try {
    const u = new URL(String(href));
    return u.protocol === 'https:' && /(^|\.)joinhandshake\.com$/i.test(u.hostname) && u.pathname.startsWith('/c/');
  } catch {
    return false;
  }
}

// The job id behind one tracking link: one GET with redirect manual, no cookies, a 10 s timeout, then the id in the
// Location header. A navigation target (inbox, profile, notifications, home), a non-tracking link and any network
// failure give null.
export async function resolveTracked(href, { fetchFn = globalThis.fetch, timeoutMs = TRACK_TIMEOUT_MS } = {}) {
  if (!isTrackedLink(href)) return null;
  try {
    const res = await fetchFn(String(href), { method: 'GET', redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(timeoutMs) });
    await res.body?.cancel?.().catch(() => {});
    const location = res.headers?.get?.('location');
    return location ? extractHandshakeId(new URL(location, String(href)).href) : null;
  } catch {
    return null;
  }
}

// A copy of one message whose tracking links (in links, each job's link and links, and the snippet) are replaced by the
// job URL they redirect to, at most TRACKED_PER_ALERT lookups per message. Links that already carry an id, and links
// that do not resolve to a job, stay as they were.
export async function resolveMessageLinks(message, { fetchFn = globalThis.fetch, timeoutMs } = {}) {
  const answers = new Map();
  const swap = async (href) => {
    if (typeof href !== 'string' || extractHandshakeId(href) || !isTrackedLink(href)) return href;
    if (!answers.has(href)) {
      if (answers.size >= TRACKED_PER_ALERT) return href;
      answers.set(href, await resolveTracked(href, { fetchFn, timeoutMs }));
    }
    const id = answers.get(href);
    return id ? `${STU_JOB_URL}${id}` : href;
  };
  // One lookup at a time, so the per-message cap holds.
  const list = async (links) => {
    if (!Array.isArray(links)) return links;
    const done = [];
    for (const l of links) done.push(await swap(l));
    return done;
  };
  const out = { ...message, links: await list(message.links) };
  if (Array.isArray(message.jobs)) {
    out.jobs = [];
    for (const job of message.jobs) out.jobs.push(job && typeof job === 'object' ? { ...job, link: await swap(job.link), links: await list(job.links) } : job);
  }
  if (typeof message.snippet === 'string') {
    let snippet = message.snippet;
    for (const m of message.snippet.matchAll(/https:\/\/[^\s)>\]"']+/g)) snippet = snippet.replace(m[0], await swap(m[0]));
    out.snippet = snippet;
  }
  return out;
}
