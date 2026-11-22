# Outreach

Read this when the user says "outreach", and in the first session of the day. It only applies while `switches.outreach` is `on` (drafts mode is below).

## One round per day

Run `node student/scripts/outreach-drafts.mjs` once a day. It drafts one round from `node student/scripts/outreach-state.mjs due`: connection requests, warm openers to new accepts, replies, referral asks where they are due, and the one follow-up per application, then writes them as one-page batches in `data/batches/`. Pass the replies you read today with `--replies <file>` (JSON list of name, company and text). Size the round to the smaller of the daily and weekly remainders (`node student/scripts/budget.mjs status`). Never loop to draft a second batch the same day.

## Warm first

The first message gets to know the person: one specific, true reason for reaching out and one short question about their work. It never asks for a referral or a job. A referral ask is drafted only after two exchanges and only while their company has an open posting; `outreach-state.mjs` recommends it.

## Replies

Every incoming reply gets a suggested answer drafted by the model. When lever T6 has a pass verdict, plain code sorts replies first: a thanks or a no needs no AI draft and is only listed; only replies that need an answer get one.

## Who to contact

Only people who currently work at the company full time. Never interns, co-ops, part-time students, or anyone marked `do-not-contact`. One contact per company at a time, up to 3 per company over time.

## Hygiene

`budget.mjs` refuses, and the round skips: a second first message to someone who never replied, a new contact at a company that already has an active one, a second connection request to the same person, any message after a no (`node student/scripts/budget.mjs log linkedin.declined --target "<name>" --company "<company>"`), and any message after the one follow-up went unanswered. Log each reply you read with `node student/scripts/budget.mjs log linkedin.reply --target "<name>" --company "<company>"`. When a connection request shows as accepted, log it with `node student/scripts/budget.mjs log linkedin.accept --target "<name>" --company "<company>"` and add an `accepted` row to `data/contacts.tsv`. An accepted contact, or one you are messaging or who replied, keeps their company however old the request is; only a request that is withdrawn or 3 weeks old with none of these frees the company.

## Conversation threads

Each contact's conversation is kept as plain text in `data/threads/<name>-<company>.txt`, in the student's data folder only. Emails sent through Gmail and replies passed to `outreach-drafts.mjs` are saved there on their own. After you send and log a LinkedIn message, save its text with `node student/scripts/outreach-state.mjs archive --target "<name>" --company "<company>" --direction sent --text-file <file>`; save a LinkedIn reply you read the same way with `--direction received`.

## Follow-ups on applications

Each submitted application gets one follow-up 7 to 10 days after its submit, in the next approved outreach batch, always as an email.

## Sending

1. Show the batch page with `node student/scripts/batch.mjs show <batch-id>`. The user answers "send all", "send 1,4,7" or "all except 3". Record it with `node student/scripts/batch.mjs approve <batch-id> "<the user's words>"`.
2. For each approved item run the check with that item's ids, for example `node student/scripts/budget.mjs check linkedin.connect --pending <N> --target "<name>" --company "<company>" --length <chars> --batch-id <batch-id> --item <n>`, where N is the pending invite count read from the sent-invitations page. Exit 4 means wait until the printed time. Exit 3 ends that action type for today, or skips that one person when the line names them.
3. Send, verify on the page, then `node student/scripts/budget.mjs log <action> --target "<name>" --company "<company>" --approval "send all" --batch-id <batch-id> --item <n>`.
4. A follow-up is checked twice with the same ids before it goes out: `node student/scripts/budget.mjs check apply.followup --target "<application url>" --batch-id <batch-id> --item <n>`, then the email check (`gmail.send --target "<application url>" --email "<address>" --followup`). Log both after the send. `lib/gmail-chrome.mjs` runs both checks and both logs for you.
5. Connection notes must fit the tier limit after the name is filled in (200 characters free, 300 Premium). Openers stay under 300 characters.
6. One nudge, after 5 to 7 days without a reply. Never a second.
7. Pending invites older than 3 weeks are withdrawn: `node student/scripts/budget.mjs due-withdrawals` lists them. Log each with `node student/scripts/budget.mjs log linkedin.withdraw --target "<name>" --company "<company>"`. A withdrawn or 3-week-old unaccepted invite ends that contact, so the company is open for a new one.

## Gmail path

Email goes through the automation Chrome only: `lib/gmail-chrome.mjs` composes and sends one approved item after `gmail.send` passes, and sends nothing when a check exits 3. An email is checked and logged with the contact's name as `--target` and the address as `--email` (add `--nudge` for that contact's one follow-up), so the same rules hold by email as on LinkedIn: one first message per person, one follow-up, nothing after a no, and one active contact per company. An application follow-up email instead takes the application url as `--target` and adds `--followup`: it is no outreach contact, so those person rules skip it and it goes out once per application. The Gmail connector tools stay read-only for every agent; never send, reply or draft through them.

## Stop conditions

On any warning, CAPTCHA or weekly-limit notice from LinkedIn, stop LinkedIn for the day, run `node student/scripts/budget.mjs warning linkedin`, and tell the user in one line.

Next: approve today's outreach batch
Type: send all, or all except 3
Why: nothing is sent until you approve it, and warm first messages build the contacts that lead to referrals.
You can always ask me for more. Just ask and approve.

## Drafts mode

When `switches.outreach` is `drafts`, write every drafted message, numbered with contact, company and character count, to `data/outreach/drafts-YYYY-MM-DD.md` in the student folder, put item 1 on the clipboard, and tell the user the file path. Never point the user at a temp or scratchpad path. Profile views for research are still allowed; sends are not.
