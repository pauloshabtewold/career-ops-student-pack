// Stub: measured token counts, plan data and the cost line. Bodies arrive with the implementation.
export const ACCESS_DATE = '2026-10-30';
export const MEASURED = Object.freeze({});
export const PRICES = Object.freeze({});
export const PLAN_IDS = Object.freeze(['claude-pro', 'claude-max', 'claude-ultra', 'chatgpt-plus', 'chatgpt-pro', 'api', 'unknown']);
export const PLANS = Object.freeze({});
const todo = () => {
  throw new Error('not implemented');
};
export function estimateUsage({ agent, rows, spendTier = 'standard' }) {
  return todo(agent, rows, spendTier);
}
export function planShare({ plan = 'unknown', calls }) {
  return todo(plan, calls);
}
export function formatCostLine({ agent, plan = 'unknown', rows, spendTier = 'standard', calibration = null }) {
  return todo(agent, plan, rows, spendTier, calibration);
}
