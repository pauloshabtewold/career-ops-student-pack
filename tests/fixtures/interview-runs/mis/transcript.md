# SYNTHETIC FIXTURE: recorded agent-driven personalization interview (set mis)

Resume: tests/fixtures/resumes/mis.md | Persona: tests/fixtures/answers/mis.json
Preset set: software-cs, mis-business-analytics, finance-economics, accounting, engineering-mech-elec, policy-government, consulting, cybersecurity, marketing-business, statistics-math-actuarial, supply-chain-operations, nursing, byo-employer-list (snapshot 1e38ac4)

Run date: 2026-10-29. Invented person, school and employers; test data only. Script: interview/interview.md, Parts A to D. Commands ran against the pack snapshot; sign-ins, plugin enables and the live agent runs are recorded as a fixture would show them.

## Part A: sign-ins

INTERVIEWER: I read cv.md first, so I will only ask about what it does not cover. Before anything else, here are the sign-ins, in one batch. Reply "all recommended" or "ok" to accept every default, or change only some, for example "3: skip".

1. Gmail connector. Does: lets the daily inbox pass read job-alert emails and company replies with read-only tools, so they reach your queue and tracker without a session. (recommended) connect it: it is the only way replies arrive unattended. Other: skip, and paste mail by hand later.
2. LinkedIn in the browser. Does: needed for outreach and LinkedIn pages. (recommended) sign in while outreach is on: the risks and the switches come in Part D. Other: skip, and outreach stays off.
3. Handshake in the browser. Does: needed for the Handshake pass and its saved-search alerts. (recommended) sign in: campus-only postings are on no public list. Other: skip.
4. Simplify and Indeed. Does: free accounts whose alert emails add postings; you create them yourself. (recommended) skip for now: LinkedIn and Handshake alerts cover most postings, and you can add these any time.
5. GitHub. Does: the pack reads public job lists. (recommended) nothing to do: no account is needed.

In Claude Code, connect Gmail in your claude.ai connector settings and confirm it with /mcp. Do all the sign-ins yourself in the browser; I never ask for a password. Tell me when you are done and I will check them all in one go.

STUDENT: All recommended. Gmail is connected, and I signed in to LinkedIn and Handshake. I skipped Simplify and Indeed.

INTERVIEWER: Checking all of them now. A Gmail search for newer_than:2d ran in this chat with the read tools. `node student/scripts/inbox-pass.mjs --check --agent claude` printed: inbox pass check: ok (claude, Gmail read tools only). The LinkedIn and Handshake pages show a signed-in session. Recorded signins: gmail ok, linkedin ok, handshake ok, simplify skipped, indeed skipped.

## Part B: your job queue

INTERVIEWER: Next is your job queue: every posting open to you now or later, with no grades and no top picks. First, a batch about you. Reply "all recommended" or "ok" to accept every default, or change only some, for example "7: 2". From cv.md I propose these target roles: Business analyst and Technology consulting analyst.

1. Resume. personal, no default. Does: every later step reads it. cv.md is already here, so I will use it.
2. Field or major. Does: picks the job lists and employer boards to read. (recommended) the field detected from your resume, because it matches your own words; say another major to override.
3. Tracks and graduation month. personal, no default. Does: internship, co-op or new grad, each with its graduation month, so postings match your cycle.
4. Locations in order of preference. personal, no default. Does: filters postings to places you would work.
5. US citizen. personal, no default. Does: citizens keep postings that ask for clearance or citizenship; for everyone else the filters drop them.
6. Target roles. Does: short phrases that shape the title filters. (recommended) proposed from your resume, because each one is grounded in it.
7. Years of experience. Does: drops roles above your level. (recommended) 0, the right value for most students.
8. Time zone. Does: sets when the daily run fires. (recommended) this computer's time zone, because that is where it runs.
9. GitHub job lists. Does: reads public internship and new-grad lists (the `github-lists` plugin; show its capability card). (recommended) on: they are the widest free source of postings.

STUDENT: 1: use cv.md. 2: management information systems and business analytics, as detected. 3: new grad track, graduation 2027-05. 4: Chicago, IL; Remote. 5: Yes. 6: keep your proposal. 7: 0. 8: America/New_York. 9: yes. All the rest as recommended.

