# What to say to career-ops

Everything career-ops itself does works when asked in plain words. Say any phrase below in a session opened in your career-ops folder. Each line ends with the file the agent reads to do it. This is the one list of phrases, and saying help any time shows it again.

## Daily use

- "help" or "what can you do": shows this guide (`AGENTS.student.md`).
- "what ran today" or "daily run": reads the morning digest and what the schedule ran (`modes/daily-run.md`).

## Applying

- "apply" or "start applying": picks today's list and fills the forms in batches of 3, never submitting on its own (`modes/apply-loop.md`).
- "read my kept-out postings": reads the application form of each posting the digest kept out, so the next run can plan it (`modes/apply-loop.md`).
- "submit all" or "submit 1,3": submits only the numbered forms you name (`modes/apply-loop.md`).
- "change a saved answer": changes one saved answer, such as work authorization or an EEO item (`AGENTS.student.md`).

## Outreach

- "outreach": drafts today's outreach batch for you to approve: connection requests, warm first messages, replies, follow-ups and the one email per application (`modes/outreach.md`).
- "follow up with <Company> at <email>": gives the address for an application follow-up that is waiting for one, and adds it to today's batch (`modes/outreach.md`).
- "send all" or "send 1,4,7": sends only the numbered messages you name (`modes/outreach.md`).
- "drafts only": switches outreach from `on` to drafts, so nothing is sent (`AGENTS.student.md`). It only lowers the switch: from `off`, edit `switches.outreach: drafts` in `config/student.yml` yourself.
- "stop outreach": turns outreach off until you edit the file (`AGENTS.student.md`).

## Inbox

- "check my inbox" or "check my mail": reads alert emails and company replies now (`modes/inbox.md`).
- "turn off the inbox pass": stops the scheduled inbox pass (`modes/inbox.md`).

## Settings

- "redo my setup", "set me up" or "personalize": runs the four-part interview again (`interview/interview.md`).
- "find more job sources": researches job lists and boards for your field again (`AGENTS.student.md`).
- "change my schedule" or "check my schedule": changes the time, or proves the schedule works (`AGENTS.student.md`).
- "check my schedule's Chrome": runs the schedule probe again when the last one could not tell whether a scheduled run reaches the automation Chrome (`AGENTS.student.md`).
- "pause my schedule" or "resume my schedule": stops scheduled runs and keeps the schedule, then turns them back on (`AGENTS.student.md`).
- "remove my schedule": uninstalls the schedule (`AGENTS.student.md`).
- "change my triage budget": shows the cost estimate before changing the number of rows scored (`AGENTS.student.md`).
- "update the pack": updates the pack and career-ops together (`AGENTS.student.md`).
- "Handshake pass": runs the Handshake saved-search pass (`modes/handshake.md`).
- "stop handshake": turns the Handshake pass off (`AGENTS.student.md`).

## Help

If a phrase does nothing, say "what ran today" to see what failed (`modes/daily-run.md`), or read docs/usage.md. Passwords, sign-ins and CAPTCHAs always stay with you.

## What runs on its own

At the schedule time each day the daily run reads job lists and employer boards and scans for new postings, then the inbox pass reads alert emails and company replies, then triage scores new rows. The results are in the morning digest. Nothing is applied for you, nothing is sent without your "send all" or "send 1,4,7" (`modes/outreach.md`), and Gmail is read-only.
