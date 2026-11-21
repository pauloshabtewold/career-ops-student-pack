// Stub so the M-001 tests fail on behaviour; M-001 replaces every body.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAgentPath } from '../lib/agent.mjs';
import { SAMPLE_SIZES, TOP_N } from '../lib/quality-bars.mjs';

const PACK_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export const FIXTURES = join('tests', 'fixtures', 'quality');
export const BASELINE = join(FIXTURES, 'baseline');
export const PROFILES = ['software-cs', 'finance-economics', 'nursing', 'policy-government', 'mis-business-analytics'];
export const ARMS = ['A', 'AA'];
export const EXIT = Object.freeze({ ok: 0, usage: 2, refused: 3, blocked: 5 });
export class BlockedError extends Error {}

const todo = () => {
  throw new Error('not implemented');
};

export const sha256 = (text) => todo(text);
export function productDrift({ git, base }) {
  return todo(git, base);
}
export function estimate({ profiles = PROFILES, postings = 60, drafts = 36, forms = 6, mails = SAMPLE_SIZES.outcome_mails + SAMPLE_SIZES.labeled_replies, arms = ARMS.length, judgePairs = 36 } = {}) {
  return todo(profiles, postings, drafts, forms, mails, arms, judgePairs);
}
export function createMeter(limit) {
  return todo(limit);
}
export function parseClaudeJson(stdout) {
  return todo(stdout);
}
export function parseCodexJsonl(stdout) {
  return todo(stdout);
}
export function defaultRunner({ agent, agentPath, prompt, model }) {
  return todo(agent, agentPath, prompt, model);
}
export const MAIL_PROFILE = 'mail';
export const MAIL_STEPS = [];
export function planMailCalls({ root }) {
  return todo(root);
}
export function planCalls({ root, profiles = PROFILES }) {
  return todo(root, profiles);
}
export async function capture({ root = PACK_ROOT, replace = false, base, git, runner = defaultRunner, resolve = resolveAgentPath, say = console.log, profiles = PROFILES }) {
  return todo(root, replace, base, git, runner, resolve, say, profiles);
}
export function topUrls(text, n = TOP_N) {
  return todo(text, n);
}
export const overlap = (a, b, n = TOP_N) => todo(a, b, n);
export function formAccuracy(answerText, expected) {
  return todo(answerText, expected);
}
export function seededOrder(seed, i) {
  return todo(seed, i);
}
export function labelAccuracy(out, arm, agent, step, items) {
  return todo(out, arm, agent, step, items);
}
export function mailBase({ root, out }) {
  return todo(root, out);
}
export function loadRuleBase(root) {
  return todo(root);
}
export async function noise({ root = PACK_ROOT, runner = defaultRunner, resolve = resolveAgentPath, say = console.log, seed = String(Date.now()), profiles = PROFILES }) {
  return todo(root, runner, resolve, say, seed, profiles);
}
export function renderBarsModule(current, aa, effective, frozen) {
  return todo(current, aa, effective, frozen);
}
export function renderGateTable(current, aa, effective) {
  return todo(current, aa, effective);
}
export function hashTree(root) {
  return todo(root);
}
export async function freeze({ root = PACK_ROOT, replace = false, git, say = console.log }) {
  return todo(root, replace, git, say);
}
