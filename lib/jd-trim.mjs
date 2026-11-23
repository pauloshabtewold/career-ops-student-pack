// Job-text trim for triage prompts (lever jd_trim): keeps the sections a fit judgment needs (requirements,
// qualifications, eligibility, location, compensation) up to a word budget, and falls back to the first N characters
// when the posting has no recognizable section headings.

export const DEFAULT_WORDS = 300;
export const FALLBACK_CHARS = 2000;
const KEEP = /^(?:#+\s*)?(requirements?|qualifications?|minimum qualifications|basic qualifications|preferred qualifications|what you('| wi)ll need|who you are|eligibility|education|location|work (location|arrangement)|compensation|salary|pay( range)?|benefits)\b/i;
const HEADING = /^(?:#+\s*)?[A-Z][A-Za-z'/ &-]{2,60}:?\s*$/;

// Cuts job text to the kept sections, at most `words` words; fallbackChars caps the text of a posting with no kept section.
export function trimJobText(text, { words = DEFAULT_WORDS, fallbackChars = FALLBACK_CHARS } = {}) {
  const lines = String(text ?? '').split('\n');
  const kept = [];
  let keeping = false;
  for (const line of lines) {
    const t = line.trim();
    if (KEEP.test(t)) keeping = true;
    else if (HEADING.test(t)) keeping = false;
    if (keeping && t) kept.push(t);
  }
  if (!kept.length) return String(text ?? '').slice(0, fallbackChars);
  const out = kept.join('\n').split(/\s+/);
  return out.length > words ? `${out.slice(0, words).join(' ')} ...` : kept.join('\n');
}
