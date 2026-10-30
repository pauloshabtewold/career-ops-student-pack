# SYNTHETIC FIXTURE: recorded personalization interview, set cs (invented person, test data only)

Resume: tests/fixtures/resumes/cs.md | Persona: tests/fixtures/answers/cs.json
Preset set: software-cs, mis-business-analytics, finance-economics, accounting, engineering-mech-elec, policy-government, consulting, cybersecurity, marketing-business, statistics-math-actuarial, supply-chain-operations, nursing, byo-employer-list (snapshot 1e38ac4)
Run date: 2026-10-29. Script: interview/interview.md, phases 1 to 6.

## Phase 1: resume and identity

INTERVIEWER: Hi. I read your cv.md first, so I will only ask about what it does not cover. From the resume I have: name Jordan Testwell, email jordan.testwell@example.edu, phone 415-555-0140. The resume does not list a city, a LinkedIn URL or a GitHub URL. Is the name, email and phone correct as written? If you want a city, LinkedIn or GitHub added, give them now, or say skip.

STUDENT: Yes, name, email and phone are all correct. Skip the city, LinkedIn and GitHub.

INTERVIEWER: Confirmed: Jordan Testwell, jordan.testwell@example.edu, 415-555-0140. No city, LinkedIn or GitHub recorded. Next, work authorization in your own words, for example "F-1 with OPT" or "US citizen", and will you need visa sponsorship now or later?

STUDENT: US citizen. I will not need sponsorship.

INTERVIEWER: Recorded: work authorization "US citizen", needs sponsorship: no.

## Phase 2: what they are looking for

INTERVIEWER: Which tracks are you after: internship, co-op, new grad? You can pick more than one. Your resume says B.S. Computer Science, expected May 2028. Should I use May 2028 as the graduation date?

STUDENT: Internship only. Graduation May 2028.

INTERVIEWER: Recorded: one track, internship, graduation 2028-05. Now your field. The pack has thirteen presets: software-cs, mis-business-analytics, finance-economics, accounting, engineering-mech-elec, policy-government, consulting, cybersecurity, marketing-business, statistics-math-actuarial, supply-chain-operations, nursing and byo-employer-list. You can choose one or two. Given a CS degree and a software internship, the default is software-cs. Which do you want?

STUDENT: Just software-cs.

INTERVIEWER: I ran `node scripts/preset-portals.mjs software-cs` against the pack. It seeds a tracked_companies list of 102 employer career boards (Greenhouse boards, all enabled). Here is the coverage line from `node interview/coverage.mjs software-cs`, exactly as it returns it: "Software engineering, computer science [automated]: Automated: the community internship and new-grad lists for software, data, ML and product roles are read daily, plus the company boards below."

STUDENT: Sounds good.

INTERVIEWER: Target role names. Based on the telemetry testing at Example Robotics Co and the scheduler app with a REST API, I would propose "Backend engineering intern" and "Data engineering intern". Keep, change or add?

STUDENT: Keep both: Backend engineering intern and Data engineering intern.

INTERVIEWER: Locations, in order of preference? And years of experience, if any; the default for a student with one internship is 0.

STUDENT: Remote first, then Austin, TX. Experience 0 years.

INTERVIEWER: Recorded: locations Remote, then Austin, TX; experience 0 years. Any priority companies, any hard-no companies for a blacklist, and any dealbreakers, for example "unpaid" or "on-site only outside my metros"?

STUDENT: Priority: Example Robotics Co. Blacklist: Example Staffing Group. Dealbreakers: unpaid, and commission[- ]only. I also have two employers I want tracked: Example cs Target 1 at https://careers.example.com/cs/1 and Example cs Target 2 at https://careers.example.com/cs/2.

