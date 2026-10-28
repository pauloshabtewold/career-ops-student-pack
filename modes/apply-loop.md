# Apply loop

Read this when the user says "apply" or "start applying". The numbers below are enforced by `node student/scripts/budget.mjs`; this file explains the flow.

## Pick the list

1. Run `node student/scripts/rank-queue.mjs --json`. It lists today's rows, at or above the score floor, at most 2 per company.
2. Work in batches of 3 forms. A batch is prepared and filled, then shown to the user. Nothing is submitted yet.

## Paths by score

- Below the floor (3.5, or higher if the user raised it): skip.
- 3.5 to 3.9: lean path. Base resume, no cover letter.
- 4.0 and up: full path. Tailored resume and, where the form asks, a short cover letter.

## For each row

1. `node student/scripts/budget.mjs check apply.submit --company "<company>" --track <internship|newgrad> --score <score> --batch <n>`. Exit 3 ends submitting for the day. Exit 5 means the company already has an application on the other track: ask the user.
2. Read the posting. If the description is only available in the browser, check `apply.jd_browser` first (10 per session).
3. Before any upload run `node student/scripts/check-resume.mjs --pdf <file> --source <html> --variant <name>`. Exit 1 means the resume does not match the track: fix it, do not upload.
4. Fill the form. Sign in only through "Continue with Google" or "Continue with LinkedIn" on a site the user approved in this chat. Never use a password.
5. Employer policies (for example "2 per cycle") come from the preset and from what a form reveals. When a form reveals one, record it with `budget.mjs log apply.policy --company "<company>"` and the numbers, then stop at the cap and tell the user.

## Fact gate

Write nothing about the user that does not come from `cv.md` or from the user in this chat. If a form asks for something neither source answers, ask.

## Submit

Show the filled batch. Submit only after "submit all" or "submit 1,3". After each submit run `node student/scripts/budget.mjs log apply.submit --company "<company>" --track <track> --score <score> --approval "<the user's words>"`. Then set the status with upstream's tracker as usual.
