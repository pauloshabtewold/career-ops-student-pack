// Job ids from Handshake alert link targets. Alert mail wraps each job link in a tracking redirect, so the id can sit in
// the path (jobs/<id>, stu/jobs/<id>, job-search/<id>) or inside a percent-encoded or base64 redirect target. Links are
// read as text from the message body and never opened.
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
