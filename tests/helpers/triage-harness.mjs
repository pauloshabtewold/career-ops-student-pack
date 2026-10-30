// Fixtures for the daily-triage tests: a scratch root with a config, a pipeline and a brief, and a fake runner that
// answers fetch-jd.mjs and claude calls from the test and runs the pack's own scripts for real.
import { existsSync, writeFileSync } from 'node:fs';
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

export const unquote = (s) => String(s).replace(/^"(.*)"$/, '$1');
const commandName = (cmd) => unquote(cmd).split(/[\\/]/).pop().toLowerCase();
// The value after a flag in a codex argv, quotes stripped; the -o file path comes from here.
export const flagValue = (argv, flag) => (argv.includes(flag) ? unquote(argv[argv.indexOf(flag) + 1]) : undefined);

// handlers: { claude(args, opts) -> stdout string or throws, fetch(url) -> text or throws,
//             codex(args, opts, out) -> stdout string or throws; it writes the -o file at `out` itself }
// A codex call is recorded with its -o path (out), the temp folder (tmp) and whether tmp existed during the call.
export function makeRunner(r, { claude = () => '', fetch = (url) => `Posting text for ${url}`, codex = (args, opts, out) => (writeFileSync(out, 'Reviewed.\n'), '') } = {}) {
  const calls = { claude: [], codex: [], fetch: [], other: [] };
  const runner = (cmd, args, opts = {}) => {
    if (cmd === process.execPath && basename(args[0]) === 'fetch-jd.mjs') {
      calls.fetch.push({ cmd, args, opts });
      return fetch(args[1]);
    }
    if (cmd === process.execPath) {
      calls.other.push({ cmd, args, opts });
      return defaultRunner(cmd, args, opts);
    }
    if (commandName(cmd).startsWith('codex')) {
      const out = flagValue(args, '-o');
      const tmp = flagValue(args, '-C');
      calls.codex.push({ cmd, args, opts, out, tmp, tmpExistedDuringCall: existsSync(tmp ?? '') });
      return codex(args, opts, out);
    }
    calls.claude.push({ cmd, args, opts });
    return claude(args, opts);
  };
  return { runner, calls };
}

export const sentUrls = (input) => new Set(String(input).match(/https:\/\/example\.com\/jobs\/\d+/g) ?? []);

export const args = (r, extra = {}) => ({ root: r.root, dataDir: r.data, packRoot: PACK_ROOT, today: TODAY, claude: '/opt/sample/bin/claude', say: () => {}, ...extra });
