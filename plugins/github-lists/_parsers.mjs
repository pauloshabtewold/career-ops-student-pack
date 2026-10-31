// Parsers for the public job-list formats. Each returns { rows, parseErrors } where a row is
// { company, title, location, date, url, kind }. Columns are mapped by header name, never by position,
// because list repos reorder and add columns without notice.

const REL = /^(\d+)\s*(mo|w|d|h|m|y)$/i;
const REL_DAYS = { mo: 30, w: 7, d: 1, h: 0, m: 0, y: 365 };
const CONTINUATION = new Set(['\u21b3', '']);

export function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

export function textOf(cell) {
  return decodeEntities(String(cell).replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]+>/g, '').replace(/\*\*/g, '')).replace(/\s+/g, ' ').trim();
}

// '3d' and '2mo' become an ISO date; anything else ('Oct 18') is returned unchanged.
export function absDate(raw, today) {
  const text = raw.trim();
  const m = REL.exec(text);
  if (!m || !today) return text;
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - Number(m[1]) * REL_DAYS[m[2].toLowerCase()]);
  return d.toISOString().slice(0, 10);
}

const HEADER_KEYS = {
  company: ['company', 'company name'],
  title: ['role', 'position', 'title', 'job title'],
  location: ['location', 'locations'],
  link: ['application/link', 'posting', 'apply', 'link', 'application'],
  date: ['date posted', 'age', 'posted', 'date'],
};

function columnMap(headers) {
  const col = {};
  headers.forEach((h, i) => {
    for (const [key, names] of Object.entries(HEADER_KEYS)) if (names.includes(h) && col[key] === undefined) col[key] = i;
  });
  return col;
}

const isAggregatorHref = (u) => /(^|\.)(simplify\.jobs|jobright\.ai|zapply\.jobs|trylitos\.com)$/i.test(hostname(u));

function hostname(u) {
  try {
    return new URL(u).hostname;
  } catch {
    return '';
  }
}

// First employer link wins; a cell with only aggregator links falls back to the first of them.
function firstLink(cell) {
  const urls = [...cell.matchAll(/href="([^"]+)"/gi)].map((m) => decodeEntities(m[1]));
  urls.push(...[...cell.matchAll(/\]\((https?:[^)\s]+)\)/g)].map((m) => m[1]));
  return urls.find((u) => /^https?:/i.test(u) && !isAggregatorHref(u)) ?? urls.find((u) => /^https?:/i.test(u)) ?? null;
}

function cleanLocation(cell) {
  return decodeEntities(
    cell
      .replace(/<details>\s*<summary>.*?<\/summary>/gis, '')
      .replace(/<\s*\/?\s*br\s*\/?\s*>/gi, ' / ')
      .replace(/<[^>]+>/g, '')
      .replace(/\*\*/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function buildRows(tables, kind, today) {
  const rows = [];
  let parseErrors = 0;
  for (const { headers, cells } of tables) {
    const col = columnMap(headers);
    if (col.company === undefined || col.title === undefined) continue;
    // Lists with no link column (jobright) put the posting link in the title cell.
    const linkCol = col.link ?? col.title;
    let prevCompany = '';
    for (const row of cells) {
      if (row.length !== headers.length) {
        parseErrors++;
        continue;
      }
      let company = textOf(row[col.company]);
      if (CONTINUATION.has(company)) company = prevCompany;
      else prevCompany = company;
      const cellLink = row[linkCol];
      // Lock and closed markers mean the posting takes no applications. Without a link column the link cell is the title,
      // where "closed" is ordinary text ("Closed-Loop Controls"), so only the lock emoji counts there.
      const closedMark = col.link === undefined ? /\u{1F512}/u : /\u{1F512}|closed/iu;
      if (closedMark.test(cellLink) || /\u{1F512}/u.test(row[col.title])) continue;
      const url = firstLink(cellLink);
      if (!url || !company) continue;
      rows.push({
        company,
        title: textOf(row[col.title]),
        location: col.location === undefined ? '' : cleanLocation(row[col.location]),
        date: col.date === undefined ? '' : absDate(textOf(row[col.date]), today),
        url,
        kind,
      });
    }
  }
  return { rows, parseErrors };
}

export function parseMarkdownTable(text, { kind, today } = {}) {
  const lines = text.split(/\r?\n/);
  const split = (line) => {
    let cells = line.trim().split(/(?<!\\)\|/);
    if (cells[0].trim() === '') cells = cells.slice(1);
    if (cells.length && cells[cells.length - 1].trim() === '') cells = cells.slice(0, -1);
    return cells.map((c) => c.replace(/\\\|/g, '|').trim());
  };
  const tables = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].trimStart().startsWith('|') || !/^\s*\|[\s:\-|]+\|\s*$/.test(lines[i + 1])) continue;
    const headers = split(lines[i]).map((h) => textOf(h).toLowerCase());
    const cells = [];
    i += 2;
    while (i < lines.length && lines[i].trimStart().startsWith('|')) cells.push(split(lines[i++]));
    i--;
    tables.push({ headers, cells });
  }
  return buildRows(tables, kind, today);
}

