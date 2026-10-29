// data/pipeline.md model. Untouched lines are kept verbatim so serialize(parse(x)) === x,
// because upstream scripts also write this file and a reformat would show up as churn in their diffs.

export const SECTION_ORDER = Object.freeze(['Pending', 'Flagged', 'Skipped', 'Processed']);

export function parsePipeline(text) {
  const lines = text.split('\n');
  const blocks = [{ kind: 'preamble', name: null, heading: null, lines: [] }];
  for (const line of lines) {
    const m = /^## (.+?)\s*$/.exec(line);
    if (m) blocks.push({ kind: 'section', name: m[1].trim(), heading: line, lines: [] });
    else blocks[blocks.length - 1].lines.push(line);
  }
  return { blocks };
}

export function serializePipeline(doc) {
  const out = [];
  for (const b of doc.blocks) {
    if (b.heading !== null) out.push(b.heading);
    out.push(...b.lines);
  }
  return out.join('\n');
}

export function getSection(doc, name) {
  return doc.blocks.find((b) => b.kind === 'section' && b.name === name) ?? null;
}

// Adds missing headings in SECTION_ORDER directly after the nearest present predecessor.
export function ensureSections(doc, names = SECTION_ORDER) {
  names.forEach((name, i) => {
    if (getSection(doc, name)) return;
    const fresh = { kind: 'section', name, heading: `## ${name}`, lines: [''] };
    let at = -1;
    for (let j = i - 1; j >= 0 && at === -1; j--) {
      const idx = doc.blocks.findIndex((b) => b.kind === 'section' && b.name === names[j]);
      if (idx !== -1) at = idx + 1;
    }
    if (at === -1) {
      const first = doc.blocks.findIndex((b) => b.kind === 'section');
      at = first === -1 ? doc.blocks.length : first;
    }
    doc.blocks.splice(at, 0, fresh);
  });
  return doc;
}

// Every note as a [key, value] pair in order, value null for a bare key. A key may repeat; parseNotes collapses repeats
// to the last value, so a caller that must choose between duplicates reads the pairs instead.
export function noteEntries(noteText) {
  const entries = [];
  for (const part of noteText.split(';')) {
    const tok = part.trim();
    if (!tok) continue;
    const eq = tok.indexOf('=');
    if (eq === -1) entries.push([tok, null]);
    else entries.push([tok.slice(0, eq).trim(), tok.slice(eq + 1).trim()]);
  }
  return entries;
}

export function parseNotes(noteText) {
  return new Map(noteEntries(noteText));
}

export function formatNotes(notes) {
  return [...notes].map(([k, v]) => (v === null ? k : `${k}=${v}`)).join('; ');
}

// Row line split into its match, plain cells and note text (null without a note cell); null for a line that is not a row.
// parseRow and rowNoteEntries share it so both find the note cell the same way.
function splitRow(line) {
  const m = /^(- )?(?:\[([ xX])\] )?(.*)$/.exec(line);
  if (!m || !/^https?:\/\//.test(m[3])) return null;
  const cells = m[3].split(' | ');
  let noteText = null;
  if (cells.length > 4 && /^note:/.test(cells[cells.length - 1])) {
    noteText = cells.pop().replace(/^note:\s*/, '');
  }
  return { m, cells, noteText };
}

// '- [ ] url | company | title | location | ...extra | note: k=v; k=v'; Flagged and Skipped rows may lack the checkbox.
export function parseRow(line) {
  const split = splitRow(line);
  if (!split) return null;
  const { m, cells, noteText } = split;
  const notes = noteText === null ? new Map() : parseNotes(noteText);
  const [url = '', company = '', title = '', location = '', ...extra] = cells;
  return { bullet: m[1] !== undefined, checkbox: m[2] ?? null, url, company, title, location, extra, notes };
}

// The row's note pairs with duplicate keys kept; [] for a non-row line or a row without a note cell.
export function rowNoteEntries(line) {
  const split = splitRow(line);
  return split && split.noteText !== null ? noteEntries(split.noteText) : [];
}

export function formatRow(row) {
  const cells = [row.url, row.company, row.title, row.location, ...(row.extra || [])];
  if (row.notes && row.notes.size) cells.push(`note: ${formatNotes(row.notes)}`);
  const box = row.checkbox === null || row.checkbox === undefined ? '' : `[${row.checkbox}] `;
  return `${row.bullet === false ? '' : '- '}${box}${cells.join(' | ')}`;
}

// Rows of a section as { index, line, row } so callers can rewrite a line in place.
export function sectionRows(doc, name) {
  const sec = getSection(doc, name);
  if (!sec) return [];
  const out = [];
  sec.lines.forEach((line, index) => {
    const row = parseRow(line);
    if (row) out.push({ index, line, row });
  });
  return out;
}

// Appends row lines after the last non-blank line of a section, keeping its trailing blank spacing.
export function appendLines(doc, name, newLines) {
  const sec = getSection(doc, name);
  if (!sec) throw new Error(`pipeline.md has no "## ${name}" section`);
  if (!newLines.length) return doc;
  let end = sec.lines.length;
  while (end > 0 && sec.lines[end - 1].trim() === '') end--;
  // An empty section keeps its blank line under the heading.
  if (end === 0 && sec.lines.length) end = 1;
  sec.lines.splice(end, 0, ...newLines);
  const isLast = doc.blocks[doc.blocks.length - 1] === sec;
  if (!isLast && sec.lines[sec.lines.length - 1].trim() !== '') sec.lines.push('');
  return doc;
}
