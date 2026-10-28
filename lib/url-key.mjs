// Canonical key for matching the same posting across feeds, pipeline rows and the sidecar.
const TRACKING = [/^utm_/i, /^gh_src$/i, /^source$/i, /^ref$/i, /^lever-source$/i];

export function urlKey(url) {
  let u;
  try {
    u = new URL(String(url).trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  // gh_jid, jobId, jid and id identify the posting on several ATS hosts, so they are never dropped.
  const kept = [...u.searchParams].filter(([k]) => !TRACKING.some((re) => re.test(k)));
  kept.sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)));
  const query = kept.length ? `?${kept.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}` : '';
  const path = u.pathname.replace(/\/+$/, '');
  return `${u.protocol}//${u.host.toLowerCase()}${path}${query}`;
}
