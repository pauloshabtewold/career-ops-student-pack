#!/usr/bin/env node
// Maintainer-only parity harness: runs the upstream scripts and the pack scripts on identical copies of a
// career-ops checkout inside a scratch directory, compares the stage outputs and writes a count-only report.
// Every path is explicit; there are no defaults and no flag that keeps the scratch copy, because the copy can hold
// personal rows and is deleted on every exit path (normal end, a throwing stage, SIGINT, SIGTERM, uncaught error).
// Usage: parity.mjs --source <career-ops dir> --scratch <new dir> --student-config <yml> [--today D] [--with-feeds] [--untriage N] [--report <file>]
// --untriage N strips the triage verdict from the first N Pending rows of both copies, so the prefilter stage has input.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError, parseArgs, runCli, isMain } from '../lib/args.mjs';
import { createClock } from '../lib/clock.mjs';
import { formatRow, parsePipeline, sectionRows, serializePipeline } from '../lib/pipeline-md.mjs';
import { ConfigError, parseConfig } from '../lib/config.mjs';
import { auditOptions } from '../scripts/fail-audit.mjs';
import { CycleFileError, writeCycle } from '../lib/cycle-file.mjs';
import { NOTES, carriedPending, compareCycle, compareFailAudit, compareFeed, comparePrefilter, compareRankQueue, compareStage, exitNote, formatParityReport, mergeAllowance, overallVerdict, skippedStage, stageError } from './parity-compare.mjs';

const PACK_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
// The whole candidate set is compared because top-n order follows score formulas that differ by design.
const LARGE_N = '100000';
const STAGE_TIMEOUT_MS = 300000;
const MAX_STAGE_OUTPUT = 64 * 1024 * 1024;

// One entry per deterministic stage. {today}, {frozen} and {tsv} are substituted. capture names a file read after the
// run in place of stdout. frozen names an earlier stage whose baseline output both sides then consume.
// compare picks the comparator, dependsOn names a stage whose error voids this one, explain names the allowance source.
// carry marks the stage whose pack Pending moves feed the rank-queue carry-over allowance: the pack pipeline is read
// just before the pack side runs and compared with the pipeline the stage leaves behind.
export const STAGES = [
  { name: 'cycle', compare: 'cycle', local: ['cycle.mjs', '--json', '--today', '{today}'], pack: ['cycle.mjs', '--json', '--today', '{today}'] },
  { name: 'prefilter', compare: 'prefilter', dependsOn: 'cycle', local: ['prefilter.mjs', '--today', '{today}'], pack: ['prefilter.mjs', '--today', '{today}'] },
  { name: 'apply-triage', compare: 'rows', local: ['apply-triage.mjs', '{frozen}'], pack: ['apply-triage.mjs', '{frozen}'], frozen: 'prefilter', capture: join('data', 'pipeline.md') },
  { name: 'merge-staging', compare: 'rows', explain: 'merge-stats', carry: true, local: ['merge-staging.mjs'], pack: ['merge-post.mjs', '--today', '{today}'], capture: join('data', 'pipeline.md') },
  { name: 'rank-queue', compare: 'rank', local: ['rank-queue.mjs', '--json', '--n', LARGE_N, '--today', '{today}'], pack: ['rank-queue.mjs', '--json', '--n', LARGE_N, '--today', '{today}'] },
  { name: 'fail-audit', compare: 'audit', local: ['fail-audit.mjs', 'pick', '--n', LARGE_N], pack: ['fail-audit.mjs', 'pick', '--n', LARGE_N] },
  { name: 'handshake-import', compare: 'rows', local: ['handshake-import.mjs', '--out', join('data', 'handshake.out.md'), '{tsv}'], pack: ['handshake-import.mjs', '--out', join('data', 'handshake.out.md'), '{tsv}'], capture: join('data', 'handshake.out.md'), needsTsv: true },
];

// Resolves symlinks in the longest existing prefix so a link cannot hide a scratch dir inside the pack or source.
export function realish(p) {
  const abs = resolve(p);
  let head = abs;
  const tail = [];
  while (!existsSync(head) && dirname(head) !== head) {
    tail.unshift(basename(head));
    head = dirname(head);
  }
  return join(existsSync(head) ? realpathSync(head) : head, ...tail);
}

