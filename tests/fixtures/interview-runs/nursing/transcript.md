# SYNTHETIC FIXTURE: recorded agent-driven personalization interview, set nursing

Resume: tests/fixtures/resumes/nursing.md | Persona: tests/fixtures/answers/nursing.json

Preset set: software-cs, mis-business-analytics, finance-economics, accounting, engineering-mech-elec, policy-government, consulting, cybersecurity, marketing-business, statistics-math-actuarial, supply-chain-operations, byo-employer-list (snapshot 1e38ac4)

Run date: 2026-10-29. Invented person, school and employers; test data only.

## Phase 1: resume and identity

INTERVIEWER: I read your resume (cv.md is present, so I will not ask you to paste it). From it I have: name Taylor Bedside, email taylor.bedside@example.edu, phone 415-555-0144. Are those three right?

STUDENT: Yes, all three are right.

INTERVIEWER: The resume lists no city, no LinkedIn and no GitHub. I can leave those out, or you can add any of them now. Default is to leave them out.

STUDENT: Skip.

INTERVIEWER: Noted, identity is name, email and phone only. In your own words, what is your work authorization, and will you need sponsorship now or later?

STUDENT: US citizen. I will not need sponsorship.

INTERVIEWER: Recorded: work authorization "US citizen", needs sponsorship: no.

## Phase 2: what they are looking for

INTERVIEWER: Your resume shows a B.S.N. in Nursing, expected May 2027. I propose one track: new grad, graduating 2027-05. Any internship or co-op track as well? Default is new grad only.

STUDENT: New grad only, May 2027.

INTERVIEWER: The pack has twelve field presets: software-cs, mis-business-analytics, finance-economics, accounting, engineering-mech-elec, policy-government, consulting, cybersecurity, marketing-business, statistics-math-actuarial, supply-chain-operations and byo-employer-list. None of the first eleven covers nursing, so I propose byo-employer-list. I ran `node scripts/preset-portals.mjs byo-employer-list`; it returned `tracked_companies: []`, so this preset seeds no employers and you bring your own list. OK to use it?

STUDENT: Yes, use byo-employer-list.

INTERVIEWER: Coverage line from `node interview/coverage.mjs byo-employer-list`, exactly as returned: "Bring your own employer list [discovery-only]: Discovery help, not automation: for fields such as nursing, education, biology, design and communications the pack has no job lists or employer seeds, so you bring 10 to 20 target employers and set up job-alert emails." This preset is discovery help only. Please give me 10 to 20 target employers, each with its careers page URL.

STUDENT: Mass General Brigham, https://massgeneralbrigham.wd1.myworkdayjobs.com/MGBExternal, Cleveland Clinic, https://ccf.wd1.myworkdayjobs.com/ClevelandClinicCareers, Ochsner Health, https://ochsner.wd1.myworkdayjobs.com/Ochsner, Seattle Children's, https://seattlechildrens.wd5.myworkdayjobs.com/External, Vanderbilt University Medical Center, https://vumc.wd1.myworkdayjobs.com/vumccareers, Allina Health, https://allina.wd5.myworkdayjobs.com/External, UVM Health Network, https://uvmhealth.wd1.myworkdayjobs.com/External, NewYork-Presbyterian, https://nyp.wd1.myworkdayjobs.com/nypcareers, Lehigh Valley Health Network, https://lvhn.wd1.myworkdayjobs.com/lvhn, One Medical, https://job-boards.greenhouse.io/onemedical, Included Health, https://jobs.lever.co/includedhealth.

INTERVIEWER: Eleven employers recorded. Target roles: from your clinic intake work, blood pressure screening and patient assessment skills, I propose "Registered nurse residency" and "Clinic nurse". Keep both, change, or add?

STUDENT: Keep both, and add "Registered nurse", "Nurse extern", "Nursing assistant" and "Nurse assistant".

INTERVIEWER: Locations, in order of preference? And years of experience; your resume shows volunteer work only, so I propose 0.

STUDENT: Boston, MA; Brighton, MA; Jamaica Plain, MA; Newton, MA; Salem, MA; Cleveland, OH; New Orleans, LA; Seattle, WA; Nashville, TN; Minneapolis, MN; Burlington, VT; New York, NY; Allentown, PA; Portland, OR. Zero years.

INTERVIEWER: Recorded: locations Boston, MA; Brighton, MA; Jamaica Plain, MA; Newton, MA; Salem, MA; Cleveland, OH; New Orleans, LA; Seattle, WA; Nashville, TN; Minneapolis, MN; Burlington, VT; New York, NY; Allentown, PA; Portland, OR; experience 0 years. Any priority companies, any hard-no companies, and any dealbreakers (for example "unpaid")?

STUDENT: Priority: Mass General Brigham. Hard no: Example Staffing Group. Dealbreaker: night shift only.

INTERVIEWER: Recorded: priority Mass General Brigham; blacklist Example Staffing Group; dealbreaker "night shift only". Which GitHub job lists would you like to trial? They start as trial and the monthly review keeps or drops them. Default is none.

STUDENT: Skip.

INTERVIEWER: No GitHub lists chosen.

## Phase 3: resume variants

INTERVIEWER: For the new grad track I propose one resume variant named nursing-main, one page, graduation 2027-05. The file stays under your control. OK?

STUDENT: Yes, nursing-main, one page.

INTERVIEWER: Now the application profile answers I reuse on forms. When could you start? Give a month as YYYY-MM.

STUDENT: 2027-07.

INTERVIEWER: Are you willing to relocate? Answer `yes`, `no` or `within-locations` (only the locations you listed).

STUDENT: within-locations.

INTERVIEWER: For the voluntary EEO questions, should I `leave-blank`, `ask-each-time`, or fill them in?

