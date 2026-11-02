#!/usr/bin/env node
// Local cache of company research notes with an age limit (modes/apply-loop.md, cover letter step). Notes live in
// data/research/<company-key>.md under a short header that records the company name and the date fetched. Nothing leaves
// the computer. A note older than config research_cache_days (default 30) is stale: `get` refuses it, `prune` deletes it.
// Usage: research-cache.mjs get <company> | put <company> [FILE|-] | list | prune
//        [--root R] [--data-dir D] [--today YYYY-MM-DD] [--dry-run]
// `put` reads the note from FILE, or from stdin when FILE is - or absent. `prune --dry-run` lists what it would delete.
// Exit codes for get: 0 fresh note printed, 3 stale (the note is not printed), 4 no note. 2 is a usage error.
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { UsageError, parseArgs, runCli, isMain } from '../lib/args.mjs';
import { createClock, isRealDate } from '../lib/clock.mjs';
import { companyKey } from '../lib/company-key.mjs';
import { loadStudentConfig } from '../lib/config.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { writeAtomic } from '../lib/tsv.mjs';

export const DEFAULT_CACHE_DAYS = 30;
export const EXIT_STALE = 3;
export const EXIT_MISS = 4;
const DAY_MS = 86400000;
const HEADER = /^---\r?\ncompany: (.*)\r?\nfetched: (\d{4}-\d{2}-\d{2})\r?\n---\r?\n/;

const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY_MS);

// One file name per employer, folded the same way the ranker folds company names.
export function cacheKey(company, { parents = {}, ignore = [] } = {}) {
  const key = companyKey(company, parents, ignore).replace(/ /g, '-');
  if (!/^[a-z0-9-]+$/.test(key)) throw new UsageError(`"${company}" has no letters or digits to make a cache name from`);
  return key;
}

export function parseNote(text) {
  const m = HEADER.exec(text);
  if (!m || !isRealDate(m[2])) return null;
  return { company: m[1], fetched: m[2], body: text.slice(m[0].length) };
}

export const formatNote = ({ company, fetched, body }) => `---\ncompany: ${String(company).replace(/[\r\n]+/g, ' ').trim()}\nfetched: ${fetched}\n---\n${body.endsWith('\n') ? body : `${body}\n`}`;

// age is whole days since fetched (never negative); fresh while age <= limit.
export function noteStatus(note, today, limit) {
  const age = Math.max(0, daysBetween(note.fetched, today));
  return { age, fresh: age <= limit };
}

export function createCache({ dir, today, limit = DEFAULT_CACHE_DAYS, keyOptions = {} }) {
  const fileFor = (company) => join(dir, `${cacheKey(company, keyOptions)}.md`);
  const entries = () =>
    (existsSync(dir) ? readdirSync(dir) : [])
      .filter((f) => f.endsWith('.md'))
      .sort()
      .map((f) => {
        const note = parseNote(readFileSync(join(dir, f), 'utf8'));
        return { file: join(dir, f), key: f.slice(0, -3), note, ...(note ? noteStatus(note, today, limit) : { age: null, fresh: false }) };
      });
  return {
    get(company) {
      const file = fileFor(company);
      if (!existsSync(file)) return { state: 'miss' };
      const note = parseNote(readFileSync(file, 'utf8'));
      if (!note) return { state: 'stale', reason: 'no readable fetched date', file };
      const status = noteStatus(note, today, limit);
      return { state: status.fresh ? 'fresh' : 'stale', note, file, ...status };
    },
    put(company, body) {
      if (!String(body).trim()) throw new UsageError('the note is empty; nothing was stored');
      mkdirSync(dir, { recursive: true });
      const file = fileFor(company);
      writeAtomic(file, formatNote({ company, fetched: today, body }));
      return file;
    },
    list: entries,
    // Only notes with a readable header and an age above the limit go; a file without one is left for the student to look at.
    prune({ dryRun = false } = {}) {
      const stale = entries().filter((e) => e.note && !e.fresh);
      if (!dryRun) for (const e of stale) unlinkSync(e.file);
      return stale;
    },
  };
}

const readStdin = () => readFileSync(0, 'utf8');

async function main() {
  const { command, positionals, flags } = parseArgs(process.argv.slice(2), { commands: ['get', 'put', 'list', 'prune'] });
  const paths = resolvePaths({ root: flags.root, dataDir: flags.dataDir });
  const config = await loadStudentConfig({ root: paths.root });
  const today = createClock({ today: flags.today, timezone: config?.timezone }).today();
  const cache = createCache({
    dir: join(paths.dataDir, 'research'),
    today,
    limit: config?.research_cache_days ?? DEFAULT_CACHE_DAYS,
    keyOptions: { parents: config?.rank?.parent_companies ?? {}, ignore: (config?.rank?.ignore_words ?? []).map((w) => w.toLowerCase()) },
  });
  const limit = config?.research_cache_days ?? DEFAULT_CACHE_DAYS;
  const need = (n, usage) => {
    if (positionals.length < n || positionals.length > (command === 'put' ? 2 : n)) throw new UsageError(`usage: research-cache.mjs ${usage}`);
  };

  if (command === 'get') {
    need(1, 'get <company>');
    const res = cache.get(positionals[0]);
    if (res.state === 'miss') {
      console.error(`research-cache: no note for ${positionals[0]}`);
      return EXIT_MISS;
    }
    if (res.state === 'stale') {
      console.error(res.reason ? `research-cache: stale (${res.reason})` : `research-cache: stale, fetched ${res.note.fetched}, ${res.age} days old (limit ${limit})`);
      return EXIT_STALE;
    }
    process.stdout.write(`fetched: ${res.note.fetched} (${res.age} days old, limit ${limit}); re-verify any claim before using it\n\n${res.note.body}`);
    return 0;
  }
  if (command === 'put') {
    need(1, 'put <company> [FILE|-]');
    const src = positionals[1];
    const body = !src || src === '-' ? readStdin() : readFileSync(src, 'utf8');
    const file = cache.put(positionals[0], body);
    console.log(`stored ${file}`);
    return 0;
  }
  need(0, command);
  if (command === 'list') {
    for (const e of cache.list()) {
      console.log(`${e.key}\t${e.note ? `fetched ${e.note.fetched}\t${e.age} days\t${e.fresh ? 'fresh' : 'stale'}` : 'unreadable header'}`);
    }
    return 0;
  }
  const removed = cache.prune({ dryRun: flags.dryRun === true });
  for (const e of removed) console.log(`${flags.dryRun ? 'would delete' : 'deleted'} ${e.key} (fetched ${e.note.fetched}, ${e.age} days old)`);
  console.log(`${removed.length} stale note${removed.length === 1 ? '' : 's'} ${flags.dryRun ? 'found' : 'deleted'} (limit ${limit} days)`);
  return 0;
}

if (isMain(import.meta.url)) await runCli(main);
