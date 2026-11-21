// Text-layer checks on a resume PDF that ATS parsers trip over: sections read out of order, a line break inside a
// sentence, a word split by a stray space, two words run together, hyphenated tokens or date ranges broken across lines, and a source laid out
// in more than one column. Each problem names
// its check so check-resume and fill-plan can say which one failed.

const flat = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const lower = (s) => flat(s).toLowerCase();

// Section headings must appear in the PDF text in the same order as in the HTML.
export function readingOrder(pdfText, sections) {
  const text = lower(pdfText);
  let at = -1;
  for (const name of sections) {
    const i = text.indexOf(name.toLowerCase(), at + 1);
    if (i < 0) return [`reading-order: section ${name} is missing from the text layer`];
    if (i < at) return [`reading-order: section ${name} reads out of order`];
    at = i;
  }
  return [];
}

// A sentence-length line (4+ words) that ends without punctuation, followed by a line that opens with a lowercase word,
// is one sentence broken in two. Names, headings and contact lines are too short or open with an address, not a word.
export function midSentenceBreaks(pdfText) {
  const lines = String(pdfText ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  const out = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    const sentence = lines[i].split(/\s+/).length >= 4 && /[a-z,]$/.test(lines[i]);
    if (sentence && /^[a-z]+[\s,]/.test(lines[i + 1])) out.push(`line-break: "${lines[i].slice(-30)}" / "${lines[i + 1].slice(0, 30)}"`);
  }
  return out.slice(0, 3);
}

const tokensOf = (text) => lower(text).replace(/[^a-z0-9+#.\s-]/g, ' ').split(/\s+/).map((t) => t.replace(/^[.-]+|[.-]+$/g, '')).filter(Boolean);

// Source words of 6+ letters that show up only as two pieces with a space between them; returns the source words.
export function splitWords(pdfText, sourceWords) {
  const text = ` ${tokensOf(pdfText).join(' ')} `;
  const out = new Set();
  for (const w of new Set(sourceWords.map((x) => String(x).toLowerCase()).filter((x) => x.length >= 6))) {
    if (text.includes(` ${w} `)) continue;
    for (let k = 2; k <= w.length - 2; k++) {
      if (text.includes(` ${w.slice(0, k)} ${w.slice(k)} `)) {
        out.add(w);
        break;
      }
    }
  }
  return [...out].slice(0, 3);
}

// Two neighbouring source words that the text layer runs together as one token ("dashboardswith"); returns the glued
// tokens. A pair that the source itself also writes as one word is not reported.
export function gluedWords(pdfText, sourceWords) {
  const tokens = new Set(tokensOf(pdfText));
  const words = sourceWords.map((x) => String(x).toLowerCase());
  const single = new Set(words);
  const out = new Set();
  for (let i = 0; i + 1 < words.length; i++) {
    const glued = `${words[i]}${words[i + 1]}`;
    if (tokens.has(glued) && !single.has(glued)) out.add(glued);
  }
  return [...out].slice(0, 3);
}

// Hyphenated tokens (full-stack, 2022-2024, Jan-May) from the visible source text must not reach the text layer broken
// around the hyphen ("2022-" at a line end and "2024" on the next). A token the layer lacks entirely is not reported here.
// Returns the broken tokens as the source writes them.
export function brokenHyphenTokens(pdfText, sourceText) {
  const text = String(pdfText ?? '');
  const visible = String(sourceText ?? '').replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
  const tokens = new Set(visible.match(/\b[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+\b/g) ?? []);
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const broken = [...tokens].filter((t) => new RegExp(t.split('-').map(esc).join('(?:\\s+-\\s*|\\s*-\\s+)')).test(text));
  return broken.slice(0, 3);
}

// Layout a parser reads across instead of down: CSS columns, a grid with two or more tracks, floats, or a table. The text
// layer of such a page can keep headings in order while interleaving the two columns' lines, so the source is checked.
// Track count of one grid-template-columns value: repeat(n, ...) counts n tracks (auto-fill and auto-fit count as many),
// and every other top-level word is one track.
function gridTracks(value) {
  let n = 0;
  for (const m of String(value).matchAll(/repeat\(\s*([^,]+),[^)]*\)|\S+\([^)]*\)|\S+/gi)) {
    if (m[1] !== undefined) n += /^\d+$/.test(m[1].trim()) ? Number(m[1].trim()) : 2;
    else n += 1;
  }
  return n;
}

const MULTI_COLUMN = [
  [(css) => /column-count\s*:\s*[2-9]|(^|[\s;{])columns\s*:\s*[2-9]/i.test(css), 'CSS columns'],
  [(css) => [...css.matchAll(/grid-template-columns\s*:\s*([^;"}]+)/gi)].some((m) => gridTracks(m[1].replace(/!important/i, '').trim()) >= 2), 'a grid with two or more columns'],
  [(css) => /float\s*:\s*(left|right)/i.test(css), 'a float'],
  [(css) => /<table\b/i.test(css), 'a table'],
];

// One message per multi-column layout construct found in the source; empty when single column.
export function singleColumn(sourceText) {
  const css = String(sourceText ?? '');
  return MULTI_COLUMN.filter(([found]) => found(css)).map(([, what]) => `single-column: the source lays text out with ${what}; use one column`);
}

// All checks at once; sections is the HTML section order, words the source's visible words in reading order. glued false
// skips the pair check for callers that already run check-resume's thresholded glued-words check on the same text.
export function atsTextProblems(pdfText, { sections = [], sourceText = '', words = [], glued = true } = {}) {
  return [
    ...readingOrder(pdfText, sections),
    ...midSentenceBreaks(pdfText),
    ...splitWords(pdfText, words).map((w) => `split-word: "${w}" is split by a space in the text layer`),
    ...(glued ? gluedWords(pdfText, words) : []).map((w) => `glued-words: "${w}" runs two words together in the text layer`),
    ...brokenHyphenTokens(pdfText, sourceText).map((t) => `hyphen-token: "${t}" is broken in the text layer`),
    ...singleColumn(sourceText),
  ];
}

// Section headings in an HTML source rendered from the template, in order.
export function htmlSections(html) {
  return [...String(html ?? '').matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => flat(m[1].replace(/<[^>]+>/g, '')));
}
