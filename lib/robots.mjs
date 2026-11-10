// robots.txt checks for the sources the pack reads on a student's behalf (RFC 9309). Node built-ins only.
// A Crawl-delay above the pack's cap skips the source: the cap is the longest wait scripts/budget.mjs allows a request.
import { hostOf, isForbiddenHost } from '../plugins/github-lists/_limits.mjs';
import { CEILINGS } from '../scripts/budget.mjs';

export const ROBOTS_AGENT = 'career-ops-student-pack';
const DEFAULT_CRAWL_DELAY_CAP_S = CEILINGS.crawl_delay_cap_s.value;
const DEFAULT_GAP_MS = CEILINGS.request_gap_ms.value;
const DEFAULT_TIMEOUT_MS = 8000;

// Groups: [{agents: [lowercase token], rules: [{allow, pattern}], crawlDelay: number|null}]. Consecutive User-agent
// lines share one group, as the RFC defines.
export function parseRobots(text) {
  const groups = [];
  let current = null;
  let collectingAgents = false;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const at = line.indexOf(':');
    if (at < 1) continue;
    const field = line.slice(0, at).trim().toLowerCase();
    const value = line.slice(at + 1).trim();
    if (field === 'user-agent') {
      if (!current || !collectingAgents) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      collectingAgents = true;
      continue;
    }
    collectingAgents = false;
    if (!current) continue;
    if (field === 'allow' || field === 'disallow') {
      // An empty Disallow allows everything and an empty Allow adds nothing, so neither becomes a rule.
      if (value) current.rules.push({ allow: field === 'allow', pattern: value });
    } else if (field === 'crawl-delay') {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelay = n;
    }
  }
  return groups;
}

function patternToRegExp(pattern) {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const source = body.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${source}${anchored ? '$' : ''}`);
}

// RFC 9309 2.2.1: every group naming the agent is combined; only when none does, every `*` group is. Two blocks for one
// agent are one rule set, so a Disallow in a later block still applies.
function pickGroup(groups, agent) {
  const token = agent.toLowerCase();
  const named = groups.filter((g) => g.agents.includes(token));
  const matching = named.length ? named : groups.filter((g) => g.agents.includes('*'));
  if (!matching.length) return null;
  return { rules: matching.flatMap((g) => g.rules), crawlDelay: matching.map((g) => g.crawlDelay).find((d) => d !== null) ?? null };
}

const UNREACHABLE = Object.freeze({ allowed: false, reason: 'robots.txt unreachable', crawlDelay: null });

// response: {status, text}. A thrown or timed-out fetch is passed as {status: 0}.
export function robotsVerdict(response, path, { agent = ROBOTS_AGENT, crawlDelayCapS = DEFAULT_CRAWL_DELAY_CAP_S } = {}) {
  const status = response?.status ?? 0;
  if (status >= 400 && status < 500) return { allowed: true, reason: '', crawlDelay: null };
  if (status < 200 || status >= 300) return UNREACHABLE;
  const group = pickGroup(parseRobots(response.text), agent);
  if (!group) return { allowed: true, reason: '', crawlDelay: null };
  const crawlDelay = group.crawlDelay;
  if (crawlDelay !== null && crawlDelay > crawlDelayCapS) {
    return { allowed: false, reason: `crawl-delay ${crawlDelay} s above the ${crawlDelayCapS} s cap`, crawlDelay };
  }
  // The longest matching pattern wins and Allow wins a tie, so a narrow Allow can reopen part of a Disallow.
  let best = null;
  for (const rule of group.rules) {
    if (!patternToRegExp(rule.pattern).test(path)) continue;
    if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) best = rule;
  }
  if (best && !best.allow) return { allowed: false, reason: `robots.txt disallows ${path}`, crawlDelay };
  return { allowed: true, reason: '', crawlDelay };
}

export function createRobotsChecker({ fetch = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS, crawlDelayCapS = DEFAULT_CRAWL_DELAY_CAP_S } = {}) {
  const byHost = new Map();
  const load = async (host) => {
    try {
      const res = await fetch(`https://${host}/robots.txt`, { headers: { 'User-Agent': ROBOTS_AGENT }, signal: AbortSignal.timeout(timeoutMs) });
      return { status: res.status, text: res.ok ? await res.text() : '' };
    } catch {
      return { status: 0, text: '' };
    }
  };
  return {
    async check(url) {
      const host = hostOf(url);
      if (!host || isForbiddenHost(host)) return { allowed: false, reason: 'never fetched', crawlDelay: null };
      if (!byHost.has(host)) byHost.set(host, load(host));
      const parsed = new URL(url);
      return robotsVerdict(await byHost.get(host), `${parsed.pathname}${parsed.search}`, { crawlDelayCapS });
    },
  };
}

// A fetch-shaped function for scripts that visit pages the pack did not name in advance. Requests run one at a time,
// a disallowed URL is answered locally without being sent, and requests to one host keep the longer of the pack's
// request gap and that host's Crawl-delay apart.
export function politeFetch({ fetch = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), checker = createRobotsChecker({ fetch }), gapMs = DEFAULT_GAP_MS, now = Date.now, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const lastByHost = new Map();
  let queue = Promise.resolve();
  const run = async (url, init) => {
    const verdict = await checker.check(String(url));
    if (!verdict.allowed) return new Response(verdict.reason, { status: 403 });
    const host = hostOf(String(url));
    const gap = Math.max(gapMs, (verdict.crawlDelay ?? 0) * 1000);
    const wait = (lastByHost.get(host) ?? -Infinity) + gap - now();
    if (wait > 0) await sleep(wait);
    lastByHost.set(host, now());
    // One stalled host must not hold the queue: every page request is bounded like the robots.txt request.
    const bound = AbortSignal.timeout(timeoutMs);
    return fetch(url, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, bound]) : bound });
  };
  return (url, init) => {
    const next = queue.then(() => run(url, init));
    queue = next.catch(() => {});
    return next;
  };
}
