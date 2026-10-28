#!/usr/bin/env node
// Maintainer-only parity harness: runs the upstream scripts and the pack scripts on identical copies of a
// career-ops checkout inside a scratch directory, compares the stage outputs and writes a count-only report.
// Every path is explicit; there are no defaults and no flag that keeps the scratch copy, because the copy can hold
// personal rows and is deleted on every exit path (normal end, a throwing stage, SIGINT, SIGTERM, uncaught error).
// Usage: parity.mjs --source <career-ops dir> --scratch <new dir> --student-config <yml> [--today D] [--with-feeds] [--report <file>]
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError, parseArgs, runCli } from '../lib/args.mjs';
import { createClock } from '../lib/clock.mjs';
import { compareFeed, compareStage, formatReport, overallVerdict } from './parity-compare.mjs';

const PACK_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FIXED_N = '10';

// One entry per deterministic stage. {today}, {frozen} and {tsv} are substituted. capture names a file read after the
// run in place of stdout. frozen names an earlier stage whose baseline output both sides then consume.
export const STAGES = [
  { name: 'cycle', local: ['cycle.mjs', '--json', '--today', '{today}'], pack: ['cycle.mjs', '--json', '--today', '{today}'] },
  { name: 'prefilter', local: ['prefilter.mjs', '--today', '{today}'], pack: ['prefilter.mjs', '--today', '{today}'] },
  { name: 'apply-triage', local: ['apply-triage.mjs', '{frozen}'], pack: ['apply-triage.mjs', '{frozen}'], frozen: 'prefilter', capture: join('data', 'pipeline.md') },
  { name: 'merge-staging', local: ['merge-staging.mjs'], pack: ['merge-post.mjs', '--today', '{today}'], capture: join('data', 'pipeline.md') },
  { name: 'rank-queue', local: ['rank-queue.mjs', '--json', '--n', FIXED_N, '--today', '{today}'], pack: ['rank-queue.mjs', '--json', '--n', FIXED_N, '--today', '{today}'] },
  { name: 'fail-audit', local: ['fail-audit.mjs', 'pick', '--n', FIXED_N], pack: ['fail-audit.mjs', 'pick', '--n', FIXED_N] },
  { name: 'handshake-import', local: ['handshake-import.mjs', '--out', join('data', 'handshake.out.md'), '{tsv}'], pack: ['handshake-import.mjs', '--out', join('data', 'handshake.out.md'), '{tsv}'], capture: join('data', 'handshake.out.md'), needsTsv: true },
];

// Resolves symlinks in the longest existing prefix so a link cannot hide a scratch dir inside the pack or source.
function realish(p) {
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
  if (isInside(scr, pack) || isInside(scr, src)) throw new UsageError('--scratch must be outside the pack repo and the source');
  if (isInside(src, scr) || isInside(pack, scr)) throw new UsageError('--scratch must not contain the pack repo or the source');
  if (isInside(cfg, pack)) throw new UsageError('--student-config must be outside the pack repo');
  if (existsSync(scr) && (!statSync(scr).isDirectory() || readdirSync(scr).length > 0)) throw new UsageError('--scratch exists and is not an empty directory');
  return { source: src, scratch: scr, studentConfig: cfg, packRoot: pack };
}

// Removes only the scratch path this run created. Handlers are once-only; dispose() takes them off again.
export function installCleanup(scratch, proc = process, exit = process.exit) {
  const remove = () => rmSync(scratch, { recursive: true, force: true });
  const handlers = {
    SIGINT: () => {
      remove();
      exit(130);
    },
    SIGTERM: () => {
      remove();
      exit(143);
    },
    uncaughtException: () => {
      remove();
      exit(1);
    },
  };
  for (const [ev, fn] of Object.entries(handlers)) proc.once(ev, fn);
  return {
    remove,
    dispose() {
      for (const [ev, fn] of Object.entries(handlers)) proc.removeListener(ev, fn);
    },
  };
}

const skipVcs = (src) => !['.git', 'node_modules'].includes(basename(src));

function copyTree(from, to) {
  cpSync(from, to, { recursive: true, filter: skipVcs });
  if (existsSync(join(from, 'node_modules'))) symlinkSync(join(from, 'node_modules'), join(to, 'node_modules'), 'dir');
}

// Runs one script as a child process; the result shape is the stageRunner contract.
export function defaultStageRunner({ script, args, cwd }) {
  const r = spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 300000, stdio: ['ignore', 'pipe', 'pipe'] });
  const stdout = r.stdout ?? '';
  return { code: r.status ?? 1, status: r.status ?? 1, stdout, stderr: r.stderr ?? '', output: stdout };
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

const FLAG_SPEC = { common: false, flags: { source: 'string', scratch: 'string', 'student-config': 'string', today: 'date', 'with-feeds': 'boolean', report: 'string' } };

