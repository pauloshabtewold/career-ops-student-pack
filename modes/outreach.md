# Outreach

Read this in the first session of the day, or when the user asks for outreach. It only applies while `switches.outreach` is `on` (drafts mode is below).

## One round per day

Prepare a single batch in one message: connection requests with notes, warm openers to new accepts, referral asks, replies and nudges. Size it to the smaller of the daily and weekly remainders (`node student/scripts/budget.mjs status`). Never loop to draft a second batch the same day.

## Who to contact

Only people who currently work at the company full time. Never interns, co-ops, part-time students, or anyone marked `do-not-contact`. Up to 3 contacts per company.

## Sending

1. Show the batch numbered. The user answers "send all" or "send 1,4,7".
2. For each item run `node student/scripts/budget.mjs check linkedin.connect --pending <N> --target "<name>" --company "<company>" --length <chars>`, where N is the pending invite count read from the sent-invitations page. Exit 4 means wait until the printed time. Exit 3 ends that action type for today.
3. Send, verify on the page, then `budget.mjs log <action> --target "<name>" --company "<company>" --approval "send all"`.
4. Connection notes must fit the tier limit after the name is filled in (200 characters free, 300 Premium). Openers stay under 300 characters.
5. One nudge, after 5 to 7 days without a reply. Never a second.
6. Pending invites older than 3 weeks are withdrawn: `budget.mjs due-withdrawals` lists them.

## Stop conditions

On any warning, CAPTCHA or weekly-limit notice from LinkedIn, stop LinkedIn for the day, run `node student/scripts/budget.mjs warning linkedin`, and tell the user in one line.

## Drafts mode

When `switches.outreach` is `drafts`, put each message on the clipboard for the user to paste and send themselves. Profile views for research are still allowed; sends are not.
