// Fixtures for the P5 lever tests: a scratch copy of the pack, a symlinked pack root with its own
// docs/lever-verdicts.json, fake agent runners that answer with canned usage and never start a process, and loose
// readers for the verdict file. Verdict file format written by the tests (ruling): { "levers": { "<id>": { "verdict":
// "pass" | "fail" | "milder" | "pending", "tokens": { "before", "after" }, "quality": { "before", "after" } } } }.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { BlockedError } from '../../tools/quality-baseline.mjs';
import { PACK_ROOT } from './script-harness.mjs';

export { PACK_ROOT };
export const PLUMBING = ['T1', 'T13', 'T15'];
export const GATED = ['T3', 'T6', 'T7', 'T8', 'T14', 'T16'];
export const TUNING = ['T2', 'T4', 'T5', 'T9', 'T10', 'T11', 'T12', 'T17', 'economy_tier', 'jd_trim', 'batch_size'];
export const ALL_LEVERS = [...PLUMBING, ...GATED, ...TUNING];

// The resolved ids the P0 baseline recorded (tests/fixtures/quality/baseline calls.tsv and noise.json).
export const P0_MODELS = Object.freeze({ claude: 'claude-sonnet-5-5', codex: 'gpt-6.2-sol', judge: 'claude-opus-5-5' });
export const FAKE_MODELS = Object.freeze({ claude: 'claude-fake-model-1', codex: 'codex-fake-model-1', judge: 'claude-fake-judge-1' });
export const SMALL_USAGE = Object.freeze({ input_tokens: 1200, output_tokens: 300 });
export const HUGE_USAGE = Object.freeze({ input_tokens: 5e9, output_tokens: 5e9 });

// A call that carries MARKER (the lean headless brief T10 loads from the scratch root) gets a degraded answer: reversed
// triage scores and a DEGRADED tag the judge then rates as worse with an invented fact.
export const MARKER = 'LEAN-BRIEF-MARKER-Q7';
export const DEGRADED = 'DEGRADED-DRAFT-Z3';
const GOOD_JUDGE = '{"verdict":"tie","not_worse":true,"invented_facts":0}';
const BAD_JUDGE = '{"verdict":"base","not_worse":false,"invented_facts":1}';
const PLAIN = 'I would welcome the chance to talk about the role.';

export function agentReply(agent, text, usage, model) {
  const stdout =
    agent === 'codex'
      ? [{ type: 'thread.started', thread_id: 't-fake' }, { type: 'item.completed', item: { id: 'i0', type: 'agent_message', text } }, { type: 'turn.completed', usage }].map((e) => JSON.stringify(e)).join('\n')
      : JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: text, usage, modelUsage: { [model]: { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens } } });
  return { status: 0, code: 0, stdout, stderr: '', text, usage, model };
}

export function quotaReply(agent) {
  const message = 'API Error: 429 rate limit reached, usage quota exceeded';
  const stdout = agent === 'codex' ? JSON.stringify({ type: 'error', message }) : JSON.stringify({ type: 'result', subtype: 'error', is_error: true, result: message });
  return { status: 1, code: 1, stdout, stderr: message, text: '', usage: null, model: null, error: message };
}

