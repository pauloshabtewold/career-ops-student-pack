#!/usr/bin/env node
// Maintainer tool: rebuilds the synthetic triage prompts behind the token constants in lib/usage-cost.mjs.
// Usage: usage-fixture.mjs --rows <n>   prints the prompt for n synthetic postings on stdout
//        usage-fixture.mjs --print-argv  prints the claude and codex argv used for the measurement
// Method: run each argv with the prompt on stdin at 1, 5 and 20 rows and read usage from the json output.
// Per row = (20-row minus 5-row) / 15 and fixed = 5-row minus 5 x per-row. It makes no network or agent call itself.
import { CODEX_DISABLED_FEATURES, CODEX_EXTRA_FLAGS } from '../../lib/agent.mjs';
import { UsageError, parseArgs, runCli, isMain } from '../../lib/args.mjs';
import { buildPrompt } from '../daily-triage.mjs';

const POSTING_CHARS = 5400;
const BRIEF = 'Judge each posting for an early-career student studying computer science. Prefer internships and entry-level roles in the United States.';

export function syntheticPostings(n) {
  return Array.from({ length: n }, (_, k) => {
    const i = k + 1;
    const sentence = `Example Company ${i} is hiring a data analyst intern to build reports, clean data and support a small team. `;
    return { url: `https://example.com/jobs/${i}`, company: `Example Company ${i}`, title: `Data Analyst Intern ${i}`, text: sentence.repeat(Math.ceil(POSTING_CHARS / sentence.length)).slice(0, POSTING_CHARS) };
  });
}

export const fixturePrompt = (n) => buildPrompt({ brief: BRIEF, postings: syntheticPostings(n) });

// The calls differ from daily-triage.mjs only in the usage readout flag (--output-format json, --json) and, for codex, a
// placeholder folder for -C, because the measurement reads usage from stdout instead of the -o file.
const show = (args) => args.map((a) => (a === '' ? "''" : a)).join(' ');
export function measurementArgv() {
  const claude = ['-p', '--tools', '', '--setting-sources', 'project', '--strict-mcp-config', '--model', 'sonnet', '--output-format', 'json'];
  const codex = [
    '-a', 'never', 'exec', '--ephemeral', '--skip-git-repo-check', ...CODEX_EXTRA_FLAGS, '-s', 'read-only', '--color', 'never',
    ...CODEX_DISABLED_FEATURES.flatMap((f) => ['--disable', f]),
    '-c', 'model_reasoning_effort=medium', '-C', '<empty-temp-folder>', '--json', '-',
  ];
  return { claude: `claude ${show(claude)}`, codex: `codex ${show(codex)}` };
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2), { flags: { rows: 'int', 'print-argv': 'boolean' } });
  if (flags.printArgv) {
    const argv = measurementArgv();
    console.log(`${argv.claude}\n${argv.codex}`);
    return 0;
  }
  if (flags.rows === undefined || flags.rows < 1) throw new UsageError('usage-fixture.mjs --rows <n> (1 or more) or --print-argv');
  process.stdout.write(fixturePrompt(flags.rows));
  return 0;
}

if (isMain(import.meta.url)) await runCli(main);
