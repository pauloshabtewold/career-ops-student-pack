// The guided message pattern every student-facing message ends with: Next (the step), Type (the exact short prompt),
// Why, an Also line for the second thing waiting when there is one, then that the student can always ask for more and
// can just ask and approve. Computed from state by plain code, so plain scripts (setup flow, batch file, digest) print
// it with zero model calls.

export const SIGN_IN_SITES = Object.freeze(['LinkedIn', 'Gmail', 'Handshake']);

const step = (s, prompt, why) => ({ step: s, prompt, why });
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// "3 jobs and 2 messages in 2 waiting batches", or "the 2 waiting batches" when the item counts are not known.
function waitingText({ batchesWaiting, jobsWaiting = 0, messagesWaiting = 0 }) {
  const parts = [jobsWaiting ? plural(jobsWaiting, 'job') : '', messagesWaiting ? plural(messagesWaiting, 'message') : ''].filter(Boolean);
  const batches = batchesWaiting === 1 ? 'the waiting batch' : `${batchesWaiting} waiting batches`;
  return parts.length ? `${parts.join(' and ')} in ${batches}` : batchesWaiting === 1 ? 'the waiting batch' : `the ${batchesWaiting} waiting batches`;
}

// Every pending step in order, each worded as an offer ("I'll ..., approve?") with the exact reply on its Type line.
// setup: { installed, interview, resume, chrome, signins: { LinkedIn, Gmail, Handshake }, schedule }
// pipeline: { batchesWaiting, jobsWaiting, messagesWaiting, unknownQuestions, questions, finishYourself, repliesToAnswer }
export function pendingSteps({ setup = {}, pipeline = {} } = {}) {
  const out = [];
  if (!setup.installed) out.push(step('install the pack', 'install the student pack', "I'll install the pack and check every file, approve? Everything else runs from it."));
  if (!setup.interview) out.push(step('answer the setup interview', 'start my setup interview', "I'll ask the setup questions one at a time, approve? Your answers decide which jobs are found and how forms are filled."));
  if (!setup.resume) out.push(step('build your resume from the template', 'build my resume', "I'll build one ATS-safe resume from cv.md and check it, approve? It is the base of every application."));
  if (!setup.chrome) out.push(step('open the automation Chrome', 'open my automation Chrome', "I'll open the automation Chrome, approve? Applications, Gmail and LinkedIn run in that one window."));
  const missing = SIGN_IN_SITES.filter((s) => !setup.signins?.[s]);
  if (missing.length) out.push(step(`sign in to ${missing.join(', ')} in the automation Chrome`, `I signed in to ${missing.join(' and ')}`, "sign-ins are yours: the pack never types a password. Once you are in, I'll record it and finish setup, approve?"));
  if (!setup.schedule) out.push(step('turn on the daily schedule', 'turn on my daily schedule', "I'll install the daily schedule, approve? It finds jobs and prepares batches while you are away."));
  // chrome_in_schedule is no only because the schedule probe timed out or could not install its job.
  if (setup.chromeProbeUnsure) out.push(step('check again whether your schedule can reach Chrome', "check my schedule's Chrome", "I'll check again whether your schedule can reach Chrome, approve? The last check could not tell, and with a yes the schedule submits approved applications itself."));
  const n = pipeline.unknownQuestions;
  if (n) {
    const first = pipeline.questions?.[0];
    out.push(step(`answer ${plural(n, 'new application question')}${first ? `, first: "${String(first).slice(0, 60)}"` : ''}`, 'show my unanswered questions', "I'll save each answer once and fill every later form with it, approve?"));
  }
  if (pipeline.batchesWaiting) out.push(step(`approve ${waitingText(pipeline)}`, 'show my batch', "I'll show you the page and submit or send only the items you approve, approve? Nothing goes out before that."));
  if (pipeline.finishYourself) out.push(step(`finish ${plural(pipeline.finishYourself, 'application')} with a CAPTCHA`, 'show my finish-yourself list', "CAPTCHAs stay with you. I'll list each direct link so you finish it in one click, approve?"));
  if (pipeline.repliesToAnswer) out.push(step(`answer ${plural(pipeline.repliesToAnswer, 'outreach reply', 'outreach replies')}`, 'show my replies', "I'll draft an answer to each for you to approve, approve? A quick reply keeps a warm contact warm."));
  return out;
}

const DIGEST = step("check today's digest", 'show my digest', "I'll show what was applied, sent and found today, approve?");

// The first pending step, with the second one as its Also line; the digest when nothing waits.
export function nextStep(state = {}) {
  const [first, second] = pendingSteps(state);
  if (!first) return DIGEST;
  return second ? { ...first, also: second.step } : first;
}

// Footer for student-facing messages: Next, Type, Why, an Also line when a second step waits, then the can-ask-for-more
// lines.
export function guidedFooter(next) {
  return [`Next: ${next.step}`, `Type: ${next.prompt}`, `Why: ${next.why}`, ...(next.also ? [`Also: ${next.also}`] : []), 'You can always ask me for more.', 'Just ask and approve.'];
}

// Instruction text that makes an agent end every message with the guided footer.
export function patternRule() {
  return 'Guided messages: end every message with Next, Type and Why lines, say the student can always ask for more and can just ask and approve, word actions as "I\'ll do X, approve?" and ask the student to act only for sign-ins or CAPTCHAs.';
}