export function isInside(child, parent) {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

// 'inside' when scratch lies within any dir, 'contains' when it holds any dir, else null. 'inside' wins so the
// caller reports the first problem the same way for every dir. Both sides are resolved through realish here.
export function scratchOverlap(scratch, dirs) {
  const scr = realish(scratch);
  const real = dirs.map(realish);
  if (real.some((d) => isInside(scr, d))) return 'inside';
  if (real.some((d) => isInside(d, scr))) return 'contains';
  return null;
}

export function checkArgs({ source, scratch, studentConfig }, packRoot = PACK_ROOT) {
  for (const [flag, v] of [['--source', source], ['--scratch', scratch], ['--student-config', studentConfig]]) {
    if (!v) throw new UsageError(`${flag} is required`);
  }
  const src = realish(source);
  const scr = realish(scratch);
  const cfg = realish(studentConfig);
  const pack = realish(packRoot);
  if (!existsSync(src) || !statSync(src).isDirectory()) throw new UsageError('--source is not a directory');
  if (!existsSync(cfg) || !statSync(cfg).isFile()) throw new UsageError('--student-config is not a file');
  const overlap = scratchOverlap(scr, [pack, src]);
  if (overlap === 'inside') throw new UsageError('--scratch must be outside the pack repo and the source');
  if (overlap === 'contains') throw new UsageError('--scratch must not contain the pack repo or the source');
  if (isInside(cfg, pack)) throw new UsageError('--student-config must be outside the pack repo');
  if (existsSync(scr) && (!statSync(scr).isDirectory() || readdirSync(scr).length > 0)) throw new UsageError('--scratch exists and is not an empty directory');
  return { source: src, scratch: scr, studentConfig: cfg, packRoot: pack };
}

// Parsed before any scratch exists so a bad config is a usage error (exit 2) that creates nothing. Only a ConfigError
// message (key path plus rule) is forwarded: js-yaml errors embed a snippet of the offending line.
function checkStudentConfig(file, packRoot = PACK_ROOT) {
  const text = readFileSync(file, 'utf8');
  const defaults = readFileSync(join(packRoot, 'templates', 'student.defaults.yml'), 'utf8');
  let config;
  try {
    config = parseConfig(text, defaults);
  } catch (err) {
    if (err instanceof ConfigError) throw new UsageError(`--student-config is invalid: ${err.message}`);
    throw new UsageError('--student-config is not valid YAML');
  }
  const hint = 'copy tests/fixtures/parity/student.yml outside the repo and edit it';
  if (config.presets.length === 0) throw new UsageError(`--student-config selects no preset; ${hint}`);
  if (config.tracks.length === 0) throw new UsageError(`--student-config selects no track; ${hint}`);
  return config;
}

// Removes only the scratch path this run created. Handlers are once-only; dispose() takes them off again.
// Children are killed before the directory goes so no stage writes into a deleted or recreated scratch.
export function installCleanup(scratch, proc = process, exit = process.exit, killChildren = () => {}) {
  const remove = () => rmSync(scratch, { recursive: true, force: true });
  const stop = (code) => () => {
    killChildren();
    remove();
    exit(code);
  };
  const handlers = { SIGINT: stop(130), SIGTERM: stop(143), uncaughtException: stop(1) };
  for (const [ev, fn] of Object.entries(handlers)) proc.once(ev, fn);
  return {
    remove,
    dispose() {
      for (const [ev, fn] of Object.entries(handlers)) proc.removeListener(ev, fn);
    },
  };
}

const skipVcs = (src) => !['.git', 'node_modules'].includes(basename(src));

// A directory symlink needs elevated rights on Windows; a junction does not.
export const linkType = (platform = process.platform) => (platform === 'win32' ? 'junction' : 'dir');

// The node_modules Node resolves from dir: its own, else the nearest ancestor's. A git worktree inside a checkout has
// none of its own and imports through the checkout's, which the scratch copy no longer sits under.
function nearestNodeModules(dir) {
  for (let d = resolve(dir); ; d = dirname(d)) {
    if (existsSync(join(d, 'node_modules'))) return join(d, 'node_modules');
    if (dirname(d) === d) return null;
  }
}

// Without the link the copy's stage scripts cannot import their dependencies, so the baseline cycle run fails.
async function copyTree(from, to) {
  await cp(from, to, { recursive: true, filter: skipVcs });
  const modules = nearestNodeModules(from);
  if (modules && !existsSync(join(to, 'node_modules'))) symlinkSync(modules, join(to, 'node_modules'), linkType());
}

// Children still running; a signal handler kills them so no stage outlives the scratch dir it works in.
const activeChildren = new Set();

function killActiveChildren() {
  for (const child of activeChildren) child.kill('SIGKILL');
}

// Runs one script as an async child process so the event loop can service signals; the result shape is the stageRunner contract.
export function defaultStageRunner({ script, args, cwd }) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [script, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    activeChildren.add(child);
    const out = [];
    const err = [];
    let size = 0;
    const take = (list) => (chunk) => {
      size += chunk.length;
      if (size <= MAX_STAGE_OUTPUT) list.push(chunk);
      else child.kill('SIGKILL');
    };
    child.stdout.on('data', take(out));
    child.stderr.on('data', take(err));
    const timer = setTimeout(() => child.kill('SIGKILL'), STAGE_TIMEOUT_MS);
    const finish = (status) => {
      clearTimeout(timer);
      activeChildren.delete(child);
      const stdout = Buffer.concat(out).toString('utf8');
      resolvePromise({ code: status, status, stdout, stderr: Buffer.concat(err).toString('utf8'), output: stdout });
    };
    child.on('error', () => finish(1));
    child.on('close', (status) => finish(status ?? 1));
  });
}

