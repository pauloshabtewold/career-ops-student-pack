# Maintenance runbook

For the maintainer. Placeholders: the pack lives at `<pack-url>`; upstream is career-ops.

## Weekly slot (about 2 hours)

1. Open the canary pull request or issue from Monday's run.
2. Green canary: a pull request raises `compat.json` `upstream.max`. Read the upstream changelog link in it, merge if nothing in `cliContracts` changed. The monthly release workflow then cuts the next tag (see Releases).
3. Red canary: an issue names the failing job and links the changelog. Fix the pack or leave `upstream.max` where it is; students stay on the last supported version because `update.mjs` enforces the range.
4. Answer pilot feedback and review any preset audit issues.

## Releases

`release.yml` cuts the monthly release train. It runs at 07:11 UTC on the 2nd of each month and on `workflow_dispatch`, where the bump input is minor by default and a maintainer may choose patch or major.

- It skips the month when nothing has merged since the last `v<major>.<minor>.<patch>` tag.
- It releases only when `ci.yml` succeeded on the target commit, which covers the macOS and Windows jobs. The target is the newest commit on main that is not a changelog sync commit.
- It tags that commit, publishes notes from the first-parent commit subjects (a pull request merge is shown by its title), then commits the `CHANGELOG.md` section to main. CI does not run on that sync commit.
- The first release is `v` plus the `package.json` version; each later release raises the minor of the highest `v` tag. `package.json` is never rewritten.
- A plugin change needs a plugin manifest version bump in the same pull request. `scripts/check-plugin-versions.mjs` fails the pull request otherwise.

A commit subject that fails the pii-lint personal-data check cannot be edited once it is on main, so the notes show "(subject withheld: failed the personal-data check)" in its place and the release goes ahead. Review each withheld line in the published release and the `CHANGELOG.md` section; nothing needs rewording. If the generated notes still fail pii-lint after that substitution, the plan step stops and names the notes line number, never the matched text; fix the cause and rerun the release by `workflow_dispatch`.

When the gate reports `CI is not green` on the target commit, rerun `ci.yml` on main from the Actions tab, then dispatch the release.

## Safety tags

A `safety-*` tag is for a change that makes the pack safer for students: it may only tighten a limit in `scripts/budget.mjs` (lower a maximum, raise a minimum) or switch a default off. `safety-tag.yml` runs `scripts/check-safety-tag.mjs <tag>`, which compares the tag with its nearest earlier release or safety tag and fails on anything looser. When no earlier tag exists the check falls back to the first v tag, and it fails with a message to cut the first release when no v tag exists yet. Cut safety tags from the newest release tag so the diff holds only allowed files. Cut one when a platform changes its rules, a warning rate rises, or a limit proves too high. Students receive it on their next `node student/update.mjs`, which runs the same check before applying it.

## Changing `budget.mjs`

Any edit to `scripts/budget.mjs` needs `compat.json` `budgetSha256` updated in the same commit:

```
node scripts/compat-hash.mjs --write
node scripts/compat-hash.mjs --check
```

CI runs the check on both operating systems. Loosening a limit is a normal release, never a safety tag.

## Preset audits

On the first of each month `audit-presets.yml` audits every preset seed list with upstream's `audit-portals.mjs` and opens one issue per preset that has boards with no provider, errors, empty results or a halved posting count. `docs/preset-audit.md` holds the counts from the last manual authoritative audit; the monthly job never edits it. Owners and review dates are in `presets/OWNERS.yml`.

Resolving a preset's seeds: run `discover-ats.mjs` in preview mode against the preset's seed names, then research the enterprise ATS board URL (Workday, SuccessFactors, Oracle Cloud, iCIMS, Phenom, Eightfold, Taleo, Avature, SmartRecruiters) for each seed still unclaimed, and audit again. Keep a URL only when `audit-portals.mjs` then claims it.

Pass rule per named preset: no `error` and no `empty` board, 50 to 150 seeds, and `ok` plus `small` at least the preset's target share of its seeds. `TARGETS` in `tests/presets/preset-catalog.test.mjs` holds the targets: 70% by default, 40% for policy-government, and a documented lower entry (never below 50%) for a preset whose coverage note carries a watch-only sentence. A preset that cannot reach 50% is escalated to the maintainer. A seed edit updates the Seeds cell in the same change; the other cells wait for the next manual audit.

The 70% default clears every preset's baseline yet leaves room, about 30%, for marquee employers on custom portals no provider reads; 80% would leave consulting no room, and 60% would let 4 in 10 seeds automate nothing.

