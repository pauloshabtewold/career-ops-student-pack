// Cost of the model triage: measured tokens per row and per call, published API prices and plan limits with their
// sources and access date, and the estimate lines the pack prints. Every figure is an estimate. Node built-ins only;
// the one import is the chunk size, so a chunk is counted the same way here and in daily-triage.mjs.
import { CHUNK_ROWS } from './triage-budget.mjs';

// lib/config.mjs imports PLAN_IDS from here, so this file cannot import config.mjs's deepFreeze.
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export const ACCESS_DATE = '2026-10-30';
const source = (url) => Object.freeze({ url, accessed: ACCESS_DATE });
const CLAUDE_PRICING = 'https://platform.claude.com/docs/en/about-claude/pricing';
const OPENAI_PRICING = 'https://developers.openai.com/api/docs/pricing';

// Tokens come from synthetic fixtures built by scripts/ci/usage-fixture.mjs. Per-row figures are the difference between
// the 5-row and 20-row runs divided by 15; the fixed figure is the 5-row run minus 5 rows. Claude was measured with
// --setting-sources project --strict-mcp-config so the fixed part does not depend on a student's own plugins or MCP servers.
// A live 45-row run from a career-ops install on 2026-10-30 (W-022), with CLAUDE.md excluded, came within 8% on input.
export const MEASURED = freeze({
  date: ACCESS_DATE,
  method: 'synthetic fixtures at 1, 5 and 20 rows from scripts/ci/usage-fixture.mjs; per-row figures from the 5 vs 20 difference',
  claude: {
    model: 'sonnet',
    flags: "-p --tools '' --setting-sources project --strict-mcp-config --settings student/templates/triage-claude-settings.json --model sonnet",
    client: 'Claude Code 2.1.310',
    fixedInput: 3600,
    inputPerRow: 1548,
    outputPerRow: 104,
  },
  codex: {
    effort: 'medium',
    client: 'codex-cli 0.165.0-alpha',
    fixedInput: 11300,
    inputPerRow: 1038,
    outputPerRow: 31,
  },
});

// Dollars per million tokens at the base input rate; cache hits are listed but never applied, so the estimate is an upper bound.
export const PRICES = freeze({
  sonnet: { label: 'Claude Sonnet 5.5', input: 2, cacheHit: 0.1, output: 10, source: source(CLAUDE_PRICING) },
  opus: { label: 'Claude Opus 5.5', input: 4, cacheHit: 0.2, output: 20, source: source(CLAUDE_PRICING) },
  'gpt-6.1-sol': {
    label: 'gpt-6.1-sol',
    input: 2,
    cacheHit: 0.1,
    output: 10,
    note: 'likely the Codex default but not stated by OpenAI; check /status',
    source: source(OPENAI_PRICING),
  },
});

export const PLAN_IDS = Object.freeze(['claude-pro', 'claude-max', 'claude-ultra', 'chatgpt-plus', 'chatgpt-pro', 'api', 'unknown']);

const NOT_PUBLISHED = 'not published';
const CLAUDE_SOURCES = [
  'https://support.claude.com/en/articles/8325606-what-is-the-pro-plan',
  'https://support.claude.com/en/articles/11049741-what-is-the-max-plan',
  'https://support.claude.com/en/articles/17728952-what-is-the-ultra-plan',
  'https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan',
  'https://claude.com/pricing',
].map(source);
const OPENAI_SOURCES = [
  'https://help.openai.com/en/articles/20001516-managing-usage-with-gpt-6-astra-in-work-and-codex',
  'https://learn.chatgpt.com/docs/pricing',
  'https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers',
].map(source);

