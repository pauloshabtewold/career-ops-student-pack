// Stub for the M-003 tests; the implementation replaces it.
export const EEO_KEYS = Object.freeze(['gender', 'race_ethnicity', 'hispanic_latino', 'veteran', 'disability', 'pronouns']);
export const CANONICAL_KEYS = Object.freeze(['work_authorization', 'requires_sponsorship', 'start_date', 'relocation', 'how_did_you_hear', ...EEO_KEYS.map((k) => `eeo.${k}`)]);
export class ProfileParseError extends Error {}
export class ProfileAnswerError extends Error {}
export function readProfileAnswers(root) {
  return {};
}
export function mergeProfileAnswers(text, patch) {
  return '';
}
export function needsConfirmation(answers) {
  return [];
}
export function validateAnswer(key, value) {
  return undefined;
}
export const patchFor = (key, value) => ({});
