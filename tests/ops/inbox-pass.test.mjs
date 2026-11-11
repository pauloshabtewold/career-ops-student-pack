// Assumed (M-002): scripts/inbox-pass.mjs exports inboxPass({ paths, config, agent, agentPath, today, deadline, check, runner,
// platform, now, inboxDeps }), buildPrompt, buildClaudeArgs({ model, settings, shell }), buildCodexArgs({ tmp, out, effort, shell })
// and auditEvents(agent, stdout). The runner is runner(cmd, args, opts) like daily-triage's: it returns stdout or throws an
// error with { status, stderr, code }. The claude and codex calls and the merge-post.mjs child all go through it; the prompt
// travels in opts.input. Digest: data/digest/student-<date>.md. The CLI checks run a fake agent script as a child process
// (POSIX only) so --check, usage errors and the no-config message are seen from outside. Nothing here reaches Gmail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ALERT_DOMAINS } from '../../lib/mail-classify.mjs';
import { CLAUDE_GMAIL_READ_TOOLS, CLAUDE_GMAIL_WRITE_TOOLS, CODEX_GMAIL_CONNECTOR_ID, CODEX_GMAIL_WRITE_TOOLS, CODEX_DISABLED_FEATURES, codexGmailDisableFlags } from '../../lib/agent.mjs';
import { MESSAGE_CAP, auditEvents, buildClaudeArgs, buildCodexArgs, inboxPass } from '../../scripts/inbox-pass.mjs';
import { CLAUDE, CODEX, NOW, PACK_ROOT, SEARCH, TODAY, WRITE_TOOL, answerText, claudeStream, codexEvents, digestOf, failing, handshakeAlert, makeInboxRoot, plainMail, runPass, staging, unquote } from '../helpers/inbox-harness.mjs';

const pass = (r, opts = {}) => runPass(r, { inboxPass, ...opts });
const withRoot = async (opts, fn) => {
  const r = makeInboxRoot(opts);
  try {
    await fn(r);
  } finally {
    r.cleanup();
  }
};
const first = (calls) => {
  assert.equal(calls.claude.length, 1, 'one claude call');
  return calls.claude[0];
};
const firstCodex = (calls) => {
  assert.equal(calls.codex.length, 1, 'one codex call');
  return calls.codex[0];
};
const pairs = (argv, flag) => argv.flatMap((a, i) => (a === flag ? [argv[i + 1]] : []));
const lastPass = (r) => (r.exists('data/.student-inbox-last-pass') ? r.read('data/.student-inbox-last-pass').trim() : null);
const skipLines = (r) => digestOf(r).split('\n').filter((l) => /inbox pass skipped/.test(l));
const answerWith = (text) => () => claudeStream({ answer: text });

