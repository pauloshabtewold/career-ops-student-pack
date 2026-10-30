# SYNTHETIC FIXTURE: recorded personalization interview, invented student, test data only

Resume: tests/fixtures/resumes/mechanical.md | Persona: tests/fixtures/answers/mechanical.json

Preset set: software-cs, mis-business-analytics, finance-economics, accounting, engineering-mech-elec, policy-government, consulting, cybersecurity, marketing-business, statistics-math-actuarial, supply-chain-operations, byo-employer-list (snapshot 1e38ac4)

## Phase 1: resume and identity

INTERVIEWER: I have read your resume (cv.md), so I will not ask for anything already in it. Here is what I took from it: name Casey Prototype, email casey.prototype@example.edu, phone 415-555-0143. The resume lists no city, LinkedIn or GitHub, so I will leave those out unless you want to add them. Is all of that correct?

STUDENT: Yes, name, email and phone are correct. City, LinkedIn and GitHub: skip.

INTERVIEWER: Thanks. How would you describe your work authorization, in your own words, and will you need sponsorship now or later?

STUDENT: US citizen. I will not need sponsorship.

## Phase 2: what they are looking for

INTERVIEWER: Your resume says the B.S. in Mechanical Engineering is expected December 2027 and shows a co-op at Example Aerospace Corp. I propose one track: co-op, graduation 2027-12. Any other tracks (internship or new grad)?

STUDENT: Just the co-op track, graduating 2027-12.

INTERVIEWER: Fields of study. The presets are software-cs, mis-business-analytics, finance-economics, accounting, engineering-mech-elec, policy-government, consulting, cybersecurity, marketing-business, statistics-math-actuarial, supply-chain-operations and byo-employer-list. Given mechanical engineering, I suggest engineering-mech-elec. Pick one or two.

STUDENT: engineering-mech-elec.

INTERVIEWER: I ran `node scripts/preset-portals.mjs engineering-mech-elec` (exit 0). It seeds 80 tracked employers in portals.yml, starting with Lockheed Martin, Boeing, Northrop Grumman, RTX and General Dynamics and covering aerospace, automotive, industrial, energy, semiconductors and medical devices.

INTERVIEWER: Coverage, from `node interview/coverage.mjs engineering-mech-elec --today 2026-10-29`, read exactly as returned: Mechanical, aerospace, electrical and chemical engineering [semi-automated]: Semi-automated: community lists exist for mechanical, electrical and aerospace; chemical is thin. Defense and aerospace roles often need citizenship, so the filters exclude clearance-only postings.

INTERVIEWER: Target role names. From your tolerance stack-up co-op and the bracket project, I suggest "Mechanical design engineer" and "Test engineer". Keep, change or add?

STUDENT: Mechanical design engineer and Test engineer.

INTERVIEWER: Locations, in order of preference? And years of experience, default 0.

STUDENT: Denver, CO first, then Huntsville, AL. Experience: 0 years.

INTERVIEWER: Priority companies, hard-no companies, and dealbreakers? Default is none for each.

STUDENT: Priority: Example Aerospace Corp. Blacklist: Example Staffing Group. Dealbreakers: commission[- ]only, and security clearance required.

INTERVIEWER: Recorded. Any specific employers to add beyond the preset, with a careers URL?

STUDENT: Example mechanical Target 1 at https://careers.example.com/mechanical/1 and Example mechanical Target 2 at https://careers.example.com/mechanical/2.

INTERVIEWER: GitHub lists to trial. This preset carries community lists such as tracker05-me, wonofakind-2027, hiderrick-eng, meche-tracker and the litos lists. They start as `trial` and the monthly review keeps or drops them. Use the GitHub-lists source?

STUDENT: Yes, github-lists.

## Phase 3: resume variants

INTERVIEWER: For the co-op track (graduation 2027-12), I suggest a variant named mechanical-main with a one-page limit. The file itself stays under your control. OK?

STUDENT: Yes, mechanical-main, one page.

INTERVIEWER: Now the application profile answers I reuse on forms. When could you start? Give a month as YYYY-MM.

STUDENT: 2028-01.

INTERVIEWER: Are you willing to relocate? Answer `yes`, `no` or `within-locations` (only the locations you listed).

STUDENT: yes.

INTERVIEWER: For the voluntary EEO questions, should I `leave-blank`, `ask-each-time`, or fill them in?

STUDENT: ask-each-time.

INTERVIEWER: How did you hear about opportunities like these? One short phrase is fine.

STUDENT: Employer website.

INTERVIEWER: Recorded: start date 2028-01, relocation yes, EEO ask-each-time, how did you hear "Employer website".

