// Reply rates from the tracker: the share of applications that got any response, grouped by resume version, role family
// and source. Groups with fewer than MIN_GROUP applications return null, because a rate from four applications is noise
// and must not move the ranking.

export const MIN_GROUP = 5;
const RESPONDED = /^(responded|assessment|interview|offer|hired)$/i;
const SENT = /^(applied|responded|assessment|interview|offer|hired|rejected)$/i;

// apps = [{ status, resume, family, source }]
export function replyRates(apps) {
  const out = { resume: {}, family: {}, source: {} };
  for (const dim of Object.keys(out)) {
    const groups = new Map();
    for (const a of apps) {
      if (!SENT.test(a.status ?? '') || !a[dim]) continue;
      const g = groups.get(a[dim]) ?? { n: 0, replied: 0 };
      g.n++;
      if (RESPONDED.test(a.status)) g.replied++;
      groups.set(a[dim], g);
    }
    for (const [k, g] of groups) out[dim][k] = g.n >= MIN_GROUP ? g.replied / g.n : null;
  }
  return out;
}

// Mean rate across all applications with a status, the baseline a group is compared with; null with none.
export function baseRate(apps) {
  const sent = apps.filter((a) => SENT.test(a.status ?? ''));
  return sent.length ? sent.filter((a) => RESPONDED.test(a.status)).length / sent.length : null;
}
