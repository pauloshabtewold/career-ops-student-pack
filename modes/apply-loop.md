# Apply loop

Read this when the user says "apply" or "start applying". The numbers below are enforced by `node student/scripts/budget.mjs`; this file explains the flow.

## Pick the list

1. Run `node student/scripts/rank-queue.mjs --json`. It lists today's rows, at or above the score floor, at most 2 per company. A row with a `closes=YYYY-MM-DD` note that closes within 7 days wins ties on score and shows "closes in N days"; a row whose close date has passed is left out and counted as closed. The usajobs and nyc-jobs feeds fill in `closes=` from the date the API gives. When a posting you read states its own deadline, add `closes=YYYY-MM-DD` to that row's `note:` in `pipeline.md`.
2. Work in batches of 3 forms. A batch is prepared and filled, then shown to the user. Nothing is submitted yet.
3. In the first week (`first_week_days`, 7), submit at most 3 low-stakes applications per session (`first_week_submit_per_session`) to test the pipeline before the full pace. `budget.mjs` enforces it.

## Paths by score

- Below the floor (3.5, or higher if the user raised it): skip.
- 3.5 to 3.9: lean path. Base resume, no cover letter.
- 4.0 and up: full path. Tailored resume and, where the form asks, a short cover letter. When `reviewer` is `on` in config/student.yml, the drafts go through the fresh-context review in `modes/review.md` after they are written and before the batch is shown. When it is `off` (the default), skip that step.

## For each row

1. `node student/scripts/budget.mjs check apply.submit --company "<company>" --track <internship|newgrad> --score <score> --batch <n>`. Exit 3 ends submitting for the day. Exit 5 means the company already has an application on the other track: ask the user.
2. Read the posting. If the description is only available in the browser, check `apply.jd_browser` first (10 per session).
3. Full path only, before drafting a cover letter: check the research cache with `node student/scripts/research-cache.mjs get "<company>"`. Exit 0 prints a note younger than `research_cache_days` (default 30); exit 3 means it is stale and exit 4 that there is none, so research the company yourself and save the note with `node student/scripts/research-cache.mjs put "<company>"` (the note on stdin). Treat a cached note as a lead, not as fact: re-verify every claim you reuse from it (a product, a launch, a date, a name) against the company's own page before it goes into a letter, and drop what you cannot confirm. The cache stays on this computer.
4. Before any upload run `node student/scripts/check-resume.mjs --pdf <file> --html <file> --variant <name>`; `--html` is the HTML or markdown source the PDF was rendered from. Exit 1 means the resume does not match the track or would not survive an applicant-tracking parse: fix it, do not upload. The guard also reads the PDF's text layer and fails an image-only PDF, an email or phone from the source that is not text in the PDF, en or em dashes in date ranges (use an ASCII hyphen) and words run together with no spaces between them (re-render without letter-spacing or justified body text), because those parsers drop or merge that text.
5. Fill the form. If the site needs a sign-in, stop and ask the student to sign in themselves (Google or LinkedIn SSO only, never a password), then continue once they say they are in.
6. Employer policies (for example "2 per cycle") come from the preset and from what a form reveals. When a form reveals one, record it with `node student/scripts/budget.mjs log apply.policy --company "<company>"` and the numbers, then stop at the cap and tell the user.

## Fact gate

Write nothing about the user that does not come from `cv.md` or from the user in this chat. If a form asks for something neither source answers, ask.

## Submit

Show the filled batch. Submit only after "submit all" or "submit 1,3". After each submit run `node student/scripts/budget.mjs log apply.submit --company "<company>" --track <track> --score <score> --approval "<the user's words>"`. Then set the status with upstream's tracker as usual.
