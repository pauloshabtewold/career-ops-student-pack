// The guided message pattern every student-facing message ends with: Next (the step), Type (the exact short prompt),
// Why, then that the student can always ask for more and can just ask and approve. Computed from state by plain code,
// so plain scripts (setup flow, batch file, digest) print it with zero model calls.

export const SIGN_IN_SITES = Object.freeze(['LinkedIn', 'Gmail', 'Handshake']);

const step = (s, prompt, why) => ({ step: s, prompt, why });

// setup: { installed, interview, resume, chrome, signins: { LinkedIn, Gmail, Handshake }, schedule }
// pipeline: { batchesWaiting, unknownQuestions, finishYourself, repliesToAnswer, pendingRows }
export function nextStep({ setup = {}, pipeline = {} } = {}) {
  if (!setup.installed) return step('install the pack', 'install the student pack', 'everything else runs from the installed pack.');
  if (!setup.interview) return step('answer the setup interview', 'start my setup interview', 'your answers decide which jobs are found and how applications are filled.');
  if (!setup.resume) return step('build your resume from the template', 'build my resume', 'one ATS-safe resume is the base of every application.');
  if (!setup.chrome) return step('open the automation Chrome', 'open my automation Chrome', 'applications, Gmail and LinkedIn run in that one window.');
  const missing = SIGN_IN_SITES.filter((s) => !setup.signins?.[s]);
  if (missing.length) return step(`sign in to ${missing.join(', ')} in the automation Chrome`, `I signed in to ${missing.join(' and ')}`, 'sign-ins are yours; the pack never types a password.');
  if (!setup.schedule) return step('turn on the daily schedule', 'turn on my daily schedule', 'the schedule finds jobs and prepares batches while you are away.');
  if (pipeline.unknownQuestions) return step(`answer ${pipeline.unknownQuestions} new application question(s)`, 'show my unanswered questions', 'each answer is saved once and fills every later form.');
  if (pipeline.batchesWaiting) return step('approve the waiting batch', 'show my batch', 'nothing is submitted or sent until you approve it.');
  if (pipeline.finishYourself) return step(`finish ${pipeline.finishYourself} application(s) with a CAPTCHA`, 'show my finish-yourself list', 'CAPTCHAs stay with you; the links go straight to each form.');
  if (pipeline.repliesToAnswer) return step('answer outreach replies', 'show my replies', 'a quick reply keeps a warm contact warm.');
  return step('check today\'s digest', 'show my digest', 'it lists what was applied, sent and found today.');
}

// Four-part footer for student-facing messages: Next, Type, Why, plus the can-ask-for-more lines.
export function guidedFooter(next) {
  return [`Next: ${next.step}`, `Type: ${next.prompt}`, `Why: ${next.why}`, 'You can always ask me for more.', 'Just ask and approve.'];
}

// Instruction text that makes an agent end every message with the guided footer.
export function patternRule() {
  return 'Guided messages: end every message with Next, Type and Why lines, say the student can always ask for more and can just ask and approve, word actions as "I\'ll do X, approve?" and ask the student to act only for sign-ins or CAPTCHAs.';
}
