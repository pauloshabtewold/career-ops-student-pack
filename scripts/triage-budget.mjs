#!/usr/bin/env node
// The student's model-usage triage budget: show it, price it, change it, and record session triage against it.
// Usage: triage-budget.mjs status
//        triage-budget.mjs cost <n|all> [--plan P] [--agent claude|codex]
//        triage-budget.mjs set <n|all> [--first-run] [--confirm]     (writes only with --confirm)
//        triage-budget.mjs log <n> [--first-run]
//        triage-budget.mjs calibrate <percent> --rows <n> --window 5-hour|weekly
//        all commands also take [--root R] [--data-dir D] [--today YYYY-MM-DD]
// Exit codes: 0 ok, 1 config/student.yml missing, 2 usage. Every cost figure is an estimate (lib/usage-cost.mjs).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { AGENTS } from '../lib/agent.mjs';
import { UsageError, parseArgs, runCli, isMain } from '../lib/args.mjs';
import { createClock } from '../lib/clock.mjs';
import { ConfigError, loadStudentConfig, parseConfig } from '../lib/config.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { ALL, appendDigestLines, appendTriageUsage, parseBudgetValue, readTriageUsage, resolveTriageBudget, rowsLeft } from '../lib/triage-budget.mjs';
import { writeAtomic } from '../lib/tsv.mjs';
import { PLAN_IDS, formatCostLine } from '../lib/usage-cost.mjs';
import { selectUntriagedRows } from './daily-triage.mjs';

const COMMANDS = ['status', 'cost', 'set', 'log', 'calibrate'];
const WINDOWS = ['5-hour', 'weekly'];
const MISSING = 'config/student.yml is missing: run the personalization interview first';
const EXAMPLE_ROWS = [100, 250];

const unlimited = (n) => (n === Infinity ? 'all untriaged rows' : n);

// A budget value from the command line, as a UsageError that names the value.
function budgetArg(text, what) {
  if (text === undefined) throw new UsageError(`${what} needs a value: a whole number of 0 or more, or "all"`);
  try {
    return parseBudgetValue(text);
  } catch (err) {
    throw new UsageError(err.message);
  }
}

const countArg = (text) => {
  const value = budgetArg(text, 'log');
  if (value === ALL) throw new UsageError('log needs a whole number of rows, not "all"');
  return value;
};

// Rows an "all" budget means today: every untriaged Pending row, or null when no pipeline exists yet.
function untriagedCount(dataDir) {
  return existsSync(join(dataDir, 'pipeline.md')) ? selectUntriagedRows(dataDir, Infinity).length : null;
}

// The estimate line for `rows` rows, using --agent and --plan or the student's config.
function costLine(ctx, rows) {
  const { config, flags } = ctx;
  return formatCostLine({
    agent: flags.agent ?? config?.agent ?? 'claude',
    plan: flags.plan ?? config?.plan ?? 'unknown',
    rows,
    spendTier: config?.spend_tier ?? 'standard',
    calibration: resolveTriageBudget(config ?? {}).calibration,
  });
}

// The lines that price a budget value; "all" is priced at the untriaged Pending rows there are now.
function priceLines(ctx, value) {
  if (value !== ALL) return [costLine(ctx, value)];
  const count = untriagedCount(ctx.paths.dataDir);
  if (count !== null) return [`all means every untriaged Pending row: ${count} today`, costLine(ctx, count)];
  return ['no pipeline yet, so examples for 100 and 250 rows:', ...EXAMPLE_ROWS.map((n) => costLine(ctx, n))];
}

function status({ config, paths, today, out, ...ctx }) {
  const budget = resolveTriageBudget(config);
  const usage = readTriageUsage(paths.dataDir, today);
  const show = (v) => (v === ALL ? 'all' : `${v} rows`);
  out(`Daily triage budget: ${show(budget.daily)}`);
  out(`First-run triage budget: ${show(budget.firstRun)}`);
  out(`Plan: ${config.plan}`);
  out(`Rows scored today (${today}): ${usage.today} (scheduled ${usage.scheduled}, session ${usage.session})`);
  out(`Rows left today: ${unlimited(rowsLeft(budget.daily, usage.today))}`);
  out(`First-run rows scored: ${usage.firstRun}; left: ${unlimited(rowsLeft(budget.firstRun, usage.firstRun))}`);
  if (usage.stoppedToday) out('Daily triage stopped earlier today after a failure; the next scheduled run is tomorrow');
  if (usage.skipped) out(`${usage.skipped} unreadable row(s) in data/triage-usage.tsv were skipped`);
  const rows = budget.daily === ALL ? (untriagedCount(paths.dataDir) ?? 0) : budget.daily;
  out(costLine({ config, flags: ctx.flags }, rows));
  return 0;
}

function cost({ positionals, out, ...ctx }) {
  for (const line of priceLines({ ...ctx, out }, budgetArg(positionals[0], 'cost'))) out(line);
  return 0;
}

