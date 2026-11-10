// Stub for the M-002 tests; the implementation replaces it.
export const MESSAGE_CAP = 40;
export const buildPrompt = ({ epoch, assessmentDomains = [], companies = [], check = false }) => '';
export const buildClaudeArgs = ({ model, settings, shell = false }) => [];
export const buildCodexArgs = ({ tmp, out, effort = 'medium', shell = false }) => [];
export const auditEvents = (agent, stdout) => null;
export const parseAnswer = (text) => null;
export const failureReason = (agent, err) => '';
export async function inboxPass({ paths, config, agent, agentPath, today, deadline = Infinity, check = false, runner, platform = process.platform, now = Date.now, inboxDeps = {} }) {
  return undefined;
}