INTERVIEWER: Recorded: priority Example Robotics Co; blacklist Example Staffing Group; dealbreakers "unpaid" and "commission[- ]only"; target employers Example cs Target 1 (https://careers.example.com/cs/1) and Example cs Target 2 (https://careers.example.com/cs/2). Last for this phase: which GitHub lists do you want to trial? They start as trial and the monthly review keeps or drops them. The default is the github-lists source the preset reads.

STUDENT: Yes, github-lists.

INTERVIEWER: Recorded: sources chosen github-lists, starting as trial.

## Phase 3: resume variants

INTERVIEWER: For the internship track, name a resume variant and its page limit. The default is one page. The file itself stays under your control; I only list it.

STUDENT: Call it cs-main, one page.

INTERVIEWER: Recorded: variant cs-main, track internship, graduation 2028-05, page limit 1.

INTERVIEWER: Now the application profile answers I reuse on forms. When could you start? Give a month as YYYY-MM.

STUDENT: 2027-06.

INTERVIEWER: Are you willing to relocate? Answer `yes`, `no` or `within-locations` (only the locations you listed).

STUDENT: within-locations.

INTERVIEWER: For the voluntary EEO questions, should I `leave-blank`, `ask-each-time`, or fill them in?

STUDENT: leave-blank.

INTERVIEWER: How did you hear about opportunities like these? One short phrase is fine.

STUDENT: University career fair.

INTERVIEWER: Recorded: start date 2027-06, relocation within-locations, EEO leave-blank, how did you hear "University career fair".

## Phase 4: switches and disclosures

INTERVIEWER: Before the switches, a disclaimer I read once, word for word: This pack is not affiliated with or endorsed by LinkedIn, Handshake, career-ops or any employer. You are responsible for following the terms of every site you use it with. LinkedIn and Handshake automation can lead to limits or restrictions on your accounts; both are on by default and each can be switched off at any time ("stop outreach", "stop handshake"). The software comes with no warranty of any kind (MIT license).

STUDENT: Understood.

INTERVIEWER: Two disclosures before I ask. First: LinkedIn outreach. LinkedIn's terms restrict automated activity, and the status of an assistant that drafts and sends messages in the student's own signed-in browser is ambiguous. It can put the account at risk. Outreach is therefore capped by hard limits, never runs unattended, and can be set to `on`, `drafts` (drafts only, the student sends) or `off`. At any time the student can say "stop outreach" and it ends for good until they say otherwise.

INTERVIEWER: Second: Handshake. Handshake's terms are ambiguous about automated browsing in the same way. The Handshake pass is on by default and can be turned off; "stop handshake" ends it at once.

STUDENT: Got it.

INTERVIEWER: Now the switches. Outreach: `on`, `drafts` or `off`. Handshake: `on` or `off`. Who presses submit on applications: `user` (default) or `agent`. LinkedIn account tier: `free` or `premium`.

STUDENT: Outreach on. Handshake on. Submission agent. Skip the LinkedIn tier.

INTERVIEWER: Recorded: outreach on, handshake on, submission agent, LinkedIn tier not recorded. Here are the main limits from `scripts/budget.mjs`: 20 connection requests a day and 100 per rolling 7 days, 10 messages a day, 60 profile views a day, 10 submitted applications a day (3 per session in the first week), actions spaced at least 45 seconds apart, LinkedIn work only between 08:00 and 22:00 local time, and a score floor of 3.5. Do you want any of these tighter?

INTERVIEWER: The pack's ceilings (daily applications, connection requests, messages, profile views, and the score floor) are fixed in `scripts/budget.mjs` in the student folder. Limits can only be tightened: daily and rolling caps can be set lower, while minimums (the score floor, which starts at 3.5, the gap between actions, and nudge wait days) can be set higher. Looser values are clamped and logged. A student with an unusual reason to evaluate lower-scoring jobs can read them in the pipeline file, but the pack will not apply to them.

STUDENT: Leave the caps as they are. Raise the score floor to 4.

INTERVIEWER: Recorded: no limit overrides, score floor 4. That is above 3.5, so it is a tightening and is accepted.

## Phase 5: schedule and spend

INTERVIEWER: Automation level: `manual`, `scheduled-discovery` or `scheduled-discovery-plus-triage`? The default is `manual`.

STUDENT: scheduled-discovery.

INTERVIEWER: Local time for the daily run, and your time zone?

STUDENT: 06:30, America/Chicago.

INTERVIEWER: Model tier: `standard` or `premium`? There is no economy tier.

STUDENT: Standard.

INTERVIEWER: Daily target for applications? The default is 10, and the ceiling of 10 still applies.

STUDENT: 8.

INTERVIEWER: How will mail be read for the inbox pass: `connector`, `paste` or `gmail-plugin`?

STUDENT: connector.

INTERVIEWER: Recorded: automation scheduled-discovery, daily run 06:30 America/Chicago, spend tier standard, daily target 8, mailbox backend connector.

## Phase 6: write, check, enable

INTERVIEWER: I wrote your answers to data/interview-answers.json following `interview/answers.schema.json`. Summary: Jordan Testwell, jordan.testwell@example.edu, 415-555-0140; US citizen, no sponsorship; preset software-cs; one internship track graduating 2028-05 with variant cs-main (1 page); roles Backend engineering intern and Data engineering intern; locations Remote, then Austin, TX; 0 years experience; priority Example Robotics Co; blacklist Example Staffing Group; dealbreakers unpaid and commission[- ]only; two target employers; sources github-lists; outreach on, handshake on, submission agent; score floor 4, no limit overrides; scheduled-discovery at 06:30 America/Chicago; standard tier; daily target 8; mailbox connector. Is this right?

STUDENT: Yes.

INTERVIEWER: I ran `node interview/apply-answers.mjs --root <ROOT> --data-dir <ROOT>/data --today 2026-10-29 --dry-run` against the snapshot. Exit code 0, no problems listed. It reports it would write: config/student.yml, config/profile.yml, portals.yml, modes/_profile.md, modes/_brief.md, modes/_custom.md, data/student-github-sources.json, data/blacklist.md.

INTERVIEWER: Enabling the GitHub-lists plugin (capability card, then the confirm step): not performed in a fixture run.

INTERVIEWER: Running `node doctor.mjs --json`: not performed in a fixture run, so setup is not marked done here.

INTERVIEWER: Sign-ins for the first run (LinkedIn, then Handshake, then the mailbox): not performed in a fixture run. In a real run you do each sign-in yourself in the browser and I wait after each one.

INTERVIEWER: First run with `node student/scripts/rank-queue.mjs` and the walk through the top three postings: not performed in a fixture run. Nothing was submitted.

STUDENT: Thanks.
