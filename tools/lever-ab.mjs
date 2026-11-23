#!/usr/bin/env node
// Lever A/B gate (P5): signatures only; every body throws until the milestone is implemented.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAgentPath } from '../lib/agent.mjs';
import { LEVER_IDS } from '../lib/levers.mjs';
import { defaultRunner } from './quality-baseline.mjs';

const PACK_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const notImplemented = (name) => {
  throw new Error(`${name}: not implemented`);
};

export const VERDICTS = join('docs', 'lever-verdicts.json');
export const REPORT = join('docs', 'token-report.md');
export const EXIT = Object.freeze({ ok: 0, usage: 2, refused: 3, blocked: 5 });
export const MAX_STACKED_ROUNDS = 3;

export function formLeverMetrics(root, base) {
  return notImplemented('formLeverMetrics');
}

export function templateAtsProblems(markdown) {
  return notImplemented('templateAtsProblems');
}

export function resumeLeverMetrics({ root, threshold, agents, runner, meter, models, judge, seed, atsCheck = templateAtsProblems }) {
  return notImplemented('resumeLeverMetrics');
}

export function missedBar(metrics, bars, base = {}) {
  return notImplemented('missedBar');
}

export function readVerdictFile(root) {
  return notImplemented('readVerdictFile');
}

export async function runSolo({ root = PACK_ROOT, levers = LEVER_IDS, runner = defaultRunner, judge, resolve = resolveAgentPath, say = console.log, seed = String(Date.now()), today = new Date().toISOString().slice(0, 10) }) {
  return notImplemented('runSolo');
}

export function soloLoss(v) {
  return notImplemented('soloLoss');
}

export async function runStacked({ root = PACK_ROOT, runner = defaultRunner, judge, resolve = resolveAgentPath, say = console.log, seed = String(Date.now()), today = new Date().toISOString().slice(0, 10) }) {
  return notImplemented('runStacked');
}
