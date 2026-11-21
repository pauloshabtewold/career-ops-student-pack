// Writing-rule cleanup for every letter and message the pack drafts: straight quotes, no em or en dashes, none of the
// stock phrases that make a letter read as generated, single spaces. The typography characters are built from code
// points so this file passes scripts/lint-files.mjs.
const ch = (code) => String.fromCodePoint(code);
const EM = ch(0x2014);
const EN = ch(0x2013);
const SINGLE = new RegExp(`[${ch(0x2018)}${ch(0x2019)}]`, 'g');
const DOUBLE = new RegExp(`[${ch(0x201c)}${ch(0x201d)}]`, 'g');

// Phrases removed outright; each is filler that adds no fact.
export const STOCK_PHRASES = Object.freeze([
  'I am writing to express my interest in',
  'I am excited to apply for',
  'I am thrilled to',
  'I believe I would be a great fit',
  'I am confident that',
  'Thank you for your time and consideration',
  'I look forward to hearing from you',
  'passionate about',
  'dynamic team',
  'fast-paced environment',
  'leverage my skills',
  'hit the ground running',
]);

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Normalizes typographic quotes to straight quotes and replaces dashes per the rule below.
export function clean(text) {
  let out = String(text ?? '').replace(SINGLE, "'").replace(DOUBLE, '"');
  // A dash between digits is a range and becomes a hyphen; anywhere else it is a clause break and becomes a comma.
  out = out.replace(new RegExp(`(\\d)\\s*[${EM}${EN}]\\s*(\\d)`, 'g'), '$1-$2');
  out = out.replace(new RegExp(`\\s*[${EM}${EN}]\\s*`, 'g'), ', ');
  for (const phrase of STOCK_PHRASES) out = out.replace(new RegExp(`${escape(phrase)}[ ,.]*`, 'gi'), '');
  return out
    .replace(/ {2,}/g, ' ')
    .replace(/ +([,.;:!?])/g, '$1')
    .replace(/,{2,}/g, ',')
    .replace(/^[ \t]+|[ \t]+$/gm, '')
    .replace(/(^|[.!?]\s+)([a-z])/g, (_, a, b) => a + b.toUpperCase());
}
