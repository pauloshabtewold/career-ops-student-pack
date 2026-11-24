# Windows test: one page for a friend

Thanks for trying the student pack on Windows. It takes about 30 minutes. Nothing here applies to real jobs: you will use made-up details, and the pack only submits after you approve, so approve nothing.

1. Install. Install Node 22 or newer and Google Chrome. Open PowerShell and follow the README's install steps: `git clone https://github.com/career-ops-hq/career-ops.git career-ops`, then `git clone <pack-address> career-ops/student` (the pack's address from the person who sent you this page), then `node student/setup.mjs` inside `career-ops`.
2. Setup flow. Open Claude Code or Codex in the career-ops folder and say "set me up". Use a made-up name and the sample resume in `student/templates/resume/sample-cv.md`. Every message should end with Next, Type and Why lines.
3. Automation profile. When asked, let it run `node student/scripts/chrome.mjs open`. A separate Chrome window opens. Do not sign in to anything real; close it with `node student/scripts/chrome.mjs close`.
4. Schedule. Let it run `node student/scripts/schedule.mjs install`, then `node student/scripts/schedule.mjs verify`, then `node student/scripts/schedule.mjs remove`.
5. What to send back:
   - your Windows version and Node version (`node --version`);
   - any step that failed, with the last lines it printed;
   - whether every message ended with Next, Type and Why;
   - the file `data\digest\student-<today>.md` if one was written.

Nothing in this test is a release blocker; it tells us what to fix next.
