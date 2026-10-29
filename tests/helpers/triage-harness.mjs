// Fixtures for the daily-triage tests: a scratch root with a config, a pipeline and a brief, and a fake runner that
// answers fetch-jd.mjs and claude calls from the test and runs the pack's own scripts for real.
import { basename } from 'node:path';
import { defaultRunner } from '../../lib/upstream.mjs';
import { PACK_ROOT, TODAY, jobUrl, line, makeRoot, pipelineText } from './script-harness.mjs';

export { PACK_ROOT, TODAY, jobUrl, line };
export const BRIEF_MARKER = 'TRIAGE-RULES-MARKER-7Q';
export const PLUS = 'automation: scheduled-discovery-plus-triage\n';
export const digestFile = (r) => `data/digest/student-${TODAY}.md`;

export const verdict = (v, url, score = '4.0', reason = 'fits the role') => `TRIAGE: ${v} | ${url} | ${score}/5 | ${reason}`;

export function makeTriageRoot({ config = PLUS, pending = [], flagged = [], skipped = [] } = {}) {
  const r = makeRoot({ config });
  r.write('modes/_brief.md', `# Brief\n\n${BRIEF_MARKER}\nJudge each posting for an early-career student.\n`);
  r.write('data/pipeline.md', pipelineText({ pending, flagged, skipped }));
  return r;
}

export const untriaged = (n, from = 1) => Array.from({ length: n }, (_, i) => line(jobUrl(from + i), 'Example Robotics', 'Data Intern', 'Remote', 'src=handshake'));

// handlers: { claude(args, opts) -> stdout string or throws, fetch(url) -> text or throws }
export function makeRunner(r, { claude = () => '', fetch = (url) => `Posting text for ${url}` } = {}) {
  const calls = { claude: [], fetch: [], other: [] };
  const runner = (cmd, args, opts = {}) => {
    if (cmd === process.execPath && basename(args[0]) === 'fetch-jd.mjs') {
      calls.fetch.push({ cmd, args, opts });
      return fetch(args[1]);
    }
    if (cmd === process.execPath) {
      calls.other.push({ cmd, args, opts });
      return defaultRunner(cmd, args, opts);
    }
    calls.claude.push({ cmd, args, opts });
    return claude(args, opts);
  };
  return { runner, calls };
}

export const sentUrls = (input) => new Set(String(input).match(/https:\/\/example\.com\/jobs\/\d+/g) ?? []);

export const args = (r, extra = {}) => ({ root: r.root, dataDir: r.data, packRoot: PACK_ROOT, today: TODAY, claude: '/opt/sample/bin/claude', say: () => {}, ...extra });
