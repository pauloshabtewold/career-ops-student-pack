// Assumed: lib/which.mjs exports which(name, { env, platform }) -> absolute path of the first match on env.PATH or null.
// On win32 PATH splits on ';' and only PATHEXT suffixes are tried (the bare name only when it already ends in one), so an
// extensionless npm shim never beats claude.cmd. Real files in scratch directories stand in for installs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, join } from 'node:path';
import { which } from '../../lib/which.mjs';

function scratch(layout) {
  const tmp = mkdtempSync(join(tmpdir(), 'which-'));
  const dirs = {};
  for (const [dir, files] of Object.entries(layout)) {
    dirs[dir] = join(tmp, dir);
    mkdirSync(dirs[dir]);
    for (const f of files) {
      if (f.endsWith('/')) mkdirSync(join(dirs[dir], f));
      else {
        writeFileSync(join(dirs[dir], f), '#!/usr/bin/env node\n');
        chmodSync(join(dirs[dir], f), 0o755);
      }
    }
  }
  return { dirs, cleanup: () => rmSync(tmp, { recursive: true, force: true }) };
}

// M-002-S33
test('M-002-S33 on win32 a dir holding an extensionless claude and claude.cmd resolves to claude.cmd', () => {
  const s = scratch({ npm: ['claude', 'claude.cmd'] });
  try {
    const hit = which('claude', { env: { PATH: s.dirs.npm, PATHEXT: '.COM;.EXE;.BAT;.CMD' }, platform: 'win32' });
    assert.equal(basename(hit).toLowerCase(), 'claude.cmd');
    assert.equal(hit.startsWith(s.dirs.npm), true);
  } finally {
    s.cleanup();
  }
});

// M-002-S33
test('M-002-S33 on win32 a shim-only dir ahead of a claude.cmd dir never returns the shim', () => {
  const s = scratch({ first: ['claude'], second: ['claude.cmd'] });
  try {
    const hit = which('claude', { env: { PATH: [s.dirs.first, s.dirs.second].join(';') }, platform: 'win32' });
    assert.equal(basename(hit).toLowerCase(), 'claude.cmd');
    assert.equal(hit.startsWith(s.dirs.second), true);
    assert.equal(which('claude', { env: { PATH: s.dirs.first }, platform: 'win32' }), null);
  } finally {
    s.cleanup();
  }
});

// M-002-S33
test('M-002-S33 on win32 a name that already ends in a PATHEXT suffix is tried as given', () => {
  const s = scratch({ bin: ['tool.exe'] });
  try {
    const hit = which('tool.exe', { env: { PATH: s.dirs.bin }, platform: 'win32' });
    assert.equal(basename(hit).toLowerCase(), 'tool.exe');
  } finally {
    s.cleanup();
  }
});

// M-002-S27
test('M-002-S27 on posix the first PATH dir holding a file wins and a directory of that name is skipped', () => {
  const s = scratch({ a: ['claude/'], b: ['claude'], c: ['claude'] });
  try {
    const env = { PATH: [s.dirs.a, s.dirs.b, s.dirs.c].join(delimiter) };
    assert.equal(which('claude', { env, platform: 'linux' }), join(s.dirs.b, 'claude'));
    assert.equal(which('missing-tool', { env, platform: 'linux' }), null);
    assert.equal(which('claude', { env: { PATH: '' }, platform: 'linux' }), null);
  } finally {
    s.cleanup();
  }
});
