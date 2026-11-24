# Chrome spike record (P0)

This file records whether the automation Chrome profile is reachable from each place the pack runs, and which schedule
mode follows from that. The tests named below produce the evidence. `tools/schedule-probe.mjs` appends a dated line to
`data/chrome-probe.log` in the career-ops data folder each time it runs; maintainer runs copy that line under Schedule
evidence here.

## Setup under test

- Chrome version: Chrome/157.0.8103.79 (the `Browser` field of `/json/version`, macOS, 2026-11-21).
- Profile: `<data>/chrome-automation`, launched with `--remote-debugging-port=0 --remote-debugging-address=127.0.0.1`.
  Chrome 136 and later refuse remote debugging on the default profile, so the default profile is never used.

## Results

| Check | Test | Result | Date run |
| --- | --- | --- | --- |
| Claude Code Bash opens the profile and reads the mock form | tests/e2e/chrome-spike.test.mjs (M-001-S1) and run 1 below | yes | 2026-11-21 |
| `chrome.mjs status` with only HOME and PATH set (the launchd environment) | tests/e2e/chrome-spike.test.mjs (M-001-S17) and run 2 below | yes | 2026-11-21 |
| Codex (the ChatGPT.app bundle binary found by lib/agent.mjs) runs `chrome.mjs read` | run 3 below; tests/e2e/chrome-codex.test.mjs waits for the M-002 mock ATS server | yes (run 3) | 2026-11-21 |
| Claude in Chrome sees the automation profile | manual check | not checked: the spike never touches the everyday Chrome the extension lives in | |

## Spike runs

All runs used a scratch career-ops root (`<root>` below) with no sign-ins, a page served by node:http on 127.0.0.1,
and a browser slot command (`BROWSER_SLOT_CMD`) that answered 0 before every launch. Each run closed the Chrome it
opened by its recorded PID.

1. Claude Code Bash path, 2026-11-21: `node scripts/chrome.mjs open`, then `read http://127.0.0.1:<port>/spike`, then
   `close` (each with `--root <root> --data-dir <root>/data`). Result: `chrome: ready <root>/data/chrome-automation`;
   state file mode 600 with port and PID; the Chrome command line held only `--user-data-dir=<root>/data/chrome-automation
   --remote-debugging-port=0 --remote-debugging-address=127.0.0.1 --no-first-run --no-default-browser-check`; `read`
   printed the page text; after `close` the recorded PID was gone and the state file removed. The e2e test
   tests/e2e/chrome-spike.test.mjs M-001-S1 passed the same day.
2. Minimal environment, 2026-11-21: `env -i HOME=$HOME PATH=/usr/bin:/bin node scripts/chrome.mjs status --json`
   printed `{"reachable":"yes","port":<the recorded port>,...}`. M-001-S17 (HOME and PATH=/usr/bin:/bin only) passed.
3. Codex reach, 2026-11-21: codex-cli 0.169.0 from the ChatGPT.app bundle (the path lib/agent.mjs `resolveAgentPath`
   returns) ran `codex exec --skip-git-repo-check --sandbox danger-full-access` with the e2e test's prompt asking it to
   run `node scripts/chrome.mjs read <page url> --root <root> --data-dir <root>/data`; its output held the page text.
   tests/e2e/chrome-codex.test.mjs with `CAREER_OPS_AGENT_E2E=1` stops at the import of tests/helpers/mock-ats-server.mjs,
   which ships with M-002; it runs as written once that helper exists.
4. Schedule probe, 2026-11-21: `node tools/schedule-probe.mjs --root <root> --data-dir <root>/data` with the automation
   Chrome open. The one-shot launchd job wrote `{"reachable":"yes",...}`; the probe set `chrome_in_schedule: 'yes'` in
   config/student.yml and appended its dated evidence line to `data/chrome-probe.log` in the student's data folder (never
   to this tracked file, so a pack update is never blocked by an edited file). Afterwards the plist was gone from
   ~/Library/LaunchAgents and `launchctl print gui/<uid>/career-ops.chrome-probe` found no job.

Result: `chrome_in_schedule` is `yes` on this macOS setup while the automation Chrome is open. When the probe or setup
records `no`, the fallback below applies.

## Schedule mode

`chrome_in_schedule` in config/student.yml is `yes` when the scheduled probe reached the automation Chrome and `no`
when the automation Chrome was open but the scheduled job could not reach it. The probe itself leaves the key unset when
its job could not be installed or the automation Chrome was not open; setup-flow runs the probe right after the schedule
step and records `no` whenever the probe could not answer (Linux, a timeout, Chrome closed), so the key never stays
unset after setup, and the scheduled run treats a key still unset after onboarding as `no`. Run the probe again with the
automation Chrome open to record `yes`. With `no`, the scheduled run triages and drafts only; applying, sending and Gmail reads wait until Chrome is
open, and the digest says so with this line:

> waiting for Chrome: <steps>; I'll open the automation Chrome and run them, approve? Type: open my automation Chrome

A headless model call never gets browser tools in either mode.

## Schedule evidence

Each probe run appends one dated line to `data/chrome-probe.log` in the student's data folder.