const agentOf = (call) => (call?.agent === 'codex' ? 'codex' : 'claude');
const isJudgeCall = (call) => /opus|judge/i.test(String(call?.model ?? ''));
const urlsIn = (text) => [...new Set(String(text ?? '').match(/https?:\/\/[^\s|<>"')]+/g) ?? [])];

// runner answers draft and triage calls; judge answers judge calls (a runner call whose model names opus is a judge call
// too). fail(call) may return a reply that replaces the canned one. missAlways makes every judge verdict worse with an
// invented fact.
export function fakeAgents({ models = FAKE_MODELS, usage = SMALL_USAGE, fail = null, missAlways = false, onCall = null } = {}) {
  const calls = [];
  const judgeReply = (call) => {
    const bad = missAlways || JSON.stringify(call ?? {}).includes(DEGRADED);
    return agentReply('claude', bad ? BAD_JUDGE : GOOD_JUDGE, usage, models.judge);
  };
  const take = (call, judging) => {
    calls.push(call);
    onCall?.(call);
    const failed = fail?.(call, judging);
    if (failed) return failed;
    if (judging || isJudgeCall(call)) return judgeReply(call);
    const agent = agentOf(call);
    const degraded = JSON.stringify(call ?? {}).includes(MARKER);
    const urls = urlsIn(call?.prompt);
    const body = urls.length ? urls.map((u, i) => `TRIAGE: PASS | ${u} | ${(degraded ? 3 + i * 0.01 : 5 - i * 0.01).toFixed(2)} | fits the rules`).join('\n') : PLAIN;
    return agentReply(agent, degraded ? `${body}\n${DEGRADED}` : body, usage, models[agent]);
  };
  return { runner: (call) => take(call, false), judge: (call) => take(call, true), calls };
}

export const resolve = (agent) => `/fake/bin/${agent}`;

export function sayer() {
  const lines = [];
  return { say: (...a) => lines.push(a.join(' ')), lines };
}

// A tool may report through a returned code or a thrown error; both read as the exit code.
export async function codeOf(work, sink = null) {
  try {
    const v = await work;
    if (typeof v === 'number') return v;
    return v?.code ?? v?.exitCode ?? 0;
  } catch (err) {
    if (sink) sink.push(String(err?.message ?? err));
    if (err instanceof BlockedError) return 5;
    if (typeof err?.exitCode === 'number') return err.exitCode;
    if (typeof err?.code === 'number') return err.code;
    throw err;
  }
}

// A full copy of the pack (the P0 baseline included) with node_modules linked and no lever verdicts yet.
export function packCopy() {
  const dir = mkdtempSync(join(tmpdir(), 'lever-pack-'));
  const skip = new Set(['.git', 'node_modules', '.solatis']);
  cpSync(PACK_ROOT, dir, { recursive: true, filter: (src) => !skip.has(basename(src)) });
  symlinkSync(join(PACK_ROOT, 'node_modules'), join(dir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  rmSync(join(dir, 'docs', 'lever-verdicts.json'), { force: true });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// Adds MARKER to the copy's lean headless brief (templates/headless-brief.md), so any call built with T10 on carries it.
export function markBrief(dir) {
  const file = join(dir, 'templates', 'headless-brief.md');
  const prev = existsSync(file) ? readFileSync(file, 'utf8') : '# Headless brief\n';
  writeFileSync(file, `${prev}\n${MARKER}\n`);
}

// A pack root whose entries link to the real pack, except docs/lever-verdicts.json, which holds the given verdicts.
export function packFarm(verdicts) {
  const dir = mkdtempSync(join(tmpdir(), 'lever-farm-'));
  for (const name of readdirSync(PACK_ROOT)) if (!['docs', '.git'].includes(name)) symlinkSync(join(PACK_ROOT, name), join(dir, name));
  mkdirSync(join(dir, 'docs'));
  for (const name of readdirSync(join(PACK_ROOT, 'docs'))) if (name !== 'lever-verdicts.json') symlinkSync(join(PACK_ROOT, 'docs', name), join(dir, 'docs', name));
  writeVerdicts(dir, verdicts);
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export function writeVerdicts(dir, levers, extra = {}) {
  mkdirSync(join(dir, 'docs'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'lever-verdicts.json'), `${JSON.stringify({ levers, ...extra }, null, 2)}\n`);
}

// A solo verdict whose quality fell by `loss` on the overlap and judge bars.
export const soloVerdict = (verdict, loss = 0) => ({
  verdict,
  tokens: { before: 10000, after: 8000 },
  quality: { before: { OVERLAP_MIN: 1, JUDGE_NOT_WORSE_MIN: 1 }, after: { OVERLAP_MIN: 1 - loss, JUDGE_NOT_WORSE_MIN: 1 - loss } },
});

export const verdictText = (dir) => readFileSync(join(dir, 'docs', 'lever-verdicts.json'), 'utf8');
export const verdictJson = (dir) => JSON.parse(verdictText(dir));

// The verdict entry of one lever: data.levers[id], data.verdicts[id], data[id], or an array entry whose id or lever is id.
export function verdictOf(data, id) {
  for (const pool of [data?.levers, data?.verdicts, data]) {
    if (!pool || typeof pool !== 'object') continue;
    if (Array.isArray(pool)) {
      const hit = pool.find((x) => x?.id === id || x?.lever === id);
      if (hit) return hit;
    } else if (pool[id] && typeof pool[id] === 'object') return pool[id];
  }
  return undefined;
}

// The verdict word of an entry (pass, fail, milder or pending).
export const wordOf = (v) => String(v?.verdict ?? v?.result ?? v?.status ?? '').toLowerCase();

// The first value under a key matching re, searched depth first.
export function findKey(node, re) {
  if (!node || typeof node !== 'object') return undefined;
  for (const [k, v] of Object.entries(node)) {
    if (re.test(k)) return v;
    const inner = findKey(v, re);
    if (inner !== undefined) return inner;
  }
  return undefined;
}

export function numbersIn(node) {
  if (typeof node === 'number' && Number.isFinite(node)) return [node];
  if (!node || typeof node !== 'object') return [];
  return Object.values(node).flatMap(numbersIn);
}

// [before, after] of a measure: v[name].before/after, v[name_before]/v[name_after] or v[nameBefore]/v[nameAfter].
export function beforeAfter(v, name) {
  const o = v?.[name];
  if (o && typeof o === 'object' && 'before' in o && 'after' in o) return [o.before, o.after];
  const cap = name[0].toUpperCase() + name.slice(1);
  return [v?.[`${name}_before`] ?? v?.[`${name}Before`], v?.[`${name}_after`] ?? v?.[`${name}After`]];
}

// The stacked rounds array (under a key named rounds) and the lever ids each round had on (its levers or on list).
export const roundsOf = (data) => {
  const r = findKey(data, /^rounds$/i);
  return Array.isArray(r) ? r : [];
};
export const leversOn = (round) => {
  const list = round?.levers ?? round?.on;
  return Array.isArray(list) ? list.map((x) => (typeof x === 'string' ? x : x?.id ?? x?.lever)) : [];
};