// M-002-S5-cdel
test('M-002-S5-cdel a valid answer is written to data/inbox-<date>.json, staged, merged, summarised in one Inbox section and deleted', () =>
  withRoot({}, async (r) => {
    const msgs = [handshakeAlert('a-1'), plainMail('p-1')];
    const { calls } = await pass(r, { handlers: { claude: answerWith(answerText(msgs)) } });
    assert.equal(calls.claude.length, 1);
    assert.equal(calls.child.length, 1);
    const merge = calls.child[0];
    assert.equal(merge.script, 'merge-post.mjs');
    assert.deepEqual(JSON.parse(merge.json).map((m) => m.id), ['a-1', 'p-1'], 'the connector input file held the messages array');
    assert.ok(merge.staging.includes('https://app.joinhandshake.com/jobs/8800123'), 'inbox.mjs staged before merge-post ran');
    assert.equal(r.exists(`data/inbox-${TODAY}.json`), false, 'the JSON file is deleted');
    const digest = digestOf(r);
    assert.equal(digest.split('\n').filter((l) => /^## Inbox\s*$/.test(l)).length, 1);
    assert.ok(digest.includes('inbox pass: read 2 messages, alerts staged 1 (employer 0, handshake 1, need a link 0), status updates 0, proposals 0, suspicious 0'), digest);
    assert.ok(!/Wingtip|Analyst Intern|Lunch|https?:\/\//.test(digest), 'counts only: no message text or links');
    assert.ok(!/not read/.test(digest));
    assert.ok(Number(lastPass(r)) >= NOW, 'data/.student-inbox-last-pass holds an epoch ms');
  }));

// M-002-S6-cdel
test('M-002-S6-cdel buildClaudeArgs is dontAsk with no tools, the Gmail read allow list, the write disallow list and no strict-mcp-config', () => {
  const args = buildClaudeArgs({ model: 'sonnet', settings: '/opt/sample/pack/templates/triage-claude-settings.json' });
  assert.deepEqual(args, ['-p', '--tools', '', '--permission-mode', 'dontAsk', '--permission-prompts', 'none', '--allowedTools', ...CLAUDE_GMAIL_READ_TOOLS, '--disallowedTools', ...CLAUDE_GMAIL_WRITE_TOOLS, '--setting-sources', 'project', '--settings', '/opt/sample/pack/templates/triage-claude-settings.json', '--output-format', 'stream-json', '--verbose', '--model', 'sonnet']);
  assert.equal(args.includes('--strict-mcp-config'), false);
  assert.ok(CLAUDE_GMAIL_READ_TOOLS.length > 0 && CLAUDE_GMAIL_WRITE_TOOLS.length > 0);
  for (const t of [...CLAUDE_GMAIL_READ_TOOLS, ...CLAUDE_GMAIL_WRITE_TOOLS]) assert.match(t, /^mcp__claude_ai_Gmail__\w+$/);
  assert.deepEqual(CLAUDE_GMAIL_READ_TOOLS.filter((t) => CLAUDE_GMAIL_WRITE_TOOLS.includes(t)), []);
  assert.ok(CLAUDE_GMAIL_READ_TOOLS.some((t) => /search/.test(t)));
  assert.ok(CLAUDE_GMAIL_WRITE_TOOLS.some((t) => /send|draft/.test(t)));
});

test('extra check: the claude call inboxPass makes carries those flags, the prompt on stdin and an empty working folder', () =>
  withRoot({}, async (r) => {
    const { calls } = await pass(r);
    const call = first(calls);
    assert.equal(call.cmd, CLAUDE);
    assert.equal(call.args[call.args.indexOf('--permission-mode') + 1], 'dontAsk');
    assert.equal(call.args[call.args.indexOf('--tools') + 1], '');
    assert.equal(call.args.includes('--strict-mcp-config'), false);
    assert.equal(call.args[call.args.indexOf('--model') + 1], 'sonnet');
    for (const t of CLAUDE_GMAIL_WRITE_TOOLS) assert.ok(call.args.includes(t), t);
    assert.match(String(call.opts.input), /after:\d+/);
    assert.notEqual(call.opts.cwd, r.root);
  }));

test('extra check: the codex call keeps apps enabled and disables the 11 Gmail write tools', () =>
  withRoot({ config: 'agent: codex\nmailbox:\n  backend: connector\n  schedule: on\n' }, async (r) => {
    assert.deepEqual([...CODEX_GMAIL_WRITE_TOOLS].sort(), ['apply_labels_to_emails', 'archive_emails', 'batch_modify_email', 'bulk_label_matching_emails', 'create_draft', 'create_label', 'delete_emails', 'forward_emails', 'send_draft', 'send_email', 'update_draft']);
    const flags = codexGmailDisableFlags();
    assert.equal(flags.length, 22);
    for (const t of CODEX_GMAIL_WRITE_TOOLS) assert.ok(flags.includes(`apps.${CODEX_GMAIL_CONNECTOR_ID}.tools.${t}.enabled=false`), t);
    const { calls } = await pass(r, { agent: 'codex', agentPath: CODEX });
    const args = firstCodex(calls).args;
    assert.deepEqual(args.slice(0, 3), ['-a', 'never', 'exec']);
    const disabled = pairs(args, '--disable');
    assert.equal(disabled.includes('apps'), false, 'apps stays enabled');
    assert.deepEqual(disabled, CODEX_DISABLED_FEATURES.filter((f) => f !== 'apps'));
    assert.ok(pairs(args, '-c').includes('web_search=disabled'));
    for (const f of flags.filter((x) => x !== '-c')) assert.ok(pairs(args, '-c').includes(f), f);
    assert.deepEqual(args.slice(-5), ['-C', args[args.length - 4], '-o', args[args.length - 2], '-']);
    assert.equal(firstCodex(calls).opts.cwd, args[args.length - 4]);
    assert.match(String(firstCodex(calls).opts.input), /after:\d+/);
  }));

// M-002-S7-cdel
test('M-002-S7-cdel a Gmail write tool call discards the output, stages nothing and the digest line names the tool', () =>
  withRoot({}, async (r) => {
    const { calls } = await pass(r, { handlers: { claude: () => claudeStream({ tools: [SEARCH, WRITE_TOOL], answer: answerText([handshakeAlert()]) }) } });
    assert.equal(calls.child.length, 0, 'merge-post.mjs never runs');
    assert.equal(staging(r), '');
    assert.equal(r.exists(`data/inbox-${TODAY}.json`), false);
    const lines = skipLines(r);
    assert.equal(lines.length, 1, digestOf(r));
    assert.ok(lines[0].includes(WRITE_TOOL) && /unexpected tool/.test(lines[0]) && /output discarded/.test(lines[0]), lines[0]);
  }));

test('extra check: a Bash call discards the output and names Bash', () =>
  withRoot({}, async (r) => {
    const { calls } = await pass(r, { handlers: { claude: () => claudeStream({ tools: [SEARCH, 'Bash'], answer: answerText([handshakeAlert()]) }) } });
    assert.equal(calls.child.length, 0);
    assert.equal(staging(r), '');
    assert.match(skipLines(r).join('\n'), /unexpected tool Bash/);
  }));

test('extra check: auditEvents returns the first tool outside the Gmail read set and reads tool calls, not the init tool list', () => {
  assert.equal(auditEvents('claude', claudeStream({ tools: [SEARCH] })), null);
  assert.equal(auditEvents('claude', claudeStream({ tools: [SEARCH, WRITE_TOOL, 'Bash'] })), WRITE_TOOL);
  assert.equal(auditEvents('claude', claudeStream({ tools: ['Bash'] })), 'Bash');
  assert.equal(auditEvents('codex', codexEvents({ tools: ['gmail_search_emails', 'gmail_read_email'] })), null);
  assert.equal(auditEvents('codex', codexEvents({ tools: ['gmail_search_emails', 'send_email'] })), 'send_email');
});

const FAILURES = [
  ['a missing agent', { agentPath: null }, /inbox pass skipped: claude not found; install it and run schedule\.mjs install again/],
  ['a signed-out agent', { handlers: { claude: failing({ status: 1, stderr: 'Not logged in. Please run /login' }) } }, /signed out; run claude once in a terminal to sign in/],
  ['a rejected flag', { handlers: { claude: failing({ status: 1, stderr: "error: unknown option '--permission-prompts'" }) } }, /claude rejected a flag \(--permission-prompts\); update claude/],
  ['a timeout', { handlers: { claude: failing({ code: 'ETIMEDOUT', stderr: '' }) } }, /timed out after 15 minutes/],
  ['a non-JSON answer', { handlers: { claude: answerWith('I could not read your mail.') } }, /answer was not a JSON/],
];
for (const [name, opts, re] of FAILURES) {
  // M-002-S8-cdel
  test(`${name === FAILURES[0][0] ? "M-002-S8-cdel" : "extra check:"} ${name} writes one digest line with the reason and its fix and stages nothing`, () =>
    withRoot({}, async (r) => {
      const { calls } = await pass(r, opts);
      const lines = skipLines(r);
      assert.equal(lines.length, 1, digestOf(r));
      assert.match(lines[0], re);
      assert.match(digestOf(r), /^## Inbox\s*$/m);
      assert.equal(calls.child.length, 0);
      assert.equal(staging(r), '');
      assert.equal(r.exists(`data/inbox-${TODAY}.json`), false);
    }));
}

test('extra check: a codex agent that rejects an argument says update codex', () =>
  withRoot({ config: 'agent: codex\nmailbox:\n  backend: connector\n  schedule: on\n' }, async (r) => {
    await pass(r, { agent: 'codex', agentPath: CODEX, handlers: { codex: failing({ status: 2, stderr: "error: unexpected argument '--bogus' found" }) } });
    assert.match(skipLines(r).join('\n'), /codex rejected a flag \(--bogus\); update codex/);
  }));

test('extra check: the CLI exits 0 when the agent is missing and still writes the digest line', () =>
  withRoot({}, (r) => {
    const out = spawnSync(process.execPath, [join(PACK_ROOT, 'scripts', 'inbox-pass.mjs'), '--agent', 'claude', '--agent-path', join(r.root, 'no-such-bin', 'claude'), '--root', r.root, '--data-dir', r.data, '--today', TODAY], { encoding: 'utf8', timeout: 60000 });
    assert.equal(out.status, 0, out.stderr);
    assert.match(digestOf(r), /inbox pass skipped: claude not found/);
  }));

// A fake agent that logs its argv to <dir>/argv.json, drains stdin and prints a canned stream. mode picks the tool calls.
function fakeAgent(dir, mode) {
  const tools = { ok: [SEARCH], write: [SEARCH, WRITE_TOOL], bash: ['Bash'], none: [] }[mode];
  const stream = claudeStream({ tools, answer: answerText([]) }).split('\n');
  const file = join(dir, `claude-${mode}`);
  writeFileSync(file, `#!${process.execPath}\nconst fs = require('node:fs');\nfs.writeFileSync(${JSON.stringify(join(dir, 'argv.json'))}, JSON.stringify(process.argv.slice(2)));\nprocess.stdin.resume();\nprocess.stdin.on('end', () => { process.stdout.write(${JSON.stringify(`${stream.join('\n')}\n`)}); });\n`);
  chmodSync(file, 0o755);
  return file;
}
const posix = process.platform === 'win32' ? { skip: 'the fake agent is a shebang script; win32 agents are covered by the .cmd argv tests' } : {};
const cli = (args, cwd) => spawnSync(process.execPath, [join(PACK_ROOT, 'scripts', 'inbox-pass.mjs'), ...args], { encoding: 'utf8', timeout: 60000, cwd });

// M-002-S9-cdel
test('M-002-S9-cdel --check prints ok and exits 0 when the run called a Gmail search tool and nothing else', posix, () =>
  withRoot({}, (r) => {
    const agent = fakeAgent(r.root, 'ok');
    const out = cli(['--check', '--agent', 'claude', '--agent-path', agent, '--root', r.root, '--data-dir', r.data, '--today', TODAY]);
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /^inbox pass check: ok \(claude, Gmail read tools only\)$/m);
  }));

test('extra check: --check prints failed with the reason and exits 1 for a write tool, a Bash call or no search', posix, async () => {
  for (const mode of ['write', 'bash', 'none']) {
    await withRoot({}, (r) => {
      const agent = fakeAgent(r.root, mode);
      const out = cli(['--check', '--agent', 'claude', '--agent-path', agent, '--root', r.root, '--data-dir', r.data, '--today', TODAY]);
      assert.equal(out.status, 1, `${mode}: ${out.stdout}${out.stderr}`);
      assert.match(out.stdout, /^inbox pass check: failed \(.+\)$/m, mode);
      if (mode === 'write') assert.ok(out.stdout.includes(WRITE_TOOL));
      if (mode === 'bash') assert.ok(out.stdout.includes('Bash'));
      assert.ok(!/check: ok/.test(out.stdout), mode);
    });
  }
});

// M-002-S17-cdel
test('M-002-S17-cdel the win32 .cmd claude argv passes --tools as a quoted empty string and quotes every Gmail tool name and stays under 8191 characters', () => {
  const settings = 'C:\\Users\\Sample Student\\career-ops\\student\\templates\\triage-claude-settings.json';
  const shell = buildClaudeArgs({ model: 'sonnet', settings, shell: true });
  assert.equal(shell[shell.indexOf('--tools') + 1], '""');
  for (const t of [...CLAUDE_GMAIL_READ_TOOLS, ...CLAUDE_GMAIL_WRITE_TOOLS]) assert.ok(shell.includes(`"${t}"`), t);
  assert.ok(shell.includes(`"${settings}"`));
  const agentPath = '"C:\\Users\\Sample Student\\AppData\\Roaming\\npm\\claude.cmd"';
  assert.ok([agentPath, ...shell].join(' ').length < 8191);
  const plain = buildClaudeArgs({ model: 'sonnet', settings });
  assert.equal(plain[plain.indexOf('--tools') + 1], '');
  assert.ok(plain.includes(CLAUDE_GMAIL_READ_TOOLS[0]) && !plain.includes(`"${CLAUDE_GMAIL_READ_TOOLS[0]}"`));
});

test('extra check: the win32 .cmd codex argv quotes every -c value and stays under 8191 characters', () => {
  const tmp = 'C:\\Users\\Sample Student\\AppData\\Local\\Temp\\inbox-pass-1';
  const out = `${tmp}\\last.txt`;
  const args = buildCodexArgs({ tmp, out, effort: 'medium', shell: true });
  const values = pairs(args, '-c');
  assert.ok(values.length >= 1 + CODEX_GMAIL_WRITE_TOOLS.length);
  for (const v of values) assert.match(v, /^".*"$/, v);
  assert.ok(args.includes(`"${tmp}"`) && args.includes(`"${out}"`));
  assert.ok(['"C:\\Users\\Sample Student\\AppData\\Roaming\\npm\\codex.cmd"', ...args].join(' ').length < 8191);
});

test('extra check: inboxPass on win32 with a .cmd agent path quotes the command and passes --tools as a quoted pair', () =>
  withRoot({}, async (r) => {
    const cmd = 'C:\\Users\\Sample Student\\AppData\\Roaming\\npm\\claude.cmd';
    const { calls } = await pass(r, { platform: 'win32', agentPath: cmd });
    const call = first(calls);
    assert.equal(unquote(call.cmd), cmd);
    assert.equal(call.args[call.args.indexOf('--tools') + 1], '""');
    for (const t of CLAUDE_GMAIL_READ_TOOLS) assert.ok(call.args.includes(`"${t}"`), t);
    assert.ok([call.cmd, ...call.args].join(' ').length < 8191);
  }));

// M-002-S18-cdel
test('M-002-S18-cdel the prompt lists assessment and company-reply searches before the alert searches, each after the last-pass cutoff', () =>
  withRoot({}, async (r) => {
    const lastPassMs = NOW - 3 * 3600 * 1000;
    r.write('data/.student-inbox-last-pass', String(lastPassMs));
    const { calls } = await pass(r);
    const prompt = String(first(calls).opts.input);
    const epoch = (lastPassMs - 3600 * 1000) / 1000;
    assert.ok(prompt.includes(`after:${epoch}`), `cutoff is the last pass minus 1 hour (${epoch})`);
    const firstAlert = Math.min(...Object.keys(ALERT_DOMAINS).map((d) => prompt.indexOf(d)).filter((i) => i >= 0));
    for (const early of ['assess.example.com', 'Northwind Robotics', 'Contoso Analytics']) {
      const i = prompt.indexOf(early);
      assert.ok(i >= 0 && i < firstAlert, `${early} is searched before the alert senders`);
    }
    assert.ok(prompt.includes(String(MESSAGE_CAP)) && MESSAGE_CAP === 40);
    for (const l of prompt.split('\n').filter((x) => /from:/.test(x))) assert.match(l, /after:\d+/, l);
  }));

test('extra check: with no earlier pass the cutoff is two days before now', () =>
  withRoot({}, async (r) => {
    const { calls } = await pass(r);
    assert.ok(String(first(calls).opts.input).includes(`after:${(NOW - 2 * 86400 * 1000) / 1000}`));
  }));

test('extra check: not_read 7 adds "7 not read (cap 40)" to the digest line and not_read 0 adds nothing', () =>
  withRoot({}, async (r) => {
    await pass(r, { handlers: { claude: answerWith(answerText([plainMail('p-1')], 7)) } });
    const line = digestOf(r).split('\n').find((l) => /inbox pass: read/.test(l));
    assert.ok(line.endsWith(', 7 not read (cap 40)'), line);
  }));

test('extra check: a bare array answer is accepted as not_read 0', () =>
  withRoot({}, async (r) => {
    await pass(r, { handlers: { claude: answerWith(JSON.stringify([handshakeAlert('a-1')])) } });
    const digest = digestOf(r);
    assert.match(digest, /inbox pass: read 1 messages, alerts staged 1/);
    assert.ok(!/not read/.test(digest));
  }));

// M-002-S19-cdel
test('M-002-S19-cdel --check with no config/student.yml uses the --agent flag and the standard model and still runs the check', posix, () => {
  const root = mkdtempSync(join(tmpdir(), 'inbox-noconfig-'));
  try {
    mkdirSync(join(root, 'data'));
    const agent = fakeAgent(root, 'ok');
    const out = cli(['--check', '--agent', 'claude', '--agent-path', agent, '--root', root, '--data-dir', join(root, 'data'), '--today', TODAY]);
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /inbox pass check: ok \(claude, Gmail read tools only\)/);
    const argv = JSON.parse(readFileSync(join(root, 'argv.json'), 'utf8'));
    assert.equal(argv[argv.indexOf('--model') + 1], 'sonnet');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('extra check: --check with no config and no --agent is a usage error', () => {
  const root = mkdtempSync(join(tmpdir(), 'inbox-noconfig-'));
  try {
    mkdirSync(join(root, 'data'));
    const out = cli(['--check', '--root', root, '--data-dir', join(root, 'data'), '--today', TODAY]);
    assert.equal(out.status, 2, out.stdout + out.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('extra check: a normal run with no config/student.yml prints "inbox pass: off (no config yet)" and exits 0', () => {
  const root = mkdtempSync(join(tmpdir(), 'inbox-noconfig-'));
  try {
    mkdirSync(join(root, 'data'));
    const out = cli(['--root', root, '--data-dir', join(root, 'data'), '--today', TODAY]);
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /inbox pass: off \(no config yet\)/);
    assert.equal(existsSync(join(root, 'data', 'digest')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
