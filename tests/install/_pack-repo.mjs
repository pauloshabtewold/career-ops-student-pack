// Scratch pack repository for the install, update and session-start tests. The pack is copied into
// <root>/student as a real git clone of a scratch "origin" repository, so update.mjs sees real commits, tags and
// a fetchable remote without any network. <root> is a synthetic upstream checkout whose CLIs record their argv.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { createFakeUpstream } from '../helpers/fake-upstream.mjs';
import { PACK_ROOT } from '../helpers/budget-harness.mjs';

const COPY = ['lib', 'scripts', 'plugins', 'templates', 'modes', 'interview', 'compat.json', 'package.json', 'install.mjs', 'update.mjs', 'AGENTS.student.md'];
const IDENT = {
  GIT_AUTHOR_NAME: 'Example Tester',
  GIT_AUTHOR_EMAIL: 'tester@example.com',
  GIT_COMMITTER_NAME: 'Example Tester',
  GIT_COMMITTER_EMAIL: 'tester@example.com',
};

export const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...IDENT } }).trim();

export function put(root, rel, text) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

// Every file under dir as {relative path: contents}, skipping .git except info/exclude, so two snapshots can be compared.
export function snapshot(dir, { skip = [] } = {}) {
  const out = {};
  const walk = (d) => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const abs = join(d, ent.name);
      const rel = relative(dir, abs).split('\\').join('/');
      if (skip.includes(rel) || rel === 'calls.jsonl') continue;
      if (rel === '.git') {
        const ex = join(abs, 'info', 'exclude');
        if (existsSync(ex)) out['.git/info/exclude'] = readFileSync(ex, 'utf8');
        continue;
      }
      if (ent.isDirectory()) walk(abs);
      else out[rel] = readFileSync(abs, 'utf8');
    }
  };
  walk(dir);
  return out;
}

export function makePack({ upstreamVersion = '1.38.0', checkout = true } = {}) {
  let root;
  let up = null;
  if (checkout) {
    up = createFakeUpstream({ version: upstreamVersion });
    root = up.root;
  } else {
    root = mkdtempSync(join(tmpdir(), 'not-career-ops-'));
  }
  const origin = mkdtempSync(join(tmpdir(), 'pack-origin-'));
  git(origin, 'init', '-q', '-b', 'main');
  for (const name of COPY) {
    const src = join(PACK_ROOT, name);
    if (existsSync(src)) cpSync(src, join(origin, name), { recursive: true });
  }
  put(origin, '.gitignore', 'node_modules/\n');
  git(origin, 'add', '-A');
  git(origin, 'commit', '-q', '-m', 'base');
  git(origin, 'tag', 'v0.1.0');
  const pack = join(root, 'student');
  git(root, 'clone', '-q', origin, pack);
  symlinkSync(join(PACK_ROOT, 'node_modules'), join(pack, 'node_modules'));

  const api = {
    root,
    up,
    origin,
    pack,
    git: (...a) => git(pack, ...a),
    head: () => git(pack, 'rev-parse', 'HEAD'),
    file: (rel) => join(pack, rel),
    read: (rel) => readFileSync(join(pack, rel), 'utf8'),
    // Commit a change on the origin repository and tag it; returns the commit sha.
    publish(mutate, message, tags = []) {
      mutate(origin);
      git(origin, 'add', '-A');
      git(origin, 'commit', '-q', '-m', message);
      for (const t of tags) git(origin, 'tag', t);
      return git(origin, 'rev-parse', 'HEAD');
    },
    // Previous plugin copy under plugins.local plus an enabled entry in config/plugins.yml.
    seedPlugin(id, patchManifest) {
      const dest = join(root, 'plugins.local', id);
      cpSync(join(pack, 'plugins', id), dest, { recursive: true });
      const mf = join(dest, 'manifest.json');
      const m = JSON.parse(readFileSync(mf, 'utf8'));
      writeFileSync(mf, `${JSON.stringify(patchManifest(m), null, 2)}\n`);
      put(root, 'config/plugins.yml', `plugins:\n  ${id}:\n    enabled: true\n`);
    },
    run(script, args = [], { timeout = 120000 } = {}) {
      const r = spawnSync(process.execPath, [join(pack, script), ...args, '--root', root], { cwd: root, encoding: 'utf8', timeout });
      const text = `${r.stdout ?? ''}${r.stderr ?? ''}`;
      return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', lines: text.split('\n').map((l) => l.trim()).filter(Boolean) };
    },
    upstreamCalls: () => (up ? up.calls() : []),
    cleanup() {
      for (const d of new Set([root, origin])) rmSync(d, { recursive: true, force: true });
    },
  };
  return api;
}

export const checkJson = (status, extra = {}) => `${JSON.stringify({ status, local: '1.38.0', ...extra })}\n`;
