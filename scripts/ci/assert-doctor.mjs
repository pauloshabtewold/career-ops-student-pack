#!/usr/bin/env node
// Fails CI when upstream's doctor output says setup is incomplete after the pack was installed and personalized.
// Usage: assert-doctor.mjs <doctor.json>    exit 0 healthy, 1 problems listed, 2 usage
import { readFileSync } from 'node:fs';
import { UsageError, parseArgs, runCli, isMain } from '../../lib/args.mjs';

const label = (m) => (typeof m === 'string' ? m : (m.path ?? JSON.stringify(m)));

export function assertDoctor(report) {
  const problems = [];
  const missing = Array.isArray(report.missing) ? report.missing : [];
  if (report.onboardingNeeded && !missing.length) problems.push('onboarding is still needed');
  problems.push(...missing.map((m) => `missing: ${label(m)}`));
  const un = Array.isArray(report.unpersonalized) ? report.unpersonalized : [];
  problems.push(...un.map((u) => `unpersonalized: ${typeof u === 'string' ? u : `${u.path ?? '?'} ${u.reason ?? ''}`.trim()}`));
  return { ok: problems.length === 0, problems };
}

async function main() {
  const { command, positionals } = parseArgs(process.argv.slice(2), { common: false, flags: {} });
  const args = [command, ...positionals].filter((a) => a !== null);
  if (args.length !== 1) throw new UsageError('usage: assert-doctor.mjs <doctor.json>');
  const res = assertDoctor(JSON.parse(readFileSync(args[0], 'utf8')));
  if (res.ok) {
    console.log('doctor: ok');
    return 0;
  }
  for (const p of res.problems) console.error(p);
  return 1;
}

if (isMain(import.meta.url)) await runCli(main);