No-provider seeds stay because many employers, such as federal agencies and firms on an ATS the upstream scanner does not support, have no board it can read, and dropping them would cut the list below what students need to watch by hand. policy-government has the lower 40% target because most federal hiring runs through USAJOBS, the keyed source, and not through employer boards.

The same employer can appear in several presets, so a URL fix must be applied to every preset that lists it (grep by name); `tests/presets/seed-consistency.test.mjs` fails and names the employer and preset files when two presets disagree.

The monthly issues are expected to list the no-provider manual-watch seeds that each preset's allowance already covers. Act on `error`, `empty`, halved postings and no-provider shares above the allowance.

A preset not reviewed for 60 days is shown to students as unmaintained by the interview's coverage line. `mark-unmaintained.yml` makes that durable each Wednesday: when a preset's `last_reviewed` is more than 60 days old, or its open audit issue has had no maintainer comment for 60 days, it sets that preset's owner to `""` through a Mark presets unmaintained pull request. Only comments from the repository owner, members and collaborators count as a maintainer comment. After a review, restore the role and `last_reviewed` in `presets/OWNERS.yml`. Pull requests opened by the workflow token start no CI, so rerun CI from the pull request.

## Parity run

Before a release that changes triage, merge or ranking, run the harness on copies of a career-ops checkout:

1. Copy `tests/fixtures/parity/student.yml` to a directory outside this repository and set tracks and graduation dates to match the baseline clone's cycle. Mirror the baseline clone's local rules in the copied config: `judgment_keywords`, `audit.exclude_reasons`, `audit.require_triage`, `audit.keyword_match`, `audit.duplicate_reason`, `rank.company_caps`, `rank.intern_only`, `rank.one_track_per_company`, `rank.ignore_words`, `rank.contacts_format`, `rank.metro_match`, `rank.hold_on_pending_connect` and `parent_companies`. `audit.require_triage` is not part of the explanation; it only removes pack picks. Keep that copy outside this repository and delete it after the run. The harness refuses a config with no preset or no track.
2. Run `node tools/parity.mjs` with `--source`, `--scratch` and `--student-config` pointing outside this repository. It works on copies, deletes them when it finishes, and writes counts only to `docs/parity-report.md`. It exits 0 on pass or explained, 1 on a failed stage, stage error or crashed run, 2 on a usage error (nothing is created), 130 on SIGINT and 143 on SIGTERM, and removes the copies every time.

Some differences are by design. The harness derives an allowance for each from the run's own outputs and fails on any residual:

- merge-staging: the pack merge-post reviews Pending rows. The allowance is 2 x (flagged + joined) + dropped from its stats.
- rank-queue: both sides cap picks per company with different caps and weights, so the allowance covers swaps of postings inside companies that both sides pick. It also covers the carry-over: a baseline-only pick of a row that the pack merge-post moved out of Pending (to Flagged or dropped) is explained, keyed to the rows that left the pack Pending section during the merge-staging stage. A pick that only the pack lists is never explained this way, and a row that apply-triage moved out of Pending stays residual.
- fail-audit: the allowance applies the same reason predicate as the pick (`judgment_keywords`, `audit.keyword_match` and `audit.exclude_reasons`) to baseline-only rows, and covers title pre-filter rows.

The maintainer reviews the residual. It comes from rank-queue companies present on one side only, fail-audit pack-only rows from baseline exclusions not yet mirrored in `audit.exclude_reasons` and baseline-only rows the pack keywords match. With the knobs mirrored, the differences left to expect come from the score formula, marquee matching and the effort weight; metro matching agrees once `rank.metro_match` is mirrored.

Before reading prefilter counts, align the copied fixture's tracks and graduation dates with the baseline clone's cycle. The baseline prefilter computes its own cycle for the run date, while the pack reads the cycle file the harness writes. Otherwise the baseline and pack apply the term-not-in-cycle rule to different terms and prefilter shows residual that is not a pack bug.

## Upstream setup in CI

`scripts/ci/upstream-setup.mjs` builds the throwaway career-ops checkout. Pass `--resume <file>` to continue an interrupted setup.

## Upstream offers

Generic pieces of the pack are offered to career-ops issue-first. The draft issue bodies and the list of pack files to delete once upstream merges each piece are in [upstream/README.md](upstream/README.md). Drafts are posted by hand only; delete the listed files when upstream merges.

The optional big-tech feed for software-cs is not shipped: no vetted public list exists. The criteria for adding one and the trigger to revisit are in [upstream/bigtech-providers.md](upstream/bigtech-providers.md).