STUDENT: leave-blank.

INTERVIEWER: How did you hear about opportunities like these? One short phrase is fine.

STUDENT: Hospital job board.

INTERVIEWER: Recorded: start date 2027-07, relocation within-locations, EEO leave-blank, how did you hear "Hospital job board".

## Phase 4: switches and disclosures

INTERVIEWER: Before the disclosures, one disclaimer, read once: This pack is not affiliated with or endorsed by LinkedIn, Handshake, career-ops or any employer. You are responsible for following the terms of every site you use it with. LinkedIn and Handshake automation can lead to limits or restrictions on your accounts; both are on by default and each can be switched off at any time ("stop outreach", "stop handshake"). The software comes with no warranty of any kind (MIT license).

INTERVIEWER: LinkedIn outreach. LinkedIn's terms restrict automated activity, and the status of an assistant that drafts and sends messages in the student's own signed-in browser is ambiguous. It can put the account at risk. Outreach is therefore capped by hard limits, never runs unattended, and can be set to `on`, `drafts` (drafts only, the student sends) or `off`. At any time the student can say "stop outreach" and it ends for good until they say otherwise.

INTERVIEWER: Handshake. Handshake's terms are ambiguous about automated browsing in the same way. The Handshake pass is on by default and can be turned off; "stop handshake" ends it at once.

INTERVIEWER: Now the switches. Defaults are shown where the pack has one.
Outreach: `on`, `drafts` or `off`.
Handshake: `on` or `off`.
Who presses submit on applications: `user` (default) or `agent`.
LinkedIn account tier: `free` or `premium`.

STUDENT: Outreach: drafts. Handshake: on. Submit: user. LinkedIn tier: skip.

INTERVIEWER: Recorded: outreach drafts, Handshake on, submission user, LinkedIn tier not set. Limits table (pack ceilings from scripts/budget.mjs): applications 10 per day, 3 per session in the first week; connection requests 20 per day and 100 per rolling 7 days; messages 10 per day; profile views 60 per day; at least 45 seconds between actions; nudge wait at least 5 days; score floor 3.5. The pack's ceilings (daily applications, connection requests, messages, profile views, and the score floor) are fixed in `scripts/budget.mjs` in the student folder. Limits can only be tightened: daily and rolling caps can be set lower, while minimums (the score floor, which starts at 3.5, the gap between actions, and nudge wait days) can be set higher. Looser values are clamped and logged. A student with an unusual reason to evaluate lower-scoring jobs can read them in the pipeline file, but the pack will not apply to them. Want to tighten any limit?

STUDENT: Keep the caps as they are. Raise the score floor to 4.

INTERVIEWER: Recorded: score floor 4 (a tightening, accepted); no other limit changes.

## Phase 5: schedule and spend

INTERVIEWER: Automation level: `manual`, `scheduled-discovery` or `scheduled-discovery-plus-triage`? Default is manual.

STUDENT: scheduled-discovery.

INTERVIEWER: Local time for the daily run, and your time zone?

STUDENT: 06:30, America/Los_Angeles.

INTERVIEWER: Model tier: `standard` or `premium`? There is no economy tier.

STUDENT: Standard.

INTERVIEWER: Daily target for applications? Default is 10; the ceiling of 10 still applies.

STUDENT: 8.

INTERVIEWER: How should mail be read for the inbox pass: `connector`, `paste` or `gmail-plugin`?

STUDENT: Connector.

## Phase 6: write, check, enable

INTERVIEWER: I wrote data/interview-answers.json following interview/answers.schema.json. Summary: Taylor Bedside, taylor.bedside@example.edu, 415-555-0144; US citizen, no sponsorship; new grad track, graduating 2027-05, resume variant nursing-main (one page); preset byo-employer-list with 11 target employers (Mass General Brigham, Cleveland Clinic, Ochsner Health, Seattle Children's, Vanderbilt University Medical Center, Allina Health, UVM Health Network, NewYork-Presbyterian, Lehigh Valley Health Network, One Medical, Included Health); roles Registered nurse residency, Clinic nurse, Registered nurse, Nurse extern, Nursing assistant and Nurse assistant; Boston, MA; Brighton, MA; Jamaica Plain, MA; Newton, MA; Salem, MA; Cleveland, OH; New Orleans, LA; Seattle, WA; Nashville, TN; Minneapolis, MN; Burlington, VT; New York, NY; Allentown, PA; Portland, OR; 0 years; priority Mass General Brigham; blacklist Example Staffing Group; dealbreaker night shift only; no GitHub lists; outreach drafts, Handshake on, submission user; score floor 4, limits unchanged; scheduled-discovery at 06:30 America/Los_Angeles; standard tier; daily target 8; mail via connector. Is this right?

STUDENT: Yes.

INTERVIEWER: I ran `node interview/apply-answers.mjs --root iv-root-nursing --data-dir iv-root-nursing/data --today 2026-10-29 --dry-run` against snapshot 1e38ac4. Exit code 0. Output: "Would write: config/student.yml, config/profile.yml, portals.yml, modes/_profile.md, modes/_brief.md, modes/_custom.md, data/student-github-sources.json, data/blacklist.md". The answers are valid; this was a dry run, so nothing was written.

INTERVIEWER: GitHub-lists plugin enable (capability card and `--confirm`): not performed in a fixture run.

INTERVIEWER: Doctor check (`node doctor.mjs --json`): not performed in a fixture run. Setup is not marked done.

INTERVIEWER: Sign-ins (LinkedIn, then Handshake, then the mailbox): not performed in a fixture run.

INTERVIEWER: First run (rank-queue and the top three postings walkthrough): not performed in a fixture run. Nothing was submitted.
