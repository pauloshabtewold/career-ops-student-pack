// Stub for M-003: job-text hash cache per URL. The implementer replaces these bodies.
export const CACHE_FILE = 'triage-cache.tsv';
export const textHash = (text) => {
  void text;
  throw new Error('triage-cache: not implemented');
};
export async function loadCache(dataDir) {
  void dataDir;
  throw new Error('triage-cache: not implemented');
}
export function status(cache, url, text) {
  void cache, url, text;
  throw new Error('triage-cache: not implemented');
}
export async function record(dataDir, entries, date) {
  void dataDir, entries, date;
  throw new Error('triage-cache: not implemented');
}
