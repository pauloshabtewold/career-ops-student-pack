// Assumed: string contract checks on the Codex docs, the suggested Codex config template, AGENTS.student.md and the
// interview Phase 5 text. Nothing here starts a process or touches the home directory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACK_ROOT } from '../helpers/script-harness.mjs';
import { scanText } from '../../scripts/pii-lint.mjs';

const read = (rel) => readFileSync(join(PACK_ROOT, rel), 'utf8');
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+/;
const HOME_CODEX_EDIT = /(edit|open|change|modify|append|write|add (it )?to|create|copy[^\n]*\bto|save[^\n]*\bto|put[^\n]*\bin)[^\n]*(~|\$HOME|%USERPROFILE%|\bUSERPROFILE\b)[\\/]\.codex/i;

function section(text, heading) {
  const start = text.indexOf(heading);
  assert.ok(start >= 0, `${heading} present`);
  const next = text.indexOf('\n## ', start + heading.length);
  return text.slice(start, next < 0 ? undefined : next);
}

// M-003-S1
test('M-003-S1 README.md names Claude Code and Codex as agent choices and links docs/codex.md', () => {
  const readme = read('README.md');
  assert.match(readme, /Claude Code/);
  assert.match(readme, /Codex/);
  assert.match(readme, /Claude Code or Codex/i);
  assert.match(readme, /\]\(docs\/codex\.md\)/);
});

// M-003-S2
test('M-003-S2 docs/codex.md covers install paths, config copy, trust, -c flag and the needs-a-real-account list', () => {
  const doc = read('docs/codex.md');
  assert.ok(doc.includes('/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex'));
  assert.ok(doc.includes('install.ps1'));
  assert.ok(doc.includes('npm i -g @openai/codex'));
  assert.ok(doc.includes('templates/codex-config.suggested.toml'));
  assert.ok(doc.includes('.codex/config.toml'));
  assert.match(doc, /trust/i);
  assert.ok(doc.includes('-c project_doc_max_bytes=131072'));
  assert.match(doc, /needs a real account/i);
  assert.match(doc, /AGENTS\.override\.md/);
});

// M-003-S3
test('M-003-S3 the template sets the doc limit and sandbox mode and disables each Gmail write tool', () => {
  const toml = read('templates/codex-config.suggested.toml');
  assert.match(toml, /^project_doc_max_bytes\s*=\s*131072\s*$/m);
  assert.match(toml, /^sandbox_mode\s*=\s*"workspace-write"\s*$/m);
  assert.match(toml, /^approval_policy\s*=\s*"on-request"\s*$/m);
  assert.match(toml, /\[sandbox_workspace_write\]/);
  assert.match(toml, /network_access\s*=\s*true/);
  for (const tool of ['send_email', 'send_draft', 'forward_emails', 'delete_emails', 'trash_emails', 'archive_emails', 'create_draft']) {
    assert.ok(toml.includes(tool), `${tool} listed`);
    assert.match(toml, new RegExp(`${tool}[\\s\\S]{0,80}?false`), `${tool} disabled`);
  }
  assert.match(toml, /\.codex\/config\.toml/);
  assert.match(toml, /trust/i);
});

// M-003-S4
test('M-003-S4 AGENTS.student.md has a Tools by agent table and a rule against Gmail write tools', () => {
  const rules = read('AGENTS.student.md');
  const tools = section(rules, 'Tools by agent');
  assert.match(tools, /\|[^\n]*Claude Code[^\n]*\|[^\n]*Codex[^\n]*\|/);
  for (const cell of ['Bash', 'shell', 'Edit', 'apply_patch', 'mcp__codex_apps__gmail_search_emails', 'mcp__codex_apps__gmail_read_email', 'Claude in Chrome', 'ChatGPT in-app browser']) {
    assert.ok(tools.includes(cell), `${cell} in the table`);
  }
  assert.match(rules, /never call[^\n]*(send|reply)[^\n]*forward[^\n]*delete[^\n]*trash[^\n]*archive[^\n]*draft/i);
  assert.match(rules, /update check skipped \(offline\)/);
  assert.match(rules, /CLAUDE\.local\.md/);
  assert.match(rules, /AGENTS\.override\.md/);
});