// Returns an exit code: 0 pass or explained, 1 fail or a stage error, 2 usage, 130/143 interrupted.
export async function runParity(argv, { stageRunner = defaultStageRunner, proc = process, exit = process.exit, packRoot: packRootOpt = PACK_ROOT } = {}) {
  let paths;
  let flags;
  try {
    ({ flags } = parseArgs(argv, FLAG_SPEC));
    paths = checkArgs(flags, packRootOpt);
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(err.message);
      return 2;
    }
    throw err;
  }
  const { source, scratch, studentConfig, packRoot } = paths;
  const today = flags.today ?? createClock({}).today();

  mkdirSync(scratch, { recursive: true });
  let interrupted = null;
  const cleanup = installCleanup(scratch, proc, (code) => {
    interrupted = code;
    exit(code);
  });
  let results = [];
  let text = null;
  let failed = false;
  try {
    const baseline = join(scratch, 'baseline');
    const packDir = join(scratch, 'pack-root');
    copyTree(source, baseline);
    mkdirSync(packDir);
    for (const item of ['data', 'modes']) if (existsSync(join(source, item))) cpSync(join(source, item), join(packDir, item), { recursive: true });
    if (existsSync(join(source, 'portals.yml'))) cpSync(join(source, 'portals.yml'), join(packDir, 'portals.yml'));
    mkdirSync(join(packDir, 'config'), { recursive: true });
    cpSync(studentConfig, join(packDir, 'config', 'student.yml'));
    copyTree(packRoot, join(packDir, 'student'));
    mkdirSync(join(scratch, 'frozen'));

    const tsv = join(source, 'data', 'handshake-pages.tsv');
    const sub = (args, ctx) => args.map((a) => a.replace('{today}', today).replace('{frozen}', ctx.frozen ?? '').replace('{tsv}', ctx.tsv ?? ''));
    const localScript = (name) => (existsSync(join(baseline, name)) ? join(baseline, name) : join(baseline, 'scripts', name));
    const run = async (stage, side, ctx) => {
      const local = side === 'baseline';
      const [name, ...rest] = local ? stage.local : stage.pack;
      const root = local ? baseline : packDir;
      const script = local ? localScript(name) : join(packDir, 'student', 'scripts', name);
      const extra = local ? [] : ['--root', packDir];
      const res = await stageRunner({ stage: stage.name, side, script, args: [...sub(rest, ctx), ...extra], cwd: root });
      const code = res && typeof res === 'object' ? res.code ?? res.status ?? 0 : 0;
      const captured = stage.capture && existsSync(join(root, stage.capture)) ? readFileSync(join(root, stage.capture), 'utf8') : outputOf(res);
      return { out: captured, code };
    };

    const outputs = {};
    for (const stage of STAGES) {
      if (interrupted !== null) break;
      if (stage.needsTsv && !existsSync(tsv)) continue;
      const frozen = stage.frozen ? join(scratch, 'frozen', `${stage.frozen}.txt`) : undefined;
      if (frozen) writeFileSync(frozen, outputs[stage.frozen] ?? '');
      const ctx = { frozen, tsv: stage.needsTsv ? tsv : undefined };
      const base = await run(stage, 'baseline', ctx);
      if (interrupted !== null) break;
      outputs[stage.name] = base.out;
      const pack = await run(stage, 'pack', ctx);
      if (interrupted !== null) break;
      const result = compareStage(stage.name, base.out, pack.out);
      if (base.code !== pack.code) {
        result.verdict = 'fail';
        result.added += 1;
      }
      results.push(result);
    }
    if (interrupted === null && flags.withFeeds) {
      const feed = { name: 'feed' };
      const fetch = async (side, args) => {
        const root = side === 'baseline' ? baseline : packDir;
        const script = side === 'baseline' ? localScript('scan.mjs') : join(packDir, 'student', 'scripts', 'discover-github-lists.mjs');
        const res = await stageRunner({ stage: feed.name, side, script, args, cwd: root });
        return outputOf(res);
      };
      const packArgs = ['--root', packDir, '--dry-run', '--json', '--today', today];
      const fetchA = await fetch('pack', packArgs);
      const local = await fetch('baseline', ['--dry-run', '--no-resolve']);
      const fetchB = await fetch('pack', packArgs);
      results.push(compareFeed(fetchA, fetchB, local));
    }
    if (interrupted === null) text = formatReport(results, { date: today, upstream: upstreamVersion(source), pack: packCommit(packRoot) });
  } catch {
    failed = true;
  } finally {
    cleanup.remove();
    cleanup.dispose();
  }
  if (interrupted !== null) return interrupted;
  if (failed) {
    console.error('parity run failed; scratch copy removed');
    return 1;
  }
  if (flags.report) writeFileSync(resolve(flags.report), text);
  else console.log(text);
  return overallVerdict(results) === 'fail' ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await runCli(() => runParity(process.argv.slice(2)));
