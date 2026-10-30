# SYNTHETIC FIXTURE: recorded agent-driven personalization interview (set mis)

Resume: tests/fixtures/resumes/mis.md | Persona: tests/fixtures/answers/mis.json

Preset set: software-cs, mis-business-analytics, finance-economics, accounting, engineering-mech-elec, policy-government, consulting, cybersecurity, marketing-business, statistics-math-actuarial, supply-chain-operations, byo-employer-list (snapshot 1e38ac4)

Invented person, school and employer. Test data only. Interviewer script: interview/interview.md, phases 1 to 6.

## Phase 1: resume and identity

INTERVIEWER: I found cv.md, so I will not ask for anything it already covers. From the resume I have: name Riley Sampleton, email riley.sampleton@example.edu, phone 415-555-0141. The resume lists no city, LinkedIn or GitHub, so I will leave those out unless you want to add them. Is everything above correct?

STUDENT: Yes, name, email and phone are right. Skip city, LinkedIn and GitHub.

INTERVIEWER: In your own words, what is your work authorization, and will you need visa sponsorship now or later? Default: no sponsorship.

STUDENT: US citizen. No sponsorship needed.

## Phase 2: what they are looking for

INTERVIEWER: Which tracks are you after: internship, co-op, new grad? The resume says B.B.A. in Management Information Systems, expected May 2027, so I would propose new grad with graduation 2027-05.

STUDENT: New grad only, graduating 2027-05.

INTERVIEWER: The pack has twelve presets: software-cs, mis-business-analytics, finance-economics, accounting, engineering-mech-elec, policy-government, consulting, cybersecurity, marketing-business, statistics-math-actuarial, supply-chain-operations and byo-employer-list. Your degree points to mis-business-analytics. I ran node scripts/preset-portals.mjs mis-business-analytics: it seeds 68 tracked companies, starting with Accenture, Deloitte, PwC, EY, KPMG and IBM and running through banks, insurers, retailers and tech firms. One or two presets?

STUDENT: Just mis-business-analytics.

INTERVIEWER: Here is the coverage line from node interview/coverage.mjs mis-business-analytics, exactly as returned: "MIS, information systems, business analytics [semi-automated]: Semi-automated: nothing is MIS-specific, so analyst lists plus title rules feed the queue, and the employer list below carries consulting and rotational programs."

STUDENT: Understood.

INTERVIEWER: Target role names, one short phrase each. Based on your analytics internship, KPI reporting and dashboard work, I would propose "Business analyst" and "Technology consulting analyst".

STUDENT: Business analyst and Technology consulting analyst.

INTERVIEWER: Locations, in order of preference? And years of full-time experience? Default for experience: 0.

STUDENT: Chicago, IL first, then Remote. Experience: 0 years.

INTERVIEWER: Any priority companies, any companies to never apply to, and any dealbreakers? Default: none.

STUDENT: Priority: Example Advisory LLP. Blacklist: Example Staffing Group. Dealbreaker: commission-only roles, recorded as the pattern commission[- ]only.

INTERVIEWER: Any specific employers whose careers pages you want watched beyond the preset seeds? Default: none.

STUDENT: Two: Example mis Target 1 at https://careers.example.com/mis/1 and Example mis Target 2 at https://careers.example.com/mis/2.

INTERVIEWER: Which GitHub lists do you want to trial? They start as trial and the monthly review keeps or drops them. Default: the github-lists source with the preset's analyst lists.

STUDENT: The github-lists source, with the preset defaults.

## Phase 3: resume variants

INTERVIEWER: For the new grad track, name a resume variant and its page limit. Default: one page. I would propose the name mis-main.

STUDENT: mis-main, one page, new grad track, graduation 2027-05.

INTERVIEWER: Recorded: variant mis-main, track newgrad, graduation 2027-05, page limit 1. The file itself stays under your control.

INTERVIEWER: Now the application profile answers I reuse on forms. When could you start? Give a month as YYYY-MM.

STUDENT: 2027-06.

INTERVIEWER: Are you willing to relocate? Answer `yes`, `no` or `within-locations` (only the locations you listed).

STUDENT: within-locations.

INTERVIEWER: For the voluntary EEO questions, should I `leave-blank`, `ask-each-time`, or fill them in?

STUDENT: leave-blank.

INTERVIEWER: How did you hear about opportunities like these? One short phrase is fine.

STUDENT: Professor referral.

INTERVIEWER: Recorded: start date 2027-06, relocation within-locations, EEO leave-blank, how did you hear "Professor referral".

## Phase 4: switches and disclosures

INTERVIEWER: Before the disclosures, one disclaimer, read word for word.

