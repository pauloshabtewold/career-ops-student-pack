#!/usr/bin/env node
// Shows and saves the application answers that forms ask for again and again (config/profile.yml, application_answers),
// so apply mode fills them from one place and asks the student only for what is missing.
// Usage: profile-answers.mjs show [--json] | set <key> <value> [--root R]
//   keys: work_authorization, requires_sponsorship (yes|no), start_date (YYYY-MM|immediately), relocation
//   (yes|no|within-locations), how_did_you_hear, eeo.gender, eeo.race_ethnicity, eeo.hispanic_latino, eeo.veteran,
//   eeo.disability, eeo.pronouns, eeo.sexual_orientation, eeo.transgender (a value, or decline). The EEO values are voluntary and are never copied anywhere else.
// Exit 0 on success, 1 when config/profile.yml does not exist or does not parse, 2 for an unknown key or a bad value.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { UsageError, parseArgs, runCli, isMain } from '../lib/args.mjs';
import { CANONICAL_KEYS, ProfileAnswerError, ProfileParseError, blank, mergeProfileAnswers, needsConfirmation, patchFor, readProfileAnswers, validateAnswer, valueAt } from '../lib/profile-answers.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { writeAtomic } from '../lib/tsv.mjs';

const MISSING = 'run the interview first: config/profile.yml does not exist';

// Saved answers as 'key: value' pairs in canonical order; eeo items appear as eeo.<item>.
function savedPairs(answers) {
  return CANONICAL_KEYS.map((key) => [key, valueAt(answers, key)]).filter(([, value]) => !blank(value));
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  const { command, positionals, flags } = parseArgs(argv, { commands: ['show', 'set'], flags: {} });
  const print = deps.out ?? ((l) => console.log(l));
  const paths = resolvePaths({ root: flags.root });
  const file = join(paths.configDir, 'profile.yml');
  if (!existsSync(file)) {
    print(MISSING);
    return 1;
  }
  try {
    if (command === 'show') {
      const answers = readProfileAnswers(paths.root);
      const needs = needsConfirmation(answers);
      if (flags.json) print(JSON.stringify({ answers, needs_confirmation: needs }));
      else {
        for (const [key, value] of savedPairs(answers)) print(`${key}: ${value}`);
        print(`needs_confirmation: ${needs.length ? needs.join(', ') : 'none'}`);
      }
      return 0;
    }
    if (positionals.length !== 2) throw new UsageError('usage: profile-answers.mjs set <key> <value>');
    const [key, raw] = positionals;
    let value;
    try {
      value = validateAnswer(key, raw);
    } catch (err) {
      if (err instanceof ProfileAnswerError) throw new UsageError(err.message);
      throw err;
    }
    writeAtomic(file, mergeProfileAnswers(readFileSync(file, 'utf8'), patchFor(key, value)));
    print(`saved ${key}`);
    return 0;
  } catch (err) {
    if (!(err instanceof ProfileParseError)) throw err;
    print(`config/profile.yml does not parse: ${err.message}; fix it or move it aside`);
    return 1;
  }
}

if (isMain(import.meta.url)) await runCli(() => main());
