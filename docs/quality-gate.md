# Quality gate for token levers

Every way of spending fewer model tokens (the levers T1 to T17, economy tier, job-text trim and batch size) ships
only when it is not worse than the version it replaces. The bars below were set before any measurement ran. They are
the same numbers as `lib/quality-bars.mjs`, and a test keeps the two equal.

## Bars

<!-- bars:start -->
| Bar | Key | Stated | A/A value | Effective |
| --- | --- | --- | --- | --- |
| Triage top-10 overlap with the baseline, at least | OVERLAP_MIN | 0.9 | not measured | 0.9 |
| Invented facts in any draft, at most | INVENTED_FACTS_MAX | 0 | not measured | 0 |
| Blind Opus judge says the lever is not worse, share of pairs at least | JUDGE_NOT_WORSE_MIN | 0.9 | not measured | 0.9 |
| Form-field accuracy drop below the base, at most | FORM_ACCURACY | 0 | not measured | 0 |
| Outcome classification accuracy drop below the base, at most | CLASSIFY_ACCURACY | 0 | not measured | 0 |
| Reply sorting accuracy drop below the base, at most | REPLY_SORT_ACCURACY | 0 | not measured | 0 |
| Scam false positives on legitimate postings, at most | SCAM_FP_MAX | 0.02 | not measured | 0.02 |
<!-- bars:end -->

| Setting | Key | Value |
| --- | --- | --- |
| Top-ranked postings compared for overlap | TOP_N | 10 |

Triage agreement (the share of postings given the same PASS, MARGINAL or FAIL word) is reported next to the overlap.

The three accuracy bars are the largest allowed drop below a base accuracy, so 0 means "not lower". Form-field
accuracy is measured against the expected field mapping of each mock form. The outcome classification and reply
sorting bars are measured against the agent path a rule lever replaces: the baseline capture runs the agent outcome
classifier on the labeled outcome mails and agent reply sorting on the labeled replies, and `noise` records the better
agent's accuracy as the base. A rule lever with no recorded base fails.

## Sample sizes

| Sample | Key | Size |
| --- | --- | --- |
| Postings for triage | postings | 60 |
| Cover letter pairs | cover_pairs | 12 |
| Outreach first message pairs | outreach_pairs | 12 |
| Reply suggestion pairs | reply_pairs | 12 |
| Mock application forms | mock_forms | 6 |
| Postings for the scam check | risk_postings | 30 |
| Labeled outcome mails | outcome_mails | 20 |
| Labeled replies | labeled_replies | 50 |

The samples are fake data in `tests/fixtures/quality/`, run on five fake student profiles: software-cs,
finance-economics, nursing, policy-government and mis-business-analytics. The draft pairs are spread over the five
profiles (3, 3, 2, 2 and 2 of each kind). The postings for the scam check ship with the scam rules in a later release.

## How pairs are judged

Each draft pair (baseline and lever) goes to a blind Opus judge in a random A/B order per pair. The order comes from a
seed recorded with the verdicts, so it can be rebuilt. The judge sees the fake student's resume and the input the
draft answers, says which draft is better or that they are equal, and counts invented facts. "Not worse" counts equal
and lever-better.

## Invented facts

An invented fact is any number, year, organization, credential or skill in a draft that the fake student's resume,
application answers and the input do not support. Each one counts once. The bar is zero for every lever.

## Noise floor

The baseline capture runs twice on the same sample (the A/A repeat) and the judge compares the two runs. Two runs of the
same prompt and model differ a little; that difference is the noise floor. `node tools/quality-baseline.mjs freeze`
writes the A/A value of each bar and the effective bar: the stated bar, moved to the A/A value only when the A/A value
is worse (a lower overlap or judge share, a wider accuracy spread). Invented facts and scam false positives never move.

## Mechanical features

A feature that changes no judged output (outreach hygiene, catch-up, follow-up timing, the batch page, saving job text,
pause) passes when the usage ledger shows zero added agent calls and its fixture tests pass.

## Control arm and model ids

The baseline records the resolved model id of every call. Each lever session first runs a lever-off control arm at the
model ids the runners resolve that day. When every resolved id equals its baseline id, the baseline is the comparison
base; otherwise the control arm is. Each verdict records the base and both id sets.

## Token estimate and stop rule

Before the first call each tool prints its estimate for Claude, Codex and the Opus judge from the measured per-row
constants. It sums real usage after every call and stops before the next one, exit 5 with a `blocked-on-user` line,
when real usage passes 1.5 times the estimate or a runner reports a quota or rate-limit error. A stopped capture stays
marked incomplete.

## Pinning

This file and `lib/quality-bars.mjs` are written once more by `freeze` and then pinned by sha256 in the baseline
manifest, with the captured commit and its release tag. They never change after a run; `tools/lever-ab.mjs` refuses
to run when either hash differs, and `node tools/quality-baseline.mjs verify` exits 3 naming any changed file.