INTERVIEWER: This pack is not affiliated with or endorsed by LinkedIn, Handshake, career-ops or any employer. You are responsible for following the terms of every site you use it with. LinkedIn and Handshake automation can lead to limits or restrictions on your accounts; both are on by default and each can be switched off at any time ("stop outreach", "stop handshake"). The software comes with no warranty of any kind (MIT license).

INTERVIEWER: Now two disclosures, read aloud before I ask anything. First:

INTERVIEWER: LinkedIn outreach. LinkedIn's terms restrict automated activity, and the status of an assistant that drafts and sends messages in the student's own signed-in browser is ambiguous. It can put the account at risk. Outreach is therefore capped by hard limits, never runs unattended, and can be set to `on`, `drafts` (drafts only, the student sends) or `off`. At any time the student can say "stop outreach" and it ends for good until they say otherwise.

INTERVIEWER: Second:

INTERVIEWER: Handshake. Handshake's terms are ambiguous about automated browsing in the same way. The Handshake pass is on by default and can be turned off; "stop handshake" ends it at once.

INTERVIEWER: Four questions. Outreach: `on`, `drafts` or `off`. Handshake: `on` or `off`. Who presses submit on applications: `user` (default) or `agent`. LinkedIn account tier: `free` or `premium`.

STUDENT: Outreach: drafts. Handshake: on. Submission: user. LinkedIn tier: skip.

INTERVIEWER: Recorded: outreach drafts, handshake on, submission user, LinkedIn tier left unset. Limits next. The ceilings are 20 connection requests a day, 100 per rolling 7 days, 10 messages a day, 60 profile views a day, and a score floor of 3.5. Do you want any of these lower, or the score floor higher?

STUDENT: Messages: 4 a day. Score floor: 4.

INTERVIEWER: Recorded: message_per_day 4, score floor 4. The pack's ceilings (daily applications, connection requests, messages, profile views, and the score floor) are fixed in scripts/budget.mjs in the student folder. Limits can only be tightened: daily and rolling caps can be set lower, while minimums (the score floor, which starts at 3.5, the gap between actions, and nudge wait days) can be set higher. Looser values are clamped and logged. A student with an unusual reason to evaluate lower-scoring jobs can read them in the pipeline file, but the pack will not apply to them.

STUDENT: Understood.

## Phase 5: schedule and spend

INTERVIEWER: Automation level: manual, scheduled-discovery or scheduled-discovery-plus-triage? Default: manual.

STUDENT: scheduled-discovery.

INTERVIEWER: Local time for the daily run, and your time zone?

STUDENT: 06:30, America/New_York.

INTERVIEWER: Model tier: standard or premium? There is no economy tier. Default: standard.

STUDENT: standard.

INTERVIEWER: Daily target for applications? Default 10; the ceiling still applies.

STUDENT: 8.

INTERVIEWER: How will mail be read for the inbox pass: connector, paste or gmail-plugin?

STUDENT: connector.

## Phase 6: write, check, enable

INTERVIEWER: I wrote the answers to data/interview-answers.json following interview/answers.schema.json. Summary: Riley Sampleton, riley.sampleton@example.edu, 415-555-0141; US citizen, no sponsorship; new grad 2027-05 with variant mis-main (1 page); preset mis-business-analytics; roles Business analyst and Technology consulting analyst; Chicago, IL then Remote; 0 years; priority Example Advisory LLP; blacklist Example Staffing Group; dealbreaker commission[- ]only; two target employers; source github-lists; outreach drafts, handshake on, submission user; messages 4 a day, score floor 4; scheduled-discovery at 06:30 America/New_York; standard tier; daily target 8; mailbox connector. Is this right?

STUDENT: Yes.

INTERVIEWER: I ran node interview/apply-answers.mjs --root ROOT --data-dir ROOT/data --today 2026-10-29 --dry-run. Exit code 0. It reported "Would write:" config/student.yml, config/profile.yml, portals.yml, modes/_profile.md, modes/_brief.md, modes/_custom.md, data/student-github-sources.json and data/blacklist.md. No limits were clamped.

INTERVIEWER: Enabling the GitHub-lists plugin (node plugins.mjs enable github-lists, capability card, then --confirm): not performed in a fixture run.

INTERVIEWER: Doctor check (node doctor.mjs --json): not performed in a fixture run.

INTERVIEWER: Sign-ins for the first run (LinkedIn, then Handshake, then the mailbox): not performed in a fixture run. First run with node student/scripts/rank-queue.mjs and the top three postings: not performed in a fixture run.

STUDENT: Okay.
