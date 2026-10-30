#!/usr/bin/env node
// Prints a resume as plain text so the interview can read it. .md and .txt pass through; .docx is unzipped with
// node:zlib only (no library), taking word/document.xml from the zip central directory and writing one line per
// paragraph. PDFs are not read here: the agent reads them with its own file tool.
// Usage: resume-text.mjs <resume.docx|.md|.txt>    exit 0 text printed, 1 unreadable or unsupported, 2 usage
import { readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { UsageError, parseArgs, runCli, isMain } from '../lib/args.mjs';

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_MIN = 22;
const MAX_COMMENT = 65535;

export class ResumeTextError extends Error {}

// Bytes of one named file inside a zip archive, or null when the archive has no such entry.
export function readZipEntry(buf, name) {
  let eocd = -1;
  for (let i = buf.length - EOCD_MIN; i >= Math.max(0, buf.length - EOCD_MIN - MAX_COMMENT); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ResumeTextError('not a .docx file (no zip directory found)');
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== CENTRAL_SIG) throw new ResumeTextError('damaged .docx file (bad zip directory)');
    const method = buf.readUInt16LE(at + 10);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    if (buf.toString('utf8', at + 46, at + 46 + nameLen) === name) {
      const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(dataStart, dataStart + size);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return inflateRawSync(data);
      throw new ResumeTextError(`unsupported zip compression method ${method}`);
    }
    at += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
// Resolves the five XML named entities and numeric references; an unknown named entity is left as written.
const decode = (s) =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e] ?? m;
  });

// One line per w:p; w:tab and w:br inside a paragraph become a tab and a space so words do not run together.
export function extractDocxText(buf) {
  const xml = readZipEntry(buf, 'word/document.xml');
  if (!xml) throw new ResumeTextError('not a Word document (word/document.xml is missing)');
  const paragraphs = xml.toString('utf8').match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? [];
  return paragraphs
    .map((p) => {
      const runs = [...p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>/g)];
      return runs.map((m) => (m[1] !== undefined ? decode(m[1]) : m[0].startsWith('<w:tab') ? '\t' : ' ')).join('').trimEnd();
    })
    .join('\n');
}

// PDFs are refused here: the agent reads them with its own file tool, so no PDF parser is needed.
export function resumeText(file) {
  const ext = extname(file).toLowerCase();
  if (ext === '.md' || ext === '.txt') return readFileSync(file, 'utf8');
  if (ext === '.docx') return extractDocxText(readFileSync(file));
  throw new ResumeTextError(`${ext || 'this'} files are not read here: paste the text, or for a PDF let Claude read the file directly`);
}

async function main() {
  const { command, positionals } = parseArgs(process.argv.slice(2), { common: false });
  if (!command || positionals.length) throw new UsageError('usage: resume-text.mjs <resume.docx|.md|.txt>');
  try {
    process.stdout.write(`${resumeText(resolve(command)).replace(/\n*$/, '')}\n`);
    return 0;
  } catch (err) {
    const unreadable = err.code === 'ENOENT' || String(err.code).startsWith('Z_');
    if (err instanceof ResumeTextError || unreadable) {
      console.error(`resume-text: ${err.code === 'ENOENT' ? `no such file ${command}` : err.message}`);
      return 1;
    }
    throw err;
  }
}

if (isMain(import.meta.url)) await runCli(main);
