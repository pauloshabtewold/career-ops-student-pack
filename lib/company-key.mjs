// One key per employer, so a subsidiary or a spelling variant counts against the same company cap.
const GENERIC = new Set(['inc', 'llc', 'ltd', 'corp', 'corporation', 'co', 'company', 'the', 'group', 'technologies', 'technology', 'labs', 'lab', 'software', 'systems', 'holdings']);
const tokens = (s, ignore = []) => String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((t) => t && !GENERIC.has(t) && !ignore.includes(t));
const rawKey = (s, ignore) => tokens(s, ignore).sort().join(' ');

// parent_companies: { parent: [alias, ...] } so a subsidiary counts against its parent's cap.
// ignore: extra lowercase tokens dropped from every key, on top of GENERIC (rank.ignore_words).
export function companyKey(name, parents = {}, ignore = []) {
  const key = rawKey(name, ignore);
  for (const [parent, aliases] of Object.entries(parents)) {
    const all = [parent, ...(Array.isArray(aliases) ? aliases : [])].map((a) => rawKey(a, ignore));
    if (all.some((a) => a && (key === a || key.split(' ').includes(a)))) return rawKey(parent, ignore);
  }
  return key;
}
