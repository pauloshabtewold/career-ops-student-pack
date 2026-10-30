// Builds AGENTS.override.md, the file Codex reads in place of AGENTS.md. Codex loads only the first
// project_doc_max_bytes of it (32 KiB by default) and upstream's AGENTS.md alone is larger than that, so the pack block
// comes first and a verbatim copy of upstream's text follows. The file is generated between markers so a refresh can
// replace each block and leave any text a student added around them.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Codex truncates at 32 KiB; the pack block has to stay far enough below that for the header and the markers to fit.
export const PACK_BLOCK_LIMIT = 8192;

const PACK_START = '<!-- student-pack:start -->';
const PACK_END = '<!-- student-pack:end -->';
const UPSTREAM_START = '<!-- career-ops-agents:start -->';
const UPSTREAM_END = '<!-- career-ops-agents:end -->';

const HEADER = [
  'This file is generated. Edit student/AGENTS.student.md instead.',
  'Codex reads this file in place of AGENTS.md. The career-ops rules follow below; if they look cut short, read AGENTS.md in this folder in full before acting.',
].join('\n');

const LINES = {
  unmarked: 'AGENTS.override.md has no student-pack markers; left as is, so Codex will not see the pack rules',
  damaged: 'AGENTS.override.md has damaged student-pack markers; delete it and run node student/install.mjs',
};

export function packBlock(packText) {
  return `${PACK_START}\n${HEADER}\n\n${String(packText).trimEnd()}\n${PACK_END}`;
}

function upstreamBlock(upstreamText) {
  return `${UPSTREAM_START}${upstreamText}${UPSTREAM_END}`;
}

function indexesOf(text, marker) {
  const found = [];
  for (let at = text.indexOf(marker); at !== -1; at = text.indexOf(marker, at + marker.length)) found.push(at);
  return found;
}

// 'none' without markers, 'ok' for exactly one start before exactly one end, 'bad' for anything else (duplicated,
// reversed or unpaired), because replacing in place would delete text between the wrong markers.
function locate(text, start, end) {
  const starts = indexesOf(text, start);
  const ends = indexesOf(text, end);
  if (!starts.length && !ends.length) return { state: 'none' };
  if (starts.length !== 1 || ends.length !== 1 || starts[0] > ends[0]) return { state: 'bad' };
  return { state: 'ok', from: starts[0], to: ends[0] + end.length };
}

// Pure: returns the file text and what happened. Text outside the two blocks is kept; text that sits before the pack
// block moves behind the upstream block, because the pack block must start at byte 0 to survive Codex's size cut.
export function buildOverride({ packText, upstreamText = '', existing = '' }) {
  const pack = packBlock(packText);
  const upstream = upstreamBlock(upstreamText);
  if (!existing.trim()) return { text: `${pack}\n\n${upstream}\n`, status: 'created' };

  const p = locate(existing, PACK_START, PACK_END);
  const u = locate(existing, UPSTREAM_START, UPSTREAM_END);
  const nested = p.state === 'ok' && u.state === 'ok' && u.from < p.to;
  if (p.state === 'bad' || u.state === 'bad' || nested) return { text: existing, status: 'damaged' };
  if (p.state === 'none') return { text: existing, status: 'unmarked' };

  const lead = existing.slice(0, p.from);
  let text;
  if (u.state === 'ok') text = `${pack}${existing.slice(p.to, u.from)}${upstream}${existing.slice(u.to)}`;
  else text = `${pack}\n\n${upstream}${existing.slice(p.to) || '\n'}`;
  if (lead.trim()) text = `${text.trimEnd()}\n\n${lead.trim()}\n`;
  return { text, status: text === existing ? 'unchanged' : 'updated' };
}

// Reads <root>/AGENTS.md and <packRoot>/AGENTS.student.md, and writes <root>/AGENTS.override.md only when the text
// differs. Write errors propagate: the caller decides how loudly an unwritable folder is reported.
export function refreshOverride({ root, packRoot, dryRun = false, write = writeFileSync }) {
  const file = join(root, 'AGENTS.override.md');
  const upstreamFile = join(root, 'AGENTS.md');
  const upstreamText = existsSync(upstreamFile) ? readFileSync(upstreamFile, 'utf8') : '';
  const packText = readFileSync(join(packRoot, 'AGENTS.student.md'), 'utf8');
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const { text, status } = buildOverride({ packText, upstreamText, existing });
  if (!dryRun && (status === 'created' || status === 'updated')) write(file, text);
  return { status, line: LINES[status] ?? '' };
}