// Reads config/student.yml as plain data, applies `patch` to triage_budget and writes it back only if the result still
// parses. Any other key is kept as the student wrote it.
function writeBudgetKeys({ paths }, patch) {
  const file = join(paths.configDir, 'student.yml');
  const text = readFileSync(file, 'utf8');
  const data = text.trim() ? (yaml.load(text) ?? {}) : {};
  data.triage_budget = { ...(data.triage_budget ?? {}), ...patch };
  const next = yaml.dump(data, { lineWidth: -1, quotingType: '"', noRefs: true });
  parseConfig(next, readFileSync(join(paths.packRoot, 'templates', 'student.defaults.yml'), 'utf8'));
  writeAtomic(file, next);
}

// The two steps of a change: the estimate and the exact command first, the write only when --confirm is given.
function set(ctx) {
  const { positionals, flags, config, out } = ctx;
  const value = budgetArg(positionals[0], 'set');
  const key = flags.firstRun ? 'first_run' : 'daily';
  const budget = resolveTriageBudget(config);
  const old = flags.firstRun ? budget.firstRun : budget.daily;
  out(`triage_budget.${key}: ${old} -> ${value}`);
  for (const line of priceLines(ctx, value)) out(line);
  if (!flags.confirm) {
    out('nothing written');
    out(`to apply, run: node student/scripts/triage-budget.mjs set ${value}${flags.firstRun ? ' --first-run' : ''} --confirm`);
    return 0;
  }
  writeBudgetKeys(ctx, { [key]: value });
  out(`written: triage_budget.${key} is now ${value}`);
  return 0;
}

async function log({ positionals, flags, paths, today, out, config }) {
  const rows = countArg(positionals[0]);
  const first = Boolean(flags.firstRun);
  await appendTriageUsage(paths.dataDir, { date: today, source: first ? 'first-run' : 'session', rows });
  appendDigestLines({ dataDir: paths.dataDir, today, heading: first ? 'First-run triage' : 'Session triage', lines: [`${first ? 'first-run' : 'session'} triage: triaged ${rows}`] });
  out(`logged ${rows} ${first ? 'first-run' : 'session'} rows for ${today}`);
  const budget = resolveTriageBudget(config);
  const usage = readTriageUsage(paths.dataDir, today);
  out(first ? `First-run rows left: ${unlimited(rowsLeft(budget.firstRun, usage.firstRun))}` : `Rows left today: ${unlimited(rowsLeft(budget.daily, usage.today))}`);
  return 0;
}

// A reading from /usage or /status before and after triaging `--rows` rows, stored as a percent per 100 rows.
function calibrate(ctx) {
  const { positionals, flags, out } = ctx;
  const percent = Number(positionals[0]);
  if (!Number.isFinite(percent) || percent <= 0) throw new UsageError(`calibrate needs a percent above 0, got "${positionals[0]}"`);
  if (!Number.isInteger(flags.rows) || flags.rows < 1) throw new UsageError(`--rows needs a whole number of 1 or more, got "${flags.rows}"`);
  if (!WINDOWS.includes(flags.window)) throw new UsageError(`--window expects ${WINDOWS.join(' or ')}, got "${flags.window}"`);
  const per100 = Number(((percent * 100) / flags.rows).toPrecision(10));
  writeBudgetKeys(ctx, { measured_pct_per_100_rows: per100, measured_window: flags.window });
  out(`written: ${per100}% of your ${flags.window} window per 100 rows (your own measurement)`);
  return 0;
}

const HANDLERS = { status, cost, set, log, calibrate };

async function main() {
  const { command, positionals, flags } = parseArgs(process.argv.slice(2), {
    commands: COMMANDS,
    flags: { confirm: 'boolean', 'first-run': 'boolean', plan: 'string', agent: 'string', rows: 'int', window: 'string' },
  });
  if (flags.agent && !AGENTS.includes(flags.agent)) throw new UsageError(`--agent expects ${AGENTS.join(' or ')}, got "${flags.agent}"`);
  if (flags.plan && !PLAN_IDS.includes(flags.plan)) throw new UsageError(`--plan expects one of ${PLAN_IDS.join(', ')}, got "${flags.plan}"`);
  const paths = resolvePaths({ root: flags.root, dataDir: flags.dataDir });
  let config = null;
  let configNote = null;
  try {
    config = await loadStudentConfig({ root: paths.root });
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    configNote = `${err.message}; fix config/student.yml first`;
    if (command !== 'cost') {
      console.log(configNote);
      return 1;
    }
  }
  // cost needs no config: --plan and --agent let a student price a budget before the interview has run.
  if (!config && command !== 'cost') {
    console.log(MISSING);
    return 1;
  }
  const today = createClock({ today: flags.today, timezone: config?.timezone }).today();
  const code = HANDLERS[command]({ positionals, flags, paths, config, today, out: (line) => console.log(line) });
  if (configNote) console.log(`note: ${configNote}; this price uses the defaults`);
  return code;
}

if (isMain(import.meta.url)) await runCli(main);