function packCommit(packRoot) {
  const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: packRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return (r.status === 0 && r.stdout.trim()) || 'unknown';
}

function upstreamVersion(source) {
  try {
    return JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

const outputOf = (res) => {
  if (typeof res === 'string') return res;
  if (res && typeof res.output === 'string' && res.output !== '') return res.output;
  return res && typeof res.stdout === 'string' ? res.stdout : '';
};

const FLAG_SPEC = { common: false, flags: { source: 'string', scratch: 'string', 'student-config': 'string', today: 'date', 'with-feeds': 'boolean', untriage: 'int', report: 'string' } };

function parseRunArgs(argv, packRootOpt) {
  try {
    const { flags } = parseArgs(argv, FLAG_SPEC);
    if (flags.untriage !== undefined && flags.untriage < 0) throw new UsageError('--untriage expects a whole number of 0 or more');
    const paths = checkArgs(flags, packRootOpt);
    return { flags, paths, config: checkStudentConfig(paths.studentConfig, paths.packRoot) };
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    console.error(err.message);
    return { code: 2 };
  }
}

// Removes triage= and reason= from the first n Pending rows and returns how many Pending rows with a title are left
// without a verdict, which is what the prefilter stage reads. The same call runs on both copies so they stay identical.
export function untriageRows(file, n) {
  if (!existsSync(file)) return 0;
  const doc = parsePipeline(readFileSync(file, 'utf8'));
  const section = doc.blocks.find((b) => b.kind === 'section' && b.name === 'Pending');
  const rows = sectionRows(doc, 'Pending');
  for (const { index, row } of rows.slice(0, n)) {
    row.notes.delete('triage');
    row.notes.delete('reason');
    section.lines[index] = formatRow(row);
  }
  if (n > 0 && rows.length) writeFileSync(file, serializePipeline(doc));
  return rows.filter(({ row }) => row.title && !row.notes.has('triage')).length;
}

async function setupScratch({ source, scratch, studentConfig, packRoot, untriage = 0 }) {
  const baseline = join(scratch, 'baseline');
  const packDir = join(scratch, 'pack-root');
  await copyTree(source, baseline);
  mkdirSync(packDir);
  for (const item of ['data', 'modes']) if (existsSync(join(source, item))) await cp(join(source, item), join(packDir, item), { recursive: true });
  if (existsSync(join(source, 'portals.yml'))) await cp(join(source, 'portals.yml'), join(packDir, 'portals.yml'));
  mkdirSync(join(packDir, 'config'), { recursive: true });
  await cp(studentConfig, join(packDir, 'config', 'student.yml'));
  await copyTree(packRoot, join(packDir, 'student'));
  mkdirSync(join(scratch, 'frozen'));
  untriageRows(join(baseline, 'data', 'pipeline.md'), untriage);
  return { baseline, packDir, prefilterInput: untriageRows(join(packDir, 'data', 'pipeline.md'), untriage) };
}

const substitute = (args, today, ctx) => args.map((a) => a.replace('{today}', today).replace('{frozen}', ctx.frozen ?? '').replace('{tsv}', ctx.tsv ?? ''));

// The clone keeps its working stage scripts in local/ while the root may hold older generic copies, so local/ wins.
// null means no such script: the stage reports a missing script, so a spawned path that exits 1 is never read as a row difference.
function localScript(baseline, name) {
  return [join(baseline, 'local', name), join(baseline, name), join(baseline, 'scripts', name)].find((p) => existsSync(p)) ?? null;
}

async function runStageSide(env, stage, side, ctx) {
  const local = side === 'baseline';
  const [name, ...rest] = local ? stage.local : stage.pack;
  const root = local ? env.baseline : env.packDir;
  const script = local ? localScript(env.baseline, name) : join(env.packDir, 'student', 'scripts', name);
  if (!script || !existsSync(script)) return { missing: true };
  const extra = local ? [] : ['--root', env.packDir];
  const res = await env.stageRunner({ stage: stage.name, side, script, args: [...substitute(rest, env.today, ctx), ...extra], cwd: root });
  const code = res && typeof res === 'object' ? res.code ?? res.status ?? 0 : 0;
  const stdout = typeof res === 'string' ? res : res && typeof res.stdout === 'string' ? res.stdout : '';
  const captured = stage.capture && existsSync(join(root, stage.capture)) ? readFileSync(join(root, stage.capture), 'utf8') : outputOf(res);
  return { out: captured, stdout, code };
}

// A failed side is an error, never a row difference: counting an exit mismatch as +1 let two failing sides pass.
// Notes are fixed strings and exit integers because stderr can carry rows or paths.
function stageFault(base, pack) {
  if (base.missing) return NOTES.baselineMissing;
  if (pack.missing) return NOTES.packMissing;
  if (base.code !== 0 && pack.code !== 0) return exitNote('both', [base.code, pack.code]);
  if (base.code !== 0) return exitNote('baseline', base.code);
  if (pack.code !== 0) return exitNote('pack', pack.code);
  return null;
}

// cycle.mjs refuses --today without --json or --dry-run and neither writes the file, so the pack prefilter would read
// no cycle and skip the term rule. The baseline side gets no file: its prefilter computes its own cycle for --today
// and the harness never writes into the baseline copy.
function judgeCycle(env, name, baseOut, packOut) {
  const result = compareCycle(name, baseOut, packOut);
  if (result.verdict === 'error') return result;
  try {
    mkdirSync(join(env.packDir, 'data'), { recursive: true });
    writeCycle(join(env.packDir, 'data', 'student-cycle.json'), JSON.parse(packOut));
  } catch (err) {
    if (!(err instanceof SyntaxError || err instanceof CycleFileError)) throw err;
    return stageError(name, NOTES.packMalformed);
  }
  return result;
}

const readIfExists = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : '');

function judgeStage(env, stage, base, pack, carried) {
  const fault = stageFault(base, pack);
  if (fault) return stageError(stage.name, fault);
  if (stage.compare === 'cycle') return judgeCycle(env, stage.name, base.out, pack.out);
  if (stage.compare === 'rank') return compareRankQueue(stage.name, base.out, pack.out, { carried });
  if (stage.compare === 'prefilter') return comparePrefilter(stage.name, base.out, pack.out, { internOnly: env.internOnly });
  if (stage.compare === 'audit') return compareFailAudit(stage.name, base.out, pack.out, env.audit);
  return compareStage(stage.name, base.out, pack.out, { explained: stage.explain === 'merge-stats' ? mergeAllowance(pack.stdout) : 0 });
}

async function runStages(env, state) {
  const results = [];
  const verdicts = new Map();
  const outputs = {};
  let carried = new Set();
  const tsv = join(env.source, 'data', 'handshake-pages.tsv');
  const record = (r) => {
    results.push(r);
    verdicts.set(r.stage, r.verdict);
  };
  for (const stage of STAGES) {
    if (state.interrupted !== null) break;
    if (stage.needsTsv && !existsSync(tsv)) {
      record(skippedStage(stage.name, NOTES.noTsv));
      continue;
    }
    // A stage fed by a failed stage would compare garbage, so it is marked error without running.
    if ([stage.frozen, stage.dependsOn].some((dep) => dep && verdicts.get(dep) === 'error')) {
      record(stageError(stage.name, NOTES.dependsOnFailed));
      continue;
    }
    const frozen = stage.frozen ? join(env.scratch, 'frozen', `${stage.frozen}.txt`) : undefined;
    if (frozen) writeFileSync(frozen, outputs[stage.frozen] ?? '');
    const ctx = { frozen, tsv: stage.needsTsv ? tsv : undefined };
    const base = await runStageSide(env, stage, 'baseline', ctx);
    if (state.interrupted !== null) break;
    outputs[stage.name] = base.out ?? '';
    // Read before the pack side runs: the pack stage rewrites data/pipeline.md in place.
    const before = stage.carry ? readIfExists(join(env.packDir, 'data', 'pipeline.md')) : '';
    const pack = await runStageSide(env, stage, 'pack', ctx);
    if (state.interrupted !== null) break;
    const judged = judgeStage(env, stage, base, pack, carried);
    record(judged);
    // A stage that faulted, errored or did not run leaves no trustworthy pipeline, so it carries nothing.
    if (stage.carry && judged.verdict !== 'error') carried = carriedPending(before, pack.out ?? '');
  }
  return results;
}

async function runFeedCompare(env) {
  const fetchFeed = async (side, args) => {
    const local = side === 'baseline';
    const script = local ? localScript(env.baseline, 'scan.mjs') ?? join(env.baseline, 'scan.mjs') : join(env.packDir, 'student', 'scripts', 'discover-github-lists.mjs');
    const res = await env.stageRunner({ stage: 'feed', side, script, args, cwd: local ? env.baseline : env.packDir });
    return outputOf(res);
  };
  const packArgs = ['--root', env.packDir, '--dry-run', '--json', '--today', env.today];
  const fetchA = await fetchFeed('pack', packArgs);
  const local = await fetchFeed('baseline', ['--dry-run', '--no-resolve']);
  const fetchB = await fetchFeed('pack', packArgs);
  return compareFeed(fetchA, fetchB, local);
}

function reportAndExit({ interrupted, failure, text, results, report }) {
  if (interrupted !== null) return interrupted;
  if (failure) {
    console.error(`parity run failed (${failure.name}); scratch copy removed`);
    return 1;
  }
  if (report) writeFileSync(resolve(report), text);
  else console.log(text);
  return overallVerdict(results) === 'fail' ? 1 : 0;
}

// Returns an exit code: 0 pass or explained, 1 fail, any stage error or a crashed run, 2 usage, 130/143 interrupted.
export async function runParity(argv, { stageRunner = defaultStageRunner, proc = process, exit = process.exit, packRoot: packRootOpt = PACK_ROOT } = {}) {
  const parsed = parseRunArgs(argv, packRootOpt);
  if (parsed.code !== undefined) return parsed.code;
  const { flags, paths, config } = parsed;
  const today = flags.today ?? createClock({}).today();
  const audit = auditOptions(config);
  const internOnly = config.rank?.intern_only ?? [];

  mkdirSync(paths.scratch, { recursive: true });
  const state = { interrupted: null };
  const cleanup = installCleanup(paths.scratch, proc, (code) => {
    state.interrupted = code;
    exit(code);
  }, killActiveChildren);
  let results = [];
  let text = null;
  let failure = null;
  try {
    const dirs = await setupScratch({ ...paths, untriage: flags.untriage ?? 0 });
    const env = { ...dirs, source: paths.source, scratch: paths.scratch, today, stageRunner, audit, internOnly };
    if (state.interrupted === null) results = await runStages(env, state);
    if (state.interrupted === null && flags.withFeeds) results.push(await runFeedCompare(env));
    if (state.interrupted === null) text = formatParityReport(results, { date: today, upstream: upstreamVersion(paths.source), pack: packCommit(paths.packRoot), prefilterInput: dirs.prefilterInput });
  } catch (err) {
    // Only the class name is kept: the message can hold paths or rows from the scratch copy.
    failure = { name: err?.name ?? 'Error' };
  } finally {
    cleanup.remove();
    cleanup.dispose();
  }
  return reportAndExit({ interrupted: state.interrupted, failure, text, results, report: flags.report });
}

if (isMain(import.meta.url)) await runCli(() => runParity(process.argv.slice(2)));
