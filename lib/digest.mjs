// The daily digest's summary, built by plain code: what was applied, outreach sent this week, replies waiting, missed
// runs, steps waiting for Chrome, the day's token estimate, the Sunday skill-gap list, and the guided footer. No model
// writes any of it (an optional one-line AI summary is the P5 lever T9).
import { guidedFooter, nextStep } from './next-step.mjs';

const num = (n) => Number(n).toLocaleString('en-US');

// state = { applied, outreach: { total, connects, messages, emails, connectLimit }, replies, missed, waitingChrome,
//           estimate: { tokens, agent }, skillGaps, sunday, batchesWaiting }; every key is optional, so {} renders an
//           empty day with its guided footer.
export function summaryLines(state = {}) {
  const lines = ['## Today', `- applied: ${state.applied ?? 0}`];
  const o = state.outreach;
  if (o) lines.push(`- outreach sent this week: ${o.total} (connects ${o.connects} of ${o.connectLimit}, messages ${o.messages}, emails ${o.emails})`);
  lines.push(`- replies to answer: ${state.replies ?? 0}`);
  if (state.missed) lines.push(`- ${state.missed}`);
  if (state.waitingChrome?.length) lines.push(`- waiting for Chrome: ${state.waitingChrome.join(', ')}; open it with node student/scripts/chrome.mjs open and these run next`);
  if (state.estimate) lines.push(`- tokens today (an estimate): about ${num(state.estimate.tokens)} tokens with ${state.estimate.agent}`);
  if (state.sunday) {
    lines.push('', '## Skill gaps this week');
    if (!state.skillGaps?.length) lines.push('- none: no requirement showed up in 3 or more matched postings without being on your resume');
    for (const g of state.skillGaps ?? []) lines.push(`- ${g.phrase} (in ${g.postings} matched postings): ${g.suggestion}`);
  }
  const setup = { installed: true, interview: true, resume: true, chrome: !state.waitingChrome?.length, signins: { LinkedIn: true, Gmail: true, Handshake: true }, schedule: true };
  const next = nextStep({ setup, pipeline: { batchesWaiting: state.batchesWaiting ?? 0, repliesToAnswer: state.replies ?? 0 } });
  lines.push('', ...guidedFooter(next), '');
  return lines;
}
