# SYNTHETIC FIXTURE: recorded personalization interview, finance set (invented person, test data only)

Resume: tests/fixtures/resumes/finance.md | Persona: tests/fixtures/answers/finance.json
Preset set: software-cs, mis-business-analytics, finance-economics, accounting, engineering-mech-elec, policy-government, consulting, cybersecurity, marketing-business, statistics-math-actuarial, supply-chain-operations, nursing, byo-employer-list (snapshot 1e38ac4)
Run date: 2026-10-29. Commands ran against the pack snapshot. Plugin enable, doctor and sign-ins were not performed in a fixture run.

## Phase 1: resume and identity

INTERVIEWER: Hi, let's set you up. I found your resume in cv.md and read it, so I will not ask for anything already in it. Here is what I took from it: name Morgan Fixture, email morgan.fixture@example.edu, phone 415-555-0142. The resume lists no city, LinkedIn or GitHub, so I left those empty. Is all of that correct? Reply "yes", correct a line, or say "skip" for anything you want left blank.

STUDENT: Yes, that is correct. Skip city, LinkedIn and GitHub.

INTERVIEWER: Thanks. In your own words, what is your work authorization (for example "F-1 with OPT" or "US citizen"), and will you need sponsorship?

STUDENT: F-1 student, needs sponsorship. Yes, I will need sponsorship.

INTERVIEWER: Recorded: work authorization "F-1 student, needs sponsorship", sponsorship needed: yes.

## Phase 2: what they are looking for

INTERVIEWER: Which tracks are you after (internship, co-op, new grad), and what is the graduation month and year for each? Your resume says expected May 2028, so my default is an internship track with graduation 2028-05.

STUDENT: Internship only, graduating May 2028.

INTERVIEWER: Recorded: internship, 2028-05. Next, fields of study. The pack has thirteen presets: software-cs, mis-business-analytics, finance-economics, accounting, engineering-mech-elec, policy-government, consulting, cybersecurity, marketing-business, statistics-math-actuarial, supply-chain-operations, nursing and byo-employer-list. With a B.A. in Economics and a DCF project, my suggestion is finance-economics. Pick one or two.

STUDENT: finance-economics.

INTERVIEWER: I ran `node scripts/preset-portals.mjs finance-economics`. It seeds 95 tracked employers, starting with Goldman Sachs, Morgan Stanley, JPMorgan Chase, Bank of America and Citi, and running through asset managers, private equity, trading firms, insurers, the Big Four and corporate finance programs. Here is the coverage line from `node interview/coverage.mjs finance-economics`, word for word: "Finance, economics [semi-automated]: Semi-automated: only corporate finance has a community list; banks, asset managers and rotational programs come from the employer list below, and investment banking windows open far ahead."

STUDENT: Understood.

INTERVIEWER: What role names should I target? Keep each to a short phrase. Based on your finance club analyst work and the DCF model, I would suggest "Investment banking analyst" and "Corporate finance rotational analyst".

STUDENT: Investment banking analyst, and Corporate finance rotational analyst.

INTERVIEWER: Recorded both. Which locations, in order of preference? And how many years of work experience do you have, if any?

STUDENT: New York, NY first, then Charlotte, NC. Zero years of experience.

INTERVIEWER: Recorded: New York, NY, then Charlotte, NC; experience 0 years. Any priority companies, companies you never want to hear about, and dealbreakers such as "unpaid" or "on-site only outside my metros"? You can also name extra employers to track beyond the preset seeds, with their careers pages.

STUDENT: Priority: Example Capital Partners. Never: Example Staffing Group. Dealbreaker: unpaid. Extra employers to track: Example finance Target 1 at https://careers.example.com/finance/1 and Example finance Target 2 at https://careers.example.com/finance/2.

INTERVIEWER: Recorded: priority Example Capital Partners; blacklist Example Staffing Group; dealbreaker unpaid; two target employers with their careers URLs. Last one for this part: the preset comes with community GitHub lists (an internship list and a new-grad list). Do you want to trial the GitHub lists? They start as `trial` and the monthly review keeps or drops them.

STUDENT: Yes, trial the GitHub lists.

## Phase 3: resume variants

INTERVIEWER: For your internship track, what should we call the resume variant, and what page limit? Default is one page.

STUDENT: Call it finance-main, one page.

INTERVIEWER: Recorded: variant finance-main for the internship track, graduation 2028-05, page limit 1. The file itself stays under your control.

INTERVIEWER: Now the application profile answers I reuse on forms. When could you start? Give a month as YYYY-MM.

STUDENT: 2027-06.

INTERVIEWER: Are you willing to relocate? Answer `yes`, `no` or `within-locations` (only the locations you listed).

STUDENT: yes.

INTERVIEWER: For the voluntary EEO questions, should I `leave-blank`, `ask-each-time`, or fill them in?

STUDENT: leave-blank.

INTERVIEWER: How did you hear about opportunities like these? One short phrase is fine.

STUDENT: Campus recruiting event.

INTERVIEWER: Recorded: start date 2027-06, relocation yes, EEO leave-blank, how did you hear "Campus recruiting event".