// Only published values appear; where a plan states no number the field says 'not published'.
export const PLANS = freeze({
  'claude-pro': {
    label: 'Claude Pro',
    family: 'claude',
    fiveHour: NOT_PUBLISHED,
    weekly: NOT_PUBLISHED,
    note: 'Pro has a five-hour limit and a weekly limit; the message count varies with message length',
    sources: CLAUDE_SOURCES,
  },
  'claude-max': { label: 'Claude Max', family: 'claude', fiveHour: '5x Pro', weekly: '5x Pro', note: 'a multiple of Pro, which publishes no number', sources: CLAUDE_SOURCES },
  'claude-ultra': {
    label: 'Claude Ultra',
    family: 'claude',
    fiveHour: 'none once the account is verified',
    weekly: '10x Pro',
    note: 'formerly Max 20x; a multiple of Pro, which publishes no number',
    sources: CLAUDE_SOURCES,
  },
  'chatgpt-plus': {
    label: 'ChatGPT Plus',
    family: 'chatgpt',
    fiveHour: '15-160 local messages (GPT-6.1 Sol)',
    weekly: NOT_PUBLISHED,
    messages: { model: 'GPT-6.1 Sol', low: 15, high: 160 },
    note: 'estimated local messages per five-hour window; weekly limits may also apply',
    sources: OPENAI_SOURCES,
  },
  'chatgpt-pro': {
    label: 'ChatGPT Pro (100, 200, 500)',
    family: 'chatgpt',
    fiveHour: 'no five-hour limit',
    weekly: NOT_PUBLISHED,
    note: 'a weekly allowance exists; no number is published',
    sources: OPENAI_SOURCES,
  },
  api: { label: 'API (pay per token)', family: 'api', fiveHour: 'no plan limit', weekly: 'no plan limit', note: 'billed per token at the prices above', sources: [source(CLAUDE_PRICING), source(OPENAI_PRICING)] },
  unknown: { label: 'Plan not set', family: 'unknown', fiveHour: NOT_PUBLISHED, weekly: NOT_PUBLISHED, note: 'set plan in config/student.yml to see a plan line', sources: [...CLAUDE_SOURCES.slice(-1), OPENAI_SOURCES[1]] },
});

const POINTERS = { claude: 'read your share in /usage', chatgpt: 'read your share in /status', unknown: 'read your share in /usage (Claude Code) or /status (Codex)' };
const num = (n) => n.toLocaleString('en-US');
const pct = (n) => String(Number(n.toFixed(1)));

// Calls, tokens and dollars for `rows` sent in chunks of CHUNK_ROWS. Premium prices claude counts at opus rates with the
// standard-tier token counts: only the standard tier was measured.
export function estimateUsage({ agent, rows, spendTier = 'standard' }) {
  if (!Number.isInteger(rows) || rows < 0) throw new Error(`rows must be a whole number of 0 or more, got ${rows}`);
  const m = MEASURED[agent];
  if (!m) throw new Error(`unknown agent "${agent}"`);
  const calls = Math.ceil(rows / CHUNK_ROWS);
  const inputTokens = calls * m.fixedInput + rows * m.inputPerRow;
  const outputTokens = rows * m.outputPerRow;
  const model = agent === 'codex' ? 'gpt-6.1-sol' : spendTier === 'premium' ? 'opus' : 'sonnet';
  const price = PRICES[model];
  return { calls, inputTokens, outputTokens, usd: (inputTokens * price.input + outputTokens * price.output) / 1e6, model };
}

// A percent only for ChatGPT Plus, the one plan with a published range. One chunk counted as one message is a lower
// bound: a 20-row chunk is larger than a typical message. Every other plan says 'not published' with what is published.
export function planShare({ plan = 'unknown', calls }) {
  const p = PLANS[plan];
  if (!p) throw new Error(`unknown plan "${plan}"`);
  if (plan === 'chatgpt-plus') {
    const { low, high } = p.messages;
    return `at least ${pct((calls / high) * 100)}-${pct((calls / low) * 100)}% of one 5-hour window (lower bound: one chunk counted as one message)`;
  }
  if (plan === 'api') return 'billed per token, no plan share';
  const pointer = POINTERS[p.family];
  if (plan === 'unknown') return `plan not set; ${pointer}`;
  const published = plan === 'claude-pro' ? 'a five-hour and a weekly limit exist' : plan === 'chatgpt-pro' ? 'no five-hour limit, weekly allowance has no number' : `5-hour ${p.fiveHour}, weekly ${p.weekly}`;
  return `${NOT_PUBLISHED} (${published}); ${pointer}`;
}

// One line that begins 'estimate:'. The dollars use the base input rate with no cache discount, so they are an upper bound.
export function formatCostLine({ agent, plan = 'unknown', rows, spendTier = 'standard', calibration = null }) {
  const u = estimateUsage({ agent, rows, spendTier });
  const parts = [
    `estimate: ${num(rows)} row${rows === 1 ? '' : 's'} in ${num(u.calls)} call${u.calls === 1 ? '' : 's'}`,
    `${num(u.inputTokens)} input and ${num(u.outputTokens)} output tokens`,
    `about $${u.usd.toFixed(2)} API-equivalent at ${PRICES[u.model].label} base rates, no cache discount`,
    planShare({ plan, calls: u.calls }),
  ];
  if (calibration) parts.push(`your own measurement: about ${pct((calibration.pctPer100Rows * rows) / 100)}% of your ${calibration.window === 'weekly' ? 'weekly limit' : '5-hour window'}`);
  if (spendTier === 'premium') parts.push('tokens measured at the standard tier');
  return parts.join('; ');
}
