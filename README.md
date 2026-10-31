# career-ops student pack

A student layer for [career-ops](https://github.com/career-ops-hq/career-ops): graduation-cycle awareness, field presets built on employer lists, GitHub job-list feeds, a zero-token prefilter and triage queue, a ranked daily apply list, and the house rules that turn evaluations into a working apply loop.

**Status: friends pilot.** This is a free pack shared with a handful of friends. It is not a product, it has not been proven on many machines yet, and it may change without notice.

## Disclaimer

This pack is not affiliated with or endorsed by LinkedIn, Handshake, career-ops or any employer. You are responsible for following the terms of every site you use it with. LinkedIn and Handshake automation can lead to limits or restrictions on your accounts; both are on by default and each can be switched off at any time ("stop outreach", "stop handshake"). The software comes with no warranty of any kind (MIT license).

## How it fits

The pack does not fork career-ops. You keep a plain clone of upstream career-ops, which updates itself as usual, and clone this pack into its `student/` folder. The pack hooks in through `CLAUDE.local.md` and upstream's own extension points (`config/local-paths.txt`, `plugins.local/`), so the two never edit the same file.

```
career-ops/                 plain clone of career-ops-hq/career-ops
  student/                  this pack, its own git clone and update channel
  CLAUDE.local.md           generated hook that imports student/AGENTS.student.md
  AGENTS.override.md        generated for Codex, pack rules first
  config/local-paths.txt    declares the pack files as user-owned
  plugins.local/            pack feeds installed as upstream ingest plugins
```

Supported: macOS and Windows 11, Claude Code or Codex, US job markets.

## Requirements

- macOS or Windows 11 with [Claude Code](https://claude.com/claude-code) or Codex (Windows and the browser steps are a preview; see [docs/codex.md](docs/codex.md)), signed in
- Node 22.13 or newer, and git
- A clone of career-ops at version 1.38.0 or newer (the pack refuses to install on an older one)

## Install

Do these steps once, in order. Each block is typed in a terminal: Terminal on macOS, PowerShell on Windows 11.

**1. Run the block for your system.** Each block does everything up to the install script, so use one only. The steps are: install Node and git, clone career-ops, install its packages, clone this pack into a folder named `student`, then run the pack installer.

For the pack clone, open the page you were sent for this pack, press the green Code button, choose HTTPS and copy the address. Paste it where `<pack-address>` is.

macOS (Terminal; needs [Homebrew](https://brew.sh), so install it first if `brew` is not found):

```
brew install node git
git clone https://github.com/career-ops-hq/career-ops.git
cd career-ops
npm install
git clone <pack-address> student
node student/install.mjs
```

Windows 11 (PowerShell; if `winget` reports that the programs were installed but the next command is not found, close the window, open a new one and continue from the `git clone` line):

```
winget install OpenJS.NodeJS.LTS
winget install Git.Git
git clone https://github.com/career-ops-hq/career-ops.git
cd career-ops
npm install
git clone <pack-address> student
node student/install.mjs
```

`install.mjs` installs the pack's own packages (`npm ci --omit=dev` in the student folder) and, if career-ops has no `node_modules` yet, runs `npm install` there too. Then it writes only inside your career-ops folder: it lists `student/`, `CLAUDE.local.md`, `AGENTS.override.md` and `.codex/config.toml` in `config/local-paths.txt`, adds the same four plus `config/student.yml` to `.git/info/exclude`, writes the import block in `CLAUDE.local.md`, generates `AGENTS.override.md` for Codex (the pack rules, then a copy of upstream's `AGENTS.md`), and copies the pack plugins into `plugins.local/`. It does not turn any plugin on, and it never edits a Claude Code settings file. Running it again is safe: it repeats the `npm ci` step, skips the career-ops `npm install` when `node_modules` already exists, copies the pack plugins again and leaves its other edits as they are.

**2. Open the career-ops folder in Claude Code or Codex.** Codex install steps are in [docs/codex.md](docs/codex.md). The personalization interview starts on its own the first time. It reads your resume, asks a few questions and ends with your first top 10 list of postings to apply to.

Keep the career-ops folder out of iCloud Drive, OneDrive, Dropbox and Google Drive. Your resume, tracker and pipeline live in its `data` folder, and a sync client can upload them or make conflicting copies.

## Browser setup

Applying, the Handshake pass and LinkedIn outreach run in a browser you sign in to yourself; the agent never types a password.

- **Codex.** On macOS Codex uses the ChatGPT in-app browser. Windows has no Codex browser tool, so browser steps stay in Claude Code there.
- **Claude in Chrome.** Install Google Chrome and the Claude in Chrome extension from the Chrome Web Store, then sign in to LinkedIn, Handshake and your job sites in that Chrome.
- **Playwright.** Upstream also uses its own headless browser for some pages. In the career-ops folder run `npx playwright install chromium` once. Upstream's `doctor.mjs` also warns when the Playwright MCP tools are missing; the pack uses Claude in Chrome for browser steps, so that warning can be left alone.
- **Fewer permission prompts (optional).** `templates/claude-settings.suggested.json` in the pack lists the pack commands that are safe to allow without asking each time. If you want it, merge those entries into your own Claude Code settings by hand. The pack never writes a settings file for you.

## Update

```
node student/update.mjs
```

This updates the pack and career-ops together and keeps career-ops inside the version range the pack supports. If you committed your own changes inside the student folder, or edited a pack file there without committing, the pack update is skipped and the script says which. Keep your own agent notes outside the marked blocks of AGENTS.override.md, which the pack keeps on every rebuild.

## Daily use

- **Interview.** The first Claude Code or Codex session starts the personalization interview on its own; it writes config/student.yml. Running it again rewrites only the blocks the pack marked in your files and never overwrites the files `cv.md` and `profile.yml` in your career-ops folder.
- **First run.** `node student/scripts/first-run.mjs` brings in the first postings and lists up to 20 that still need a verdict, within your first-run triage budget (60 rows unless you raise it). The interview runs it for you, scores those rows in the session and shows your top 10 with `node student/scripts/rank-queue.mjs --n 10`.
- **Schedule.** `node student/scripts/schedule.mjs install` sets up the optional daily run on macOS or Windows; `remove` undoes it. The time is read in the time zone from your interview, and install prints the matching time on the computer's clock when the two differ. The job starts `scheduled.mjs`, which runs the daily run and, only if you chose scheduled discovery plus triage, a model triage of up to your daily triage budget (20 rows unless you raise it).
- **Daily run.** `node student/scripts/daily.mjs` pulls job lists (plus the NYC Jobs and USAJOBS feeds, if you enabled them), scans, filters and applies the free title filter without any model call, then writes a digest in the digest folder under data. Add `--dry-run` to see the steps without running them.
- **Inbox.** `node student/scripts/inbox.mjs` reads pasted or connector-provided mail and updates the tracker.
- **Pilot report.** `node student/scripts/pilot-report.mjs` prints weekly counts and nothing else.

Details are in [docs/usage.md](docs/usage.md); the reasoning behind the design is in [docs/architecture.md](docs/architecture.md).

## Uninstall

From the career-ops folder:

```
node student/uninstall.mjs
```

It removes the daily schedule (only if it runs this career-ops folder), the pack plugins through upstream's `plugins.mjs remove`, the pack blocks in `CLAUDE.local.md` and `AGENTS.override.md` (deleting each file only if nothing else is in it), the pack lines in `config/local-paths.txt` and git's `info/exclude` (found through git, so it also works when `.git` is a file), and upstream's `.update-dismissed` marker when it dismissed a release this pack does not support. Your data folder, `cv.md`, `profile.yml`, `portals.yml` and `config/student.yml` stay. Add `--dry-run` to see the list first. Then delete the `student` folder: `rm -rf student` on macOS, `Remove-Item -Recurse -Force student` in PowerShell.

## Switching things off

LinkedIn outreach and the Handshake pass are on by default. Tell Claude "stop outreach" or "stop handshake" at any time. The caps on messages, applications and page loads are compiled into `scripts/budget.mjs` in the student folder; settings can only tighten them (lower a maximum, raise a minimum) and never loosen them. The model-usage triage budget is the exception: it is yours, you change it with `node student/scripts/triage-budget.mjs set`, and [docs/usage-cost.md](docs/usage-cost.md) shows what it costs.

## Credit

Built on [career-ops](https://github.com/career-ops-hq/career-ops) by its authors and contributors (MIT). The pack contains no upstream code; it calls upstream scripts as command-line tools and uses upstream's documented plugin API.

## License

MIT. See [LICENSE](LICENSE).
