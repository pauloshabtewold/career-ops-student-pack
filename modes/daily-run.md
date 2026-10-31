# Daily run, model half

`scripts/daily.mjs` in the student folder does the zero-token half on its own. When `automation` is `scheduled-discovery-plus-triage`, the installed schedule then runs `scripts/daily-triage.mjs`: one agent call per chunk of 20 rows, each with no tools (a `claude -p` call, or a read-only `codex exec` call, by the `agent` key in config), that scores up to the student's daily triage budget of untriaged Pending rows (default 20, or "all") and applies the verdicts through `apply-triage.mjs`. It appends its triaged, passed and ignored counts and a cost line (an estimate) to the digest, and a missing agent, a timeout or a sign-in problem becomes a digest note and changes nothing. This file covers what stays in a session the user opens: the fail audit and the inbox, plus any triage the scheduled run could not do. Each step below runs only when its switch allows it.

## Switches

| Step | Runs when |
| --- | --- |
| Triage of new rows | `automation` is `scheduled-discovery-plus-triage`; `daily-triage.mjs` does it, and a session also does it when the digest says the scheduled triage was skipped |
| Triage on request | the student asks for triage in a session, under any `automation` value; at most the rows left from `node student/scripts/triage-budget.mjs status`, logged with `triage-budget.mjs log` |
| Weekly fail audit | `automation` is `scheduled-discovery-plus-triage` and today is a Sunday |
| Digest additions | always, after the steps above |

## Steps

1. Read the digest. If it lists failed steps, add them to the final report and do not retry them.
2. Triage: take the Pending rows that have no `triage=` note and run the triage mode on them, on the standard model tier at minimum. Run `node student/scripts/triage-budget.mjs status` and triage at most the rows left today, then apply the verdicts with `node student/scripts/apply-triage.mjs` and run `node student/scripts/triage-budget.mjs log <n>` with the number of rows applied.
3. Weekly fail audit: on Sundays re-read 20 rows that triage failed. Record any that were wrongly failed with `node student/scripts/fail-audit.mjs apply <results.txt>` and report them.
4. Inbox: follow `modes/inbox.md` when the mail backend is `connector` or `paste`.
5. Append to the digest: rows triaged, rows passed, the audit result and the inbox summary. Counts only; no mail text.

## Limits

- Do not open a browser for discovery. The liveness sweep already ran API-only.
- Do not send messages or submit applications from this run. Outreach and the apply loop have their own modes and their own approval rules.