INTERVIEWER: Detected field: management information systems and business analytics; I used the mis-business-analytics preset. I ran `node student/interview/apply-answers.mjs data/interview-answers.json --stage queue`: it wrote config/student.yml, portals.yml, data/student-github-sources.json and data/student-cycle.json. Then I searched the web for management information systems and business analytics job lists and employer boards (3 web searches), wrote data/research-candidates.json and ran `node student/scripts/research-sources.mjs`:

research: added 2 boards, 1 GitHub lists
added: Example Advisory LLP (board, greenhouse, 10 postings)
added: Sample Analytics Group (board, ashby, 6 postings)
added: example-analyst-newgrad (GitHub list, 6 matching rows)
skipped: Example Consulting Houses: no supported public board, check by hand
skipped: example-lists/biz-2025: 4 matching rows, needs 5
cost: 22 requests, 33.9 s, 3 web searches in this chat; no model call in this script

I showed the GitHub-lists capability card and enabled it with --confirm, as you agreed. Now the alerts, from `node student/scripts/alert-plan.mjs`. Reply "all recommended" or "ok" to accept the recommended items, "do it for me" to have me open the pages, or "4: skip" to change only item 4.

1. LinkedIn job alert (recommended): LinkedIn emails you new postings that match your search every day.
   why: alert emails cover every field, including employers with no readable board
   open: https://www.linkedin.com/jobs/search/?keywords=Business%20analyst%20new%20grad&location=Chicago%2C%20IL&f_E=2
   then press: Set alert
2. Handshake saved search (recommended): Handshake emails you new postings from employers recruiting at your school.
   why: it holds campus-only postings that no public list carries
   open: https://app.joinhandshake.com/job-search?query=Business%20analyst%20new%20grad
   then press: Save search, then turn on email alerts
3. Simplify saved search (optional): Simplify emails you new postings and tracks the ones you apply to.
   why: strongest for software, data and business; needs a free account you create yourself
   open: https://simplify.jobs/jobs?query=Business%20analyst%20new%20grad
   then press: Save search, then turn on email alerts
4. Indeed email alert (optional): Indeed emails you new postings from a very wide set of employers.
   why: wide coverage but more noise, so add it only if the first alerts leave gaps
   open: https://www.indeed.com/jobs?q=Business%20analyst%20new%20grad&l=Chicago%2C%20IL
   then press: Get new jobs by email

STUDENT: Do it for me. I will press the buttons for 1 and 2 and skip 3 and 4.

INTERVIEWER: I opened the LinkedIn and Handshake pages and both alerts show as saved. I ran the inbox step in this chat: inbox: alerts staged 3 (employer 0, handshake 1, need a link 2). Now the queue. `node student/scripts/first-run.mjs --queue` ran in the foreground (about 10 minutes) and printed:

queue: 132 postings waiting
source github-lists: 118
source scan: 14
newest:
Example Advisory LLP | Business Analyst | Chicago, IL
Sample Analytics Group | Technology Consulting Analyst | Remote
Placeholder Systems | Systems Analyst | Chicago, IL
Example Retail Co | Business Analyst Rotational Program | Chicago, IL
Sample Insurance Group | Data Analyst | Remote
Example Health Partners | IT Analyst | Chicago, IL
Placeholder Consulting | Associate Consultant | Chicago, IL
Sample Logistics Inc | Business Systems Analyst | Remote
Example Bank Services | Technology Analyst | Chicago, IL
Placeholder Software | Implementation Analyst | Remote
Upcoming and check by hand:
- Example Consulting Houses https://careers.example.com/consulting (upcoming)

That is the raw queue, with no grades or top picks. Coverage, from `node interview/coverage.mjs mis-business-analytics --today 2026-10-29`, exactly as returned: "MIS, information systems, business analytics [semi-automated]: Semi-automated: nothing is MIS-specific, so analyst lists plus title rules feed the queue, and the employer list below carries consulting and rotational programs."

## Part C: application profile

INTERVIEWER: Now the answers forms ask for again and again. Reply "all recommended" or "ok" to accept every default, or change only some, for example "4: immediately". Items marked personal, no default need an answer. The six EEO items have no recommended value, so "all recommended" does not cover them; answer each with a value or "decline" (stored as decline, shown as "decline to self-identify").