// M-003-S5
test('M-003-S5 docs/codex-spike.md holds no email address and passes pii-lint', () => {
  const spike = read('docs/codex-spike.md');
  assert.ok(!EMAIL.test(spike), 'no email address');
  assert.deepEqual(scanText('docs/codex-spike.md', spike), []);
  assert.match(spike, /5\/5/);
  assert.match(spike, /apply_patch/);
});

// M-003-S6
test('M-003-S6 interview.md Phase 5 names the agent key with claude and codex', () => {
  const phase = section(read('interview/interview.md'), '## Phase 5');
  assert.match(phase, /`agent`/);
  assert.match(phase, /`codex`/);
  assert.match(phase, /`claude`/);
  assert.match(phase, /signed in on this computer/);
});

// M-003-S7: the existing docs-command-contract, links, docs and pack-block tests are the guard; this checks the new docs
// stay in their plain-punctuation, no-repo-URL shape.
test('M-003-S7 the new docs use plain punctuation and no repo URL', () => {
  for (const rel of ['docs/codex.md', 'docs/codex-spike.md', 'AGENTS.student.md', 'templates/codex-config.suggested.toml']) {
    const text = read(rel);
    assert.ok(!/[\u2014\u2018\u2019\u201C\u201D]/.test(text), `${rel}: no em dash or curly quotes`);
    assert.ok(!/github\.com\//i.test(text), `${rel}: no repo URL`);
  }
});

// M-003-S8
test('M-003-S8 docs/codex.md tells the student to restart Codex after node student/update.mjs', () => {
  const doc = read('docs/codex.md');
  assert.ok(doc.includes('node student/update.mjs'));
  assert.match(doc, /restart Codex/i);
});

// M-003-S9
test('M-003-S9 the template and docs/codex.md mark Gmail app-tool keys unverified; codex triage is a preview', () => {
  const toml = read('templates/codex-config.suggested.toml');
  assert.match(toml, /^#[^\n]*(not checked|unverified)/im);
  assert.match(toml, /second guard/i);
  const doc = read('docs/codex.md');
  assert.match(doc, /unverified/i);
  assert.match(doc, /preview/i);
  assert.match(doc, /--ignore-user-config/);
  assert.match(doc, /agent: codex/);
  assert.match(doc, /schedule\.mjs install/);
  const needs = doc.slice(doc.search(/needs a real account/i));
  assert.match(needs, /list its tools|lists? (its )?tools/i);
  assert.match(needs, /Gmail/);
  assert.match(needs, /Task Scheduler/);
});

// M-003-S10
test('M-003-S10 the template holds no absolute or home path', () => {
  const toml = read('templates/codex-config.suggested.toml');
  assert.ok(!toml.includes('~'), 'no tilde');
  assert.ok(!toml.includes('/Users/'), 'no /Users/');
  assert.ok(!toml.includes('/home/'), 'no /home/');
  assert.ok(!toml.includes(':\\'), 'no drive path');
  assert.ok(!/(^|[\s"'=])\/[A-Za-z]/m.test(toml.replace(/^\s*#.*$/gm, '')), 'no absolute path in a value');
});

// M-003-S11
test('M-003-S11 README.md and docs/codex.md never tell anyone to edit a file under ~/.codex', () => {
  for (const rel of ['README.md', 'docs/codex.md']) {
    const text = read(rel);
    for (const line of text.split('\n')) {
      assert.ok(!HOME_CODEX_EDIT.test(line), `${rel}: ${line}`);
    }
  }
  assert.ok(HOME_CODEX_EDIT.test('Edit ~/.codex/config.toml and add the key'), 'the pattern catches an edit instruction');
  assert.ok(!HOME_CODEX_EDIT.test('Copy the template to .codex/config.toml in the career-ops folder'), 'the pattern allows the project copy');
});
