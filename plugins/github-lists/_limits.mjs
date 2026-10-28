// Copy of the discovery ceilings this plugin uses. The plugin runs as a hashed copy in plugins.local/, so it
// cannot import scripts/budget.mjs; the install tests assert these values equal the CEILINGS there.
export const LIMITS = Object.freeze({
  request_gap_ms: 1200,
  backoff_ms_per_attempt: 3000,
  aggregator_in_flight: 4,
  never_fetch_hosts: Object.freeze(['linkedin.com']),
  max_attempts: 3,
  resolver_pause_ms: 150,
});

export function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.+$/, '');
  } catch {
    return '';
  }
}

export function isForbiddenHost(host) {
  return LIMITS.never_fetch_hosts.some((h) => host === h || host.endsWith(`.${h}`));
}
