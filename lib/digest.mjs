// The daily digest's summary, built by plain code: what was applied, outreach sent this week, replies waiting, missed
// runs, steps waiting for Chrome, the day's token estimate, the Sunday skill-gap list, and the guided footer. No model
// writes any of it (an optional one-line AI summary is the P5 lever T9).
import { guidedFooter, nextStep } from './next-step.mjs';

const num = (n) => Number(n).toLocaleString('en-US');

// Next / Type / Why for the digest. Approved applications that wait for Chrome come first: with chrome_in_schedule no the
// schedule never reaches Chrome, so the offer is to submit them in a session; with yes the automation Chrome was closed.
// Approved applications whose form was never read (fillWaiting) come next: the autopilot submits only plans that carry the
// form's fields, so those are filled and submitted in a session.
function nextFor(state) {
  const waiting = state.waitingChrome?.length > 0;
  const approved = state.approvedWaiting ?? 0;
  if (waiting && approved && state.chromeInSchedule === 'no') {
    return { step: `submit the ${approved} approved application(s) in a session`, prompt: 'submit all', why: 'the schedule does not reach Chrome (chrome_in_schedule is no). I can submit them in a session, approve?' };
  }
  if (state.fillWaiting) {
    return { step: `fill and submit the ${state.fillWaiting} approved application(s) in a session`, prompt: 'submit all', why: 'the autopilot submits only forms it has read, and no form was read for these. I\'ll fill each form first, approve?' };
  }
  const setup = { installed: true, interview: true, resume: true, chrome: !waiting || state.chromeInSchedule === 'no', signins: { LinkedIn: true, Gmail: true, Handshake: true }, schedule: true };
  return nextStep({ setup, pipeline: { batchesWaiting: state.batchesWaiting ?? 0, repliesToAnswer: state.replies ?? 0 } });
}

// The guided footer of the digest (or of the autopilot section that ends it), from the same state summaryLines takes.
export const footerLines = (state = {}) => guidedFooter(nextFor(state));

function waitingLine(state) {
  const steps = state.waitingChrome.join(', ');
  if (state.chromeInSchedule === 'no') return `- waiting for Chrome: ${steps}; the schedule does not reach Chrome (chrome_in_schedule is no), so I can run them in a session, approve?`;
  return `- waiting for Chrome: ${steps}; open it with node student/scripts/chrome.mjs open and these run next`;
}

// state = { applied, outreach: { total, connects, messages, emails, connectLimit }, replies, missed, waitingChrome,
//           chromeInSchedule, approvedWaiting, fillWaiting, estimate: { tokens, agent }, skillGaps, sunday, batchesWaiting }; every key
//           is optional, so {} renders an empty day with its token-estimate line and guided footer.
export function summaryLines(state = {}) {
  const lines = ['## Today', `- applied: ${state.applied ?? 0}`];
  const o = state.outreach;
  if (o) lines.push(`- outreach sent this week: ${o.total} (connects ${o.connects} of ${o.connectLimit}, messages ${o.messages}, emails ${o.emails})`);
  lines.push(`- replies to answer: ${state.replies ?? 0}`);
  if (state.missed) lines.push(`- ${state.missed}`);
  if (state.waitingChrome?.length) lines.push(waitingLine(state));
  if (state.estimate) lines.push(`- tokens today (an estimate): about ${num(state.estimate.tokens)} tokens with ${state.estimate.agent}`);
  else lines.push('- tokens today (an estimate): 0 tokens counted; not estimated yet, so nothing is measured for today');
  if (state.sunday) {
    lines.push('', '## Skill gaps this week');
    if (!state.skillGaps?.length) lines.push('- none: no requirement showed up in 3 or more matched postings without being on your resume');
    for (const g of state.skillGaps ?? []) lines.push(`- ${g.phrase} (in ${g.postings} matched postings): ${g.suggestion}`);
  }
  lines.push('', ...footerLines(state), '');
  return lines;
}
