// Deterministic clean-up of fetched posting text before it reaches a model prompt or a session read. It removes what a
// person reading the page cannot see (hidden HTML, zero-width, bidi, Unicode tag and other format characters), folds
// look-alike Cyrillic and Greek letters back to Latin inside Latin words so a disguised phrase matches again, and flags
// lines that read as instructions to an AI. No model is involved. The confusable map below is written for this pack.
import { oneLine } from './text.mjs';

const MAX_FLAGS = 3;
const FLAG_CHARS = 80;

// Order matters: bidi and tag ranges are tested before the general format-character class.
const BIDI = /[؜‎‏‪-‮⁦-⁩]/gu;
const TAG = /[\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu;
const ZERO_WIDTH = /[­͏ᅟᅠ឴឵᠎​-‍⁠-⁤ㅤ﻿ﾠ]/gu;
const FORMAT = /\p{Cf}/gu;

// Cyrillic and Greek letters that render like a Latin letter.
const LOOKALIKES = new Map(Object.entries({
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'к': 'k',
  'і': 'i', 'ј': 'j', 'ѕ': 's', 'һ': 'h', 'ԁ': 'd', 'ԛ': 'q', 'ԝ': 'w', 'ӏ': 'l',
  'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O', 'Р': 'P',
  'С': 'C', 'Т': 'T', 'Х': 'X', 'І': 'I', 'Ј': 'J', 'Ѕ': 'S', 'У': 'Y',
  'ο': 'o', 'α': 'a', 'ν': 'v', 'ρ': 'p', 'ι': 'i', 'κ': 'k', 'υ': 'u', 'χ': 'x',
  'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'H', 'Ι': 'I', 'Κ': 'K', 'Μ': 'M',
  'Ν': 'N', 'Ο': 'O', 'Ρ': 'P', 'Τ': 'T', 'Υ': 'Y', 'Χ': 'X',
}));
const WORD = /[\p{L}\p{M}]+/gu;
const isLatin = (ch) => /[A-Za-z]/.test(ch);

function foldWord(word) {
  let latin = 0;
  let mapped = 0;
  for (const ch of word) {
    if (isLatin(ch)) latin++;
    else if (LOOKALIKES.has(ch)) mapped++;
  }
  return { latin, mapped };
}

function foldLookalikes(text) {
  let folded = 0;
  const out = text.replace(WORD, (word) => {
    const { latin, mapped } = foldWord(word);
    if (!mapped || latin <= mapped) return word;
    folded += mapped;
    return [...word].map((ch) => LOOKALIKES.get(ch) ?? ch).join('');
  });
  return { text: out, folded };
}

const strip = (text, re) => {
  let n = 0;
  const out = text.replace(re, () => (n++, ''));
  return { text: out, n };
};

const HIDDEN_STYLE = /display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0(?:\.0+)?\s*(?:px|em|rem|pt|%)?\s*(?:;|!|$)/i;
const OPEN_TAG = /<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

function isHiddenTag(attrs) {
  if (/(?:^|\s)hidden(?=[\s=/]|$)/i.test(attrs.replace(/"[^"]*"|'[^']*'/g, '""'))) return true;
  if (/aria-hidden\s*=\s*["']?true/i.test(attrs)) return true;
  const style = /style\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
  return Boolean(style && HIDDEN_STYLE.test(style[1] ?? style[2]));
}

// End index just past the close tag that matches the element opened at `from` (same-name nesting counted); text length when unclosed.
function elementEnd(text, name, from) {
  const re = new RegExp(`<(/?)${name}\\b(?:"[^"]*"|'[^']*'|[^'">])*>`, 'gi');
  re.lastIndex = from;
  let depth = 1;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return m.index + m[0].length;
  }
  return text.length;
}

function stripHiddenHtml(input) {
  let text = input;
  let n = 0;
  for (const re of [/<!--[\s\S]*?(?:-->|$)/g, /<script\b[\s\S]*?(?:<\/script\s*>|$)/gi, /<style\b[\s\S]*?(?:<\/style\s*>|$)/gi]) {
    const r = strip(text, re);
    text = r.text;
    n += r.n;
  }
  for (let guard = 0; guard < 10000; guard++) {
    OPEN_TAG.lastIndex = 0;
    let hit = null;
    for (let m = OPEN_TAG.exec(text); m && !hit; m = OPEN_TAG.exec(text)) {
      if (isHiddenTag(m[2])) hit = m;
    }
    if (!hit) break;
    const name = hit[1];
    const start = hit.index;
    const end = VOID_TAGS.has(name.toLowerCase()) || hit[0].endsWith('/>') ? start + hit[0].length : elementEnd(text, name, start + hit[0].length);
    text = text.slice(0, start) + text.slice(end);
    n++;
  }
  return { text, n };
}

// Phrases that address an AI rather than describe a job. Each pattern is tested against one line, case-insensitively.
const INSTRUCTION_PATTERNS = [
  /\b(?:ignore|disregard|forget|override|bypass)\b.{0,40}\b(?:previous|prior|above|earlier|preceding|all|any|your|these|the)\b.{0,25}\b(?:instructions?|prompts?|rules?|directions?|guidelines?)\b/i,
  /\byou are (?:now |just |only |actually )?(?:an? )?(?:ai|a\.i\.|llm|chatbot|artificial intelligence|(?:large )?language model|helpful assistant|virtual assistant)\b/i,
  /\byou are (?:now |just |only |actually )?(?:an? )?assistant\s*[.,;:!]?\s*$/i,
  /\b(?:as|being) an? (?:ai|llm|language model)\b/i,
  /\b(?:act|behave|respond|pretend|reply) (?:as|like) (?:if you (?:are|were) )?(?:an? )?(?:ai|assistant|llm|language model|recruiter bot)\b/i,
  /\b(?:rate|score|rank|grade|mark|classify|evaluate|label|triage)\s+(?:this|the|my|that)\s+(?:candidate|posting|job|role|applicant|application|position|listing|resume)\s+(?:as|a|an|at|with|highly|favou?rably|\d)/i,
  /\bgive\s+(?:this|the|my)\s+(?:candidate|posting|job|role|applicant|application)\s+(?:a|an)\s+(?:top|high|perfect|maximum|5|five)/i,
  /\bsystem\s+(?:prompt|message|instructions?)\b/i,
  /\bnew\s+instructions?\s*:/i,
  /<\|?(?:im_start|im_end|system|endoftext)\|?>/i,
  /\b(?:output|reply with|respond with|print|write|emit|return)\b.{0,25}\bTRIAGE\b/i,
  /^\s*TRIAGE\s*:/i,
  /\b(?:reveal|show|print|repeat)\b.{0,20}\b(?:your|the)\b.{0,15}\b(?:prompt|instructions)\b/i,
];

export function detectInstructions(text) {
  const flagged = [];
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (line && INSTRUCTION_PATTERNS.some((re) => re.test(line))) {
      const short = oneLine(line, FLAG_CHARS).replace(/"/g, "'");
      if (!flagged.includes(short)) flagged.push(short);
      if (flagged.length === MAX_FLAGS) break;
    }
  }
  return flagged;
}

export const EMPTY_REMOVED = Object.freeze({ hiddenHtml: 0, zeroWidth: 0, bidi: 0, tagChars: 0, otherFormat: 0, lookalikes: 0 });

// Returns { text, removed: counts by kind, flagged: [short quoted lines] }. Pure and synchronous.
export function guardPosting(input) {
  let text = String(input ?? '');
  const removed = { ...EMPTY_REMOVED };
  ({ text, n: removed.hiddenHtml } = stripHiddenHtml(text));
  ({ text, n: removed.bidi } = strip(text, BIDI));
  ({ text, n: removed.tagChars } = strip(text, TAG));
  ({ text, n: removed.zeroWidth } = strip(text, ZERO_WIDTH));
  ({ text, n: removed.otherFormat } = strip(text, FORMAT));
  text = text.normalize('NFKC');
  ({ text, folded: removed.lookalikes } = foldLookalikes(text));
  return { text, removed, flagged: detectInstructions(text) };
}

export const removedTotal = (removed) => Object.values(removed).reduce((a, b) => a + b, 0);

export function addRemoved(into, removed) {
  for (const k of Object.keys(EMPTY_REMOVED)) into[k] = (into[k] ?? 0) + (removed[k] ?? 0);
  return into;
}

// "hiddenHtml 2, zeroWidth 5": only the kinds that were hit.
export const removedSummary = (removed) => Object.entries(removed).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(', ');