1. Identity. personal, no default. Does: fills your details on forms. From your resume I have name Riley Sampleton, email riley.sampleton@example.edu, phone 415-555-0141; correct any, or say skip for city, LinkedIn and GitHub.
2. Work authorization. personal, no default. Does: answers "are you authorized to work" in the student's words, for example "F-1 with OPT" or "US citizen".
3. Needs sponsorship. personal, no default. Does: answers the sponsorship question: yes or no.
4. Start date. Does: answers "when can you start". (recommended) the month after graduation as `YYYY-MM`, because it matches your track. Other: `immediately`.
5. Relocation. Does: answers "willing to relocate". (recommended) `within-locations`, because it keeps you to the places you named. Other: `yes`, `no`.
6. How did you hear about us. Does: fills that box. (recommended) "Online job search", because it is true for every posting the pack finds.
7. Resume variants. Does: names one resume per track with a page limit. (recommended) one page per track, because that is what recruiters read. The files themselves stay under the student's control.
8. Priority companies, blacklist, dealbreakers and target employers. Does: ranks, hides or adds employers (dealbreakers are phrases such as "unpaid" or "on-site only outside my metros"). (recommended) none now, because Part B already added employers for your field; add them any time.
9. Gender. personal, no default. Does: fills the gender question on forms.
10. Race or ethnicity. personal, no default. Does: fills that question.
11. Hispanic or Latino. personal, no default. Does: fills that question.
12. Veteran status. personal, no default. Does: fills that question.
13. Disability status. personal, no default. Does: fills that question.
14. Pronouns. personal, no default. Does: fills that question.