export function parseHtmlTable(text, { kind, today } = {}) {
  const tables = [];
  for (const t of text.matchAll(/<table[\s\S]*?<\/table>/gi)) {
    const trs = [...t[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
    const cellsOf = (tr) => [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => m[1]);
    if (!trs.length) continue;
    const headers = cellsOf(trs[0]).map((h) => textOf(h).toLowerCase());
    tables.push({ headers, cells: trs.slice(1).map(cellsOf) });
  }
  return buildRows(tables, kind, today);
}

const toIsoDate = (epochSeconds) => new Date(epochSeconds * 1000).toISOString().slice(0, 10);

// SimplifyJobs listings.json: only active, visible rows with a URL are real postings.
export function parseSimplifyJson(text, { kind } = {}) {
  const rows = [];
  let parseErrors = 0;
  for (const x of JSON.parse(text)) {
    if (!x || typeof x !== 'object') {
      parseErrors++;
      continue;
    }
    if (!(x.active && x.is_visible)) continue;
    const url = String(x.url ?? '').trim();
    if (!url) continue;
    const posted = x.date_posted ?? x.date_updated;
    rows.push({
      company: String(x.company_name ?? '').trim(),
      title: String(x.title ?? '').trim(),
      location: (x.locations ?? []).join(' / '),
      date: posted ? toIsoDate(posted) : '',
      url,
      kind,
    });
  }
  return { rows, parseErrors };
}

const DEFAULT_MAP = { company: 'company', title: 'title', location: 'location', date: 'date', url: 'url' };

// A source maps `clearance` to the record field that marks clearance-required rows; the flag travels in the title
// because rows carry no other free-text field and the student's dealbreakers match against the title.
const CLEARANCE_YES = /^(yes|y|true|required|1)$/i;
const CLEARANCE_SUFFIX = ' (clearance required)';

// A source maps `closed` to the record field that marks a closed posting; such rows are skipped and are not parse errors.
const CLOSED_YES = /^(yes|y|true|closed|1)$/i;

const isFlagged = (v, yes) => v === true || (typeof v === 'string' && yes.test(v.trim()));

// Maps one source record to a row {company, title, location, date, url, kind}.
// Returns undefined for a record to skip silently (no url, or flagged closed),
// null for a malformed record that counts as a parse error (non-http url),
// and the row otherwise. A clearance-flagged record gets CLEARANCE_SUFFIX on
// its title: upstream receives only {title, url, company, location}, so the
// title is the one channel that reaches the student's dealbreaker match.
function mapRecord(rec, map, kind) {
  const get = (k) => {
    const v = rec[map[k]];
    return v === undefined || v === null ? '' : String(v).trim();
  };
  const url = get('url');
  if (!url) return undefined;
  if (!/^https?:/i.test(url)) return null;
  if (map.closed && isFlagged(rec[map.closed], CLOSED_YES)) return undefined;
  const cleared = map.clearance && isFlagged(rec[map.clearance], CLEARANCE_YES);
  return { company: get('company'), title: cleared ? `${get('title')}${CLEARANCE_SUFFIX}` : get('title'), location: get('location'), date: get('date'), url, kind };
}

export function parseJsonArray(text, { kind, field_map } = {}) {
  const map = { ...DEFAULT_MAP, ...field_map };
  const rows = [];
  let parseErrors = 0;
  for (const rec of JSON.parse(text)) {
    const row = rec && typeof rec === 'object' ? mapRecord(rec, map, kind) : null;
    if (row) rows.push(row);
    else if (row === null) parseErrors++;
  }
  return { rows, parseErrors };
}

// RFC 4180: quoted fields may hold commas, doubled quotes and newlines.
export function parseCsvRecords(text) {
  const records = [];
  let field = '';
  let rec = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      rec.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      rec.push(field);
      field = '';
      if (rec.some((f) => f !== '')) records.push(rec);
      rec = [];
    } else field += c;
  }
  rec.push(field);
  if (rec.some((f) => f !== '')) records.push(rec);
  return records;
}

export function parseCsv(text, { kind, field_map } = {}) {
  const map = { ...DEFAULT_MAP, ...field_map };
  const [head = [], ...body] = parseCsvRecords(text);
  const headers = head.map((h) => h.trim());
  const rows = [];
  let parseErrors = 0;
  for (const cells of body) {
    const rec = Object.fromEntries(headers.map((h, i) => [h, cells[i]]));
    const row = mapRecord(rec, map, kind);
    if (row) rows.push(row);
    else if (row === null) parseErrors++;
  }
  return { rows, parseErrors };
}

export const PARSERS = Object.freeze({
  'simplify-json': parseSimplifyJson,
  'html-table': parseHtmlTable,
  'markdown-table': parseMarkdownTable,
  'json-array': parseJsonArray,
  csv: parseCsv,
});

export function parseSource(text, { format, kind, field_map, today } = {}) {
  const parser = PARSERS[format];
  if (!parser) throw new Error(`unknown list format ${format}`);
  return parser(text, { kind, today, field_map });
}
