// Assumed: scripts/handshake-import.mjs exports
//   importPages({ pages, preset, config, knownTexts, today }) -> { lines: string[] }
//     pages: TSV strings with no header (id, company, title, location, age); knownTexts: texts of pipeline.md and
//     applications.md that may already hold ids (ids appear as .../jobs/<id>); age is like 3d, 2w, 2mo.
//   main(argv, deps) -> exit code with deps = { config, preset, out }; argv: <tsv files...> --out F --dry-run
//     --data-dir D --today T. Nothing touches the network.
// templates/handshake-extract.js carries {{TITLE_REGEX}} and {{MAX_PAGES}}.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { importPages, main } from '../../scripts/handshake-import.mjs';
import { CEILINGS } from '../../scripts/budget.mjs';
import { makeRoot, PRESET, TODAY, PACK_ROOT } from '../helpers/script-harness.mjs';

const CONFIG = { locations: ['TX', 'Remote'] };
const tsv = (...rows) => `${rows.map((r) => r.join('\t')).join('\n')}\n`;
const PAGE = tsv(
  ['9001', 'Example Robotics', 'Software Engineer Intern', 'Austin, TX', '3d'],
  ['9002', 'Sample Labs', 'Data Intern', 'Remote (US)', '2w'],
  ['9003', 'Sample Labs', 'Sales Intern', 'Austin, TX', '2d'],
  ['9004', 'Example Robotics', 'Software Engineer Intern', 'London, UK', '1d'],
  ['9005', 'Example Robotics', 'Platform Engineer Intern', 'Austin, TX', '2mo'],
  ['9006', 'Example Robotics', 'Barista', 'Austin, TX', '1d'],
  ['9007', 'Example Robotics', 'Backend Engineer Intern', 'Austin, TX', '5d'],
);
const URL = (id) => `https://app.joinhandshake.com/jobs/${id}`;

// M-004-S16
test('M-004-S16 fresh rows matching the preset title rules and locations become staging lines', () => {
  const { lines } = importPages({ pages: [PAGE], preset: PRESET, config: CONFIG, knownTexts: [], today: TODAY });
  assert.deepEqual(lines, [
    `- [ ] ${URL(9001)} | Example Robotics | Software Engineer Intern | Austin, TX | note: src=handshake; imported=${TODAY}; posted~3d`,
    `- [ ] ${URL(9002)} | Sample Labs | Data Intern | Remote (US) | note: src=handshake; imported=${TODAY}; posted~2w`,
    `- [ ] ${URL(9007)} | Example Robotics | Backend Engineer Intern | Austin, TX | note: src=handshake; imported=${TODAY}; posted~5d`,
  ]);
});

// M-004-S16
test('M-004-S16 ids already in pipeline.md or applications.md are skipped', () => {
  const known = [`## Pending\n- [ ] ${URL(9001)} | Example Robotics | Software Engineer Intern | Austin, TX\n`, `| 4 | 2026-09-01 | Sample Labs | Data Intern | 4.0/5 | Applied | n | [r](${URL(9002)}) | |\n`];
  const { lines } = importPages({ pages: [PAGE], preset: PRESET, config: CONFIG, knownTexts: known, today: TODAY });
  assert.deepEqual(lines.map((l) => l.split(' | ')[0].replace('- [ ] ', '')), [URL(9007)]);
});

// M-004-S16
test('M-004-S16 an id repeated across pages is staged once', () => {
  const { lines } = importPages({ pages: [PAGE, PAGE], preset: PRESET, config: CONFIG, knownTexts: [], today: TODAY });
  assert.equal(lines.length, 3);
});

// M-004-S16
test('M-004-S16 main appends to --out and --dry-run writes nothing', async () => {
  const r = makeRoot();
  try {
    const page = r.file('data/page1.tsv');
    writeFileSync(page, PAGE);
    r.write('data/pipeline.md', '## Pending\n\n');
    const out = r.file('data/pipeline.staging.md');
    const printed = [];
    const dry = await main([page, '--out', out, '--dry-run', '--root', r.root, '--data-dir', r.data, '--today', TODAY], { config: CONFIG, preset: PRESET, out: (s) => printed.push(s) });
    assert.equal(dry, 0);
    assert.ok(!r.exists('data/pipeline.staging.md'));
    assert.match(printed.join('\n'), /joinhandshake\.com\/jobs\/9001/);
    const real = await main([page, '--out', out, '--root', r.root, '--data-dir', r.data, '--today', TODAY], { config: CONFIG, preset: PRESET, out: () => {} });
    assert.equal(real, 0);
    const staged = readFileSync(out, 'utf8').split('\n').filter(Boolean);
    assert.equal(staged.length, 3);
    assert.ok(staged.every((l) => /note: src=handshake; imported=2026-10-27; posted~\w+$/.test(l)));
  } finally {
    r.cleanup();
  }
});

// M-004-S17
test('M-004-S17 the extract template fills with the preset regex and a page cap of 4 and holds no school text', () => {
  const template = readFileSync(join(PACK_ROOT, 'templates', 'handshake-extract.js'), 'utf8');
  assert.ok(template.includes('{{TITLE_REGEX}}'));
  assert.ok(template.includes('{{MAX_PAGES}}'));
  const cap = CEILINGS.pages_per_search_per_session.value;
  assert.equal(cap, 4);
  const regex = PRESET.title_rules.include.join('|');
  const filled = template.replaceAll('{{TITLE_REGEX}}', regex).replaceAll('{{MAX_PAGES}}', String(cap));
  assert.ok(filled.includes(regex));
  assert.ok(/\b4\b/.test(filled));
  assert.ok(!filled.includes('{{'));
  assert.ok(!/\b(university of|state university|college of|institute of technology)\b/i.test(template));
  assert.ok(/clipboard/i.test(filled));
  assert.ok(!/\.click\(|location\.(href|assign|replace)|window\.open|fetch\(|XMLHttpRequest/.test(filled));
});