## Phase 4: switches and disclosures

INTERVIEWER: Before the switches, one disclaimer, read once: "This pack is not affiliated with or endorsed by LinkedIn, Handshake, career-ops or any employer. You are responsible for following the terms of every site you use it with. LinkedIn and Handshake automation can lead to limits or restrictions on your accounts; both are on by default and each can be switched off at any time ("stop outreach", "stop handshake"). The software comes with no warranty of any kind (MIT license)."

INTERVIEWER: Two disclosures before I ask. First: "LinkedIn outreach. LinkedIn's terms restrict automated activity, and the status of an assistant that drafts and sends messages in the student's own signed-in browser is ambiguous. It can put the account at risk. Outreach is therefore capped by hard limits, never runs unattended, and can be set to `on`, `drafts` (drafts only, the student sends) or `off`. At any time the student can say "stop outreach" and it ends for good until they say otherwise."

INTERVIEWER: Second: "Handshake. Handshake's terms are ambiguous about automated browsing in the same way. The Handshake pass is on by default and can be turned off; "stop handshake" ends it at once."

INTERVIEWER: Now the switches. Outreach: `on`, `drafts` or `off`. Handshake: `on` or `off`. Who presses submit on applications: `user` (default) or `agent`. LinkedIn account tier: `free` or `premium`.

STUDENT: Outreach on. Handshake off. Submission: agent. LinkedIn tier: skip.

INTERVIEWER: Recorded: outreach on, Handshake off, submission agent; LinkedIn tier left unset. Do you want to change any limits from the defaults?

STUDENT: Set connection requests to 50 a day, nudge after 2 days, and raise my score floor to 4.

INTERVIEWER: I can't raise the connection cap above 20 a day or bring nudges under 5 days, so those two will be clamped to the ceilings and logged. Score floor 4 is stricter than 3.5, so it stands. About the limits: the pack's ceilings (daily applications, connection requests, messages, profile views, and the score floor) are fixed in `scripts/budget.mjs` in the student folder. Limits can only be tightened: daily and rolling caps can be set lower, while minimums (the score floor, which starts at 3.5, the gap between actions, and nudge wait days) can be set higher. Looser values are clamped and logged. A student with an unusual reason to evaluate lower-scoring jobs can read them in the pipeline file, but the pack will not apply to them.

STUDENT: Okay.

## Phase 5: schedule and spend

INTERVIEWER: Automation level: `manual`, `scheduled-discovery` or `scheduled-discovery-plus-triage`? Default is scheduled-discovery.

STUDENT: scheduled-discovery.

INTERVIEWER: What local time should the daily run start, and in which time zone?

STUDENT: 06:30, America/New_York.

INTERVIEWER: Model tier: `standard` or `premium`? There is no economy tier.

STUDENT: standard.

INTERVIEWER: Daily target for applications? Default is 10, and the ceiling still applies.

STUDENT: 8 a day.

INTERVIEWER: How will mail be read for the inbox pass: `connector`, `paste` or `gmail-plugin`?

STUDENT: connector.

INTERVIEWER: Recorded: scheduled-discovery at 06:30 America/New_York, standard tier, 8 applications a day, mailbox via connector.

## Phase 6: write, check, enable

INTERVIEWER: I wrote your answers to data/interview-answers.json, following interview/answers.schema.json. Short summary: Morgan Fixture, morgan.fixture@example.edu, 415-555-0142; F-1 student, needs sponsorship; preset finance-economics; internship track, graduation 2028-05, resume variant finance-main (one page); targets Investment banking analyst and Corporate finance rotational analyst; New York, NY then Charlotte, NC; 0 years of experience; priority Example Capital Partners; blacklist Example Staffing Group; dealbreaker unpaid; two extra target employers; GitHub lists on trial; outreach on, Handshake off, submission agent; score floor 4; connection cap and nudge wait requested at 50 and 2, to be clamped; scheduled-discovery at 06:30 America/New_York; standard tier; 8 a day; mailbox via connector. Is this right?

STUDENT: Yes.

INTERVIEWER: I ran `node interview/apply-answers.mjs --root <ROOT> --data-dir <ROOT>/data --today 2026-10-29 --dry-run`. It exited 0 and would write config/student.yml, config/profile.yml, portals.yml, modes/_profile.md, modes/_brief.md, modes/_custom.md, data/student-github-sources.json and data/blacklist.md. It also printed: "Limits set to their ceilings: connect_per_day, nudge_min_days". This was a dry run, so nothing was written.

INTERVIEWER: Enabling the GitHub-lists plugin (showing its capability card and running it again with `--confirm`) was not performed in a fixture run.

INTERVIEWER: `node doctor.mjs --json` was not performed in a fixture run, so setup is not marked done.

INTERVIEWER: Sign-ins (LinkedIn, then the mailbox; Handshake is off) were not performed in a fixture run. The first run with `rank-queue.mjs` and the top-three walkthrough was not performed in a fixture run either.

STUDENT: Okay, thanks.
