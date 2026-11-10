// Stub signatures for the robots.txt checker; the implementation replaces every body.
export const ROBOTS_AGENT = 'career-ops-student-pack';
const DEFAULT_CRAWL_DELAY_CAP_S = 5;
const DEFAULT_TIMEOUT_MS = 10000;

export function parseRobots(_text) {
  return [];
}

export function robotsVerdict(_response, _path, { agent = ROBOTS_AGENT, crawlDelayCapS = DEFAULT_CRAWL_DELAY_CAP_S } = {}) {
  void agent;
  void crawlDelayCapS;
  return {};
}

export function createRobotsChecker({ fetch = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS, crawlDelayCapS = DEFAULT_CRAWL_DELAY_CAP_S } = {}) {
  void fetch;
  void timeoutMs;
  void crawlDelayCapS;
  return { check: async (_url) => ({}) };
}
