# Fresh LinkedIn jobs

Read this when the user asks for fresh jobs or new LinkedIn jobs, or when the digest has a `fresh LinkedIn page:` line with new rows.

Postings that are an hour old get far fewer applicants. The hourly scan reads the public Greenhouse, Lever and Ashby boards with no model call; this mode adds the student's own LinkedIn past-hour saved search, read in the automation Chrome.

## Rules

- One page, one tab, the student's own signed-in LinkedIn in the automation Chrome. Never search LinkedIn any other way and never fetch linkedin.com over HTTP.
- The past-hour page (the "Fresh LinkedIn jobs" line of `node student/scripts/alert-plan.mjs`, filter `f_TPR=r3600`) is read only through `node student/scripts/fresh-scan.mjs`: hourly by the schedule, or with `--linkedin` in a session. It runs `node student/scripts/budget.mjs check linkedin.fresh_search` before the read and `log` after it, reads the page as text with its links, and takes the job cards out by code. No screenshots.
- A LinkedIn warning or restriction notice stops all LinkedIn work for the day: run `node student/scripts/budget.mjs warning linkedin`.

## Steps

1. When today's digest has a `fresh LinkedIn page:` line, the hourly scan already read the page and put only the new postings in Pending, noted `src=fresh-linkedin` with today's `imported=` date. Work only on those rows; do not read the search page again.
2. Otherwise run `node student/scripts/fresh-scan.mjs --linkedin`. It runs the `linkedin.fresh_search` check and log itself, reads the past-hour page once with `chrome.mjs read --links`, dedupes the job cards against `data/fresh-seen.tsv` and the pipeline by code and adds only the new ones to Pending. Then work on the rows it added. When its digest line is missing, the check said the hourly read already happened, and the rows that read added are already in Pending.
3. For each new row, open that one posting. Skip it when it is marked closed or no longer accepting. When the post links out to the employer's own site, add the employer's link to Pending: the employer ATS goes first.
4. An Easy Apply post goes into the next one-page apply batch like any other item. It is submitted only after the student approves the batch, through `node student/scripts/chrome.mjs submit --kind easy-apply --batch-id <batch-id> --item <n>`, which runs `node student/scripts/budget.mjs check apply.easy_apply --company "<company>" --score <score> --batch 1 --batch-id <batch-id> --item <n>` first and clicks nothing on exit 3. Easy Apply is capped at 12 a day with LinkedIn's 45 to 120 second gap between actions, in one tab.

Next: read the past-hour LinkedIn search
Type: check new LinkedIn jobs
Why: postings an hour old have the fewest applicants, and approved items go out in your next batch.
You can always ask me for more. Just ask and approve.