STUDENT: 1: correct, skip the rest. 2: US citizen. 3: No sponsorship needed. 4: 2027-06. 5: within-locations. 6: Professor referral. 7: mis-main, one page. 8: priority Example Advisory LLP; blacklist Example Staffing Group; dealbreakers commission[- ]only; target employers: Example mis Target 1 (https://careers.example.com/mis/1), Example mis Target 2 (https://careers.example.com/mis/2). 9: Woman. 10: White. 11: Yes. 12: decline. 13: decline. 14: she/her.

INTERVIEWER: Recorded in the answers file: name Riley Sampleton, work authorization "US citizen", needs sponsorship no, resume variant mis-main (1 page), start date 2027-06, relocation within-locations, how did you hear "Professor referral", gender Woman, race or ethnicity White, hispanic or latino Yes, veteran status decline to self-identify, disability status decline to self-identify, pronouns she/her.

## Part D: schedule and switches

INTERVIEWER: Before the switches, a disclaimer I read once, word for word: This pack is not affiliated with or endorsed by LinkedIn, Handshake, career-ops or any employer. You are responsible for following the terms of every site you use it with. LinkedIn and Handshake automation can lead to limits or restrictions on your accounts; both are on by default and each can be switched off at any time ("stop outreach", "stop handshake"). The software comes with no warranty of any kind (MIT license).

INTERVIEWER: Two disclosures before I ask. First: LinkedIn outreach. LinkedIn's terms restrict automated activity, and the status of an assistant that drafts and sends messages in the student's own signed-in browser is ambiguous. It can put the account at risk. Outreach is therefore capped by hard limits, never runs unattended, and can be set to `on`, `drafts` (drafts only, the student sends) or `off`. At any time the student can say "stop outreach" and it ends for good until they say otherwise.

INTERVIEWER: Second: Handshake. Handshake's terms are ambiguous about automated browsing in the same way. The Handshake pass is on by default and can be turned off; "stop handshake" ends it at once.

INTERVIEWER: Now the last batch. Reply "all recommended" or "ok" to accept every default, or change only some, for example "5: 9am". These defaults never loosen a safety limit: nothing is submitted without your yes, Gmail stays read-only and the budget caps stay.

1. Automation. Does: what runs by itself each day. (recommended) `scheduled-discovery-plus-triage`, because it finds and scores postings while you are away; it needs the chosen agent signed in on this computer. Other: `manual`, `scheduled-discovery`.
2. Time. Does: when the daily run starts, in your time zone. (recommended) 06:00, because the queue is ready before your day starts.
3. Inbox pass. Does: runs after the daily run with Gmail read tools only, stages alert jobs and reads company replies; each run costs about 15,000 tokens on a typical day and at most about 60,000 (docs/usage-cost.md, "The inbox pass"). (recommended) on, because the Part A check passed, automation is not `manual` and the mail path is `connector`.
4. Model tier. Does: the model quality for triage. (recommended) `standard`, because it is the lowest tier that judges postings well. Other: `premium`. There is no economy tier.
5. Plan. Does: only sets the wording of the cost estimates. (recommended) `unknown`; or name your plan: `claude-pro`, `claude-max`, `claude-ultra`, `chatgpt-plus`, `chatgpt-pro` or `api`.
6. Triage budget. Does: caps the rows scored by the model: daily and on the first run. (recommended) 20 a day and 60 on the first run, because they keep a normal plan well inside its limits. Other: any whole number or "all". For each value above its default, run `node student/scripts/triage-budget.mjs cost <n|all> --plan <plan> --agent <agent> --spend-tier <standard|premium>` and show the printed cost line, an estimate, before accepting it. Record `triage_budget.daily` and `triage_budget.first_run` only when they differ from the defaults.
7. Daily target. Does: applications you aim to prepare a day. (recommended) 10; the ceiling still applies.
8. Mail path. Does: how mail is read. (recommended) `connector`, because only it runs unattended. Other: `paste`, `gmail-plugin`.
9. Outreach. Does: one daily round drafts and sends at most the capped connection requests and messages, and every send needs your "send all" or "send 1,3". (recommended) `on`, because the caps and your approval keep it safe. Other: `drafts` (the cautious option: drafts only, you send), `off`.
10. Handshake pass. Does: reads your Handshake saved searches. (recommended) `on`. Other: `off`.
11. Who presses submit. Does: decides who submits applications. (recommended) `user`, because nothing is submitted without your yes. Other: `agent`.
12. LinkedIn account tier. Does: sets the connection-request limit. (recommended) `free`. Other: `premium`.

Below the limits table, say this once: the pack's ceilings (daily applications, connection requests, messages, profile views, and the score floor) are fixed in `scripts/budget.mjs` in the student folder. Limits can only be tightened: daily and rolling caps can be set lower, while minimums (the score floor, which starts at 3.5, the gap between actions, and nudge wait days) can be set higher. Looser values are clamped and logged. The triage budget is not one of these limits: it is the student's own, and Part D sets it. A student with an unusual reason to evaluate lower-scoring jobs can read them in the pipeline file, but the pack will not apply to them.

STUDENT: 1: scheduled-discovery. 2: 06:30. 7: 8. 9: drafts. Raise the score floor to 4. Everything else as recommended.

INTERVIEWER: Confirmed: automation scheduled-discovery at 06:30 America/New_York, inbox pass on, standard tier, daily target 8, mail path connector, Outreach drafts, Handshake on, submission user, score floor 4, no limit overrides. I recorded the agent as claude without asking. I wrote data/interview-answers.json with inbox_schedule on and ran `node student/interview/apply-answers.mjs data/interview-answers.json`: it wrote config/student.yml, config/profile.yml, portals.yml, the three modes files, data/student-github-sources.json and data/blacklist.md, and printed no problems. `node doctor.mjs --json` reported nothing red.

INTERVIEWER: I ran `node student/scripts/schedule.mjs install`: installed com.career-ops.student.daily at 06:30. Then `node student/scripts/schedule.mjs verify`:
check daily run: ok
check inbox pass: ok
check triage: off
schedule verified: com.career-ops.student.daily at 06:30

INTERVIEWER: First rows: `node student/scripts/first-run.mjs --list-only` listed 20 untriaged rows within your first-run budget. I scored them in this chat, applied the verdicts with `node student/scripts/apply-triage.mjs` and ran `node student/scripts/triage-budget.mjs log 20 --first-run`. Here is your top 10 from `node student/scripts/rank-queue.mjs --n 10`; the first three:
1. 4.4 Example Advisory LLP | Business Analyst | Chicago, IL
2. 4.2 Sample Analytics Group | Technology Consulting Analyst | Remote
3. 4.0 Placeholder Systems | Systems Analyst | Chicago, IL
The rest of the top 10 follows in the same form. Nothing was submitted.

INTERVIEWER: You are set up. What to say, grouped as in docs/commands.md: daily use: "what is new today" shows today's queue; "what ran today" shows the daily run. Applying: "apply" starts the apply loop, then "submit all" or "submit 1,3". Outreach: "outreach" runs one round, then "send all" or "send 1,3"; "stop outreach" ends it. Inbox: "check my inbox" reads mail; "turn off the inbox pass" stops the scheduled pass. Settings: "stop handshake" turns the Handshake pass off. Help: "help" shows this guide again. Say help any time to see this again.
