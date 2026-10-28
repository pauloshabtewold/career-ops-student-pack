# Daily run, model half

`scripts/daily.mjs` in the student folder does the zero-token half on its own. This file is the template for the optional second half, which runs only in a session the user opens or schedules themselves, after `daily.mjs` has written the digest file student-<date>.md in the data digest folder. Each step below runs only when its switch allows it.

## Switches

| Step | Runs when |
| --- | --- |
| Triage of new rows | `automation` is `scheduled-discovery-plus-triage` |
| Weekly fail audit | `automation` is `scheduled-discovery-plus-triage` and today is a Sunday |
| Digest additions | always, after the steps above |

## Steps

1. Read the digest. If it lists failed steps, add them to the final report and do not retry them.
2. Triage: take the Pending rows that have no `triage=` note and run the triage mode on them, on the standard model tier at minimum. Pipe the verdicts to `node student/scripts/apply-triage.mjs`. Stop at the daily triage cap from `budget.mjs`.
3. Weekly fail audit: on Sundays re-read 20 rows that triage failed. Record any that were wrongly failed with `node student/scripts/fail-audit.mjs apply <results.txt>` and report them.
4. Inbox: follow `modes/inbox.md` when the mail backend is `connector` or `paste`.
5. Append to the digest: rows triaged, rows passed, the audit result and the inbox summary. Counts only; no mail text.

## Limits

- Do not open a browser for discovery. The liveness sweep already ran API-only.
- Do not send messages or submit applications from this run. Outreach and the apply loop have their own modes and their own approval rules.