## Phase 4: switches and disclosures

INTERVIEWER: Before the disclosures, one disclaimer: This pack is not affiliated with or endorsed by LinkedIn, Handshake, career-ops or any employer. You are responsible for following the terms of every site you use it with. LinkedIn and Handshake automation can lead to limits or restrictions on your accounts; both are on by default and each can be switched off at any time ("stop outreach", "stop handshake"). The software comes with no warranty of any kind (MIT license).

INTERVIEWER: LinkedIn outreach. LinkedIn's terms restrict automated activity, and the status of an assistant that drafts and sends messages in the student's own signed-in browser is ambiguous. It can put the account at risk. Outreach is therefore capped by hard limits, never runs unattended, and can be set to `on`, `drafts` (drafts only, the student sends) or `off`. At any time the student can say "stop outreach" and it ends for good until they say otherwise.

INTERVIEWER: Handshake. Handshake's terms are ambiguous about automated browsing in the same way. The Handshake pass is on by default and can be turned off; "stop handshake" ends it at once.

INTERVIEWER: Now the switches. Outreach: `on`, `drafts` or `off`. Handshake: `on` or `off`. Who presses submit on applications: `user` (default) or `agent`. LinkedIn account tier: `free` or `premium`.

STUDENT: Outreach on. Handshake on. Submission: agent. LinkedIn tier: skip.

INTERVIEWER: Recorded: outreach on, handshake on, submission agent, LinkedIn tier left unset. Limits table (ceilings): applications 10 per day, connection requests 20 per day, messages 10 per day, profile views 60 per day, score floor 3.5. Any limits you want to set?

STUDENT: Messages 6 per day, connection requests 30 per day, score floor 4, daily applications target 8.

INTERVIEWER: Messages 6 per day and a score floor of 4 are recorded; a raise of connection requests to 30 is declined, so it stays at the ceiling of 20. The pack's ceilings (daily applications, connection requests, messages, profile views, and the score floor) are fixed in `scripts/budget.mjs` in the student folder. Limits can only be tightened: daily and rolling caps can be set lower, while minimums (the score floor, which starts at 3.5, the gap between actions, and nudge wait days) can be set higher. Looser values are clamped and logged. A student with an unusual reason to evaluate lower-scoring jobs can read them in the pipeline file, but the pack will not apply to them.

## Phase 5: schedule and spend

INTERVIEWER: Automation level: `manual`, `scheduled-discovery` or `scheduled-discovery-plus-triage`? Default is manual.

STUDENT: scheduled-discovery.

INTERVIEWER: Local time for the daily run, and your time zone?

STUDENT: 06:30, America/Denver.

INTERVIEWER: Model tier: `standard` or `premium`? There is no economy tier.

STUDENT: standard.

INTERVIEWER: Daily target for applications? Default 10; the ceiling still applies. You mentioned 8.

STUDENT: 8.

INTERVIEWER: How will mail be read for the inbox pass: `connector`, `paste` or `gmail-plugin`?

STUDENT: connector.

## Phase 6: write, check, enable

INTERVIEWER: I wrote data/interview-answers.json following interview/answers.schema.json. Summary: Casey Prototype, casey.prototype@example.edu, 415-555-0143; US citizen, no sponsorship; preset engineering-mech-elec; co-op track graduating 2027-12 with variant mechanical-main (1 page); roles Mechanical design engineer and Test engineer; Denver, CO then Huntsville, AL; 0 years; priority Example Aerospace Corp; blacklist Example Staffing Group; dealbreakers commission[- ]only and security clearance required; two target employers; github-lists; outreach on, handshake on, submission agent; messages 6 per day, connects 20 per day, score floor 4; scheduled-discovery at 06:30 America/Denver; standard tier; target 8 per day; mailbox connector. Is this right?

STUDENT: Yes.

INTERVIEWER: I ran `node interview/apply-answers.mjs --root <ROOT> --data-dir <ROOT>/data --today 2026-10-29 --dry-run` (exit 0). It reports it would write config/student.yml, config/profile.yml, portals.yml, modes/_profile.md, modes/_brief.md, modes/_custom.md, data/student-github-sources.json and data/blacklist.md. No problems listed.

INTERVIEWER: Enabling the GitHub-lists plugin (capability card, then `--confirm`): not performed in a fixture run.

INTERVIEWER: `node doctor.mjs --json`: not performed in a fixture run.

INTERVIEWER: Sign-ins (LinkedIn, then Handshake, then the mailbox): not performed in a fixture run. First run with `node student/scripts/rank-queue.mjs`: not performed in a fixture run.
