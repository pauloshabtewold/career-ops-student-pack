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
- A clone of career-ops at a release the pack supports; the setup prompt and the install blocks below check out career-ops-v1.39.0, the release it was tested with (the pack refuses to install on an older one)

## Install (one prompt)

You need Codex or Claude Code, signed in, on macOS or Windows 11. Claude Code means the Code tab of the Claude desktop app or the `claude` command in a terminal; plain chat on claude.ai cannot run commands on your computer, so it cannot do this. Codex means the Codex app (inside the ChatGPT desktop app on macOS) or the `codex` command.

1. Optional, one setting: so the agent does not stop for approval on every command, give it permission before you paste. In Claude Code choose the Auto permission mode (desktop: the mode menu next to the message box; terminal: start it with `claude --permission-mode auto`). In Codex choose Full access in the permissions menu (terminal: `codex --sandbox danger-full-access`). A pasted prompt cannot change this setting for you. If you skip it, the agent still does everything; you just press Approve when the app asks.
2. Start a new chat. The folder it starts in does not matter.
3. Paste this whole prompt and send it. That is the only thing you type until the interview starts.

```
Set up the career-ops student pack on this computer for me, from start to finish, then start my personalization interview in this same chat.

First, before any command, tell me this in one short line: "If I ever hand you a step, just say do it for me and I'll do it for you, as long as you give me permission. Passwords, sign-ins and new accounts stay with you."

Permission: I give you permission to run every setup command below without asking me first: installing Node.js and git (including adding Node to PATH in my shell profile), cloning the two repositories, npm installs, the Playwright browser download, and writing the pack's settings files inside the career-ops folder. If the app shows an approval button I will press it. Fix any error yourself and keep going; do not hand steps back to me. Stop only for a password, a sign-in or a new account; those are mine. If you truly must ask me something, ask everything at once as one numbered list: each item says in one line what it decides, gives a default marked (recommended) with a one-line reason, and lists the other options, so one reply from me can accept them all. This permission covers setup only: never remove the pack's Gmail send/delete/archive block or its budget and safety limits.

1. Tools. Make sure git and Node.js 22.13 or newer are installed and on PATH. macOS: git comes with Apple's Command Line Tools (if git is missing, run xcode-select --install and wait while I click Install). For Node, use brew install node only if Homebrew is already installed and has a ready-made bottle for this macOS; otherwise download the official Node.js LTS tarball for this Mac's CPU from nodejs.org/dist, check it against that release's SHASUMS256.txt, unpack it into ~/.local/node (no sudo), put its bin folder first on PATH for this chat and add that PATH line to ~/.zprofile. Windows 11: winget install --silent --accept-source-agreements --accept-package-agreements OpenJS.NodeJS.LTS and the same for Git.Git; tell me first to click Yes if Windows asks whether the installer may make changes. If the commands are still not found, use their full paths or a new shell.
2. Folder. Do not ask me where. Use a folder named career-ops directly inside my home folder ($HOME on macOS, $env:USERPROFILE on Windows). Never use Desktop, Documents, iCloud Drive, OneDrive, Dropbox or Google Drive, because they sync. If that folder already holds career-ops with a student folder in it, reuse it: run git -C student pull --ff-only there and go to step 4. If it holds career-ops without a student folder (an earlier attempt stopped), reuse it and clone only the pack in step 3. If it exists but is not a career-ops clone, use career-ops-2 instead.
3. Clone, with <folder> being the folder from step 2. The pack's address comes from GitHub's lookup for repository number 1436295728 (a fixed id, so a look-alike copy cannot stand in for it): read the clone_url field of https://api.github.com/repositories/1436295728 (macOS: curl -s that address; Windows: Invoke-RestMethod) and check that its name field is career-ops-student-pack. Then:
   git clone https://github.com/career-ops-hq/career-ops.git <folder>
   git clone <clone_url> <folder>/student
4. In <folder>, run: node student/setup.mjs
   It checks out the career-ops release the pack supports, installs packages, writes the Codex and Claude Code project settings, downloads the Playwright browser and checks the result. If it prints an error, fix the cause and run it again until it prints SETUP OK.
5. Tell me in one line the full path of the folder, and that next time I can open that folder in Codex or Claude Code and say hello.
6. Start the interview now, without waiting for me. From here on run every command inside <folder>. Read <folder>/student/AGENTS.student.md and follow it as your rules for this chat. Then do what its Session start section says, from <folder>: it runs the session-start script and, the first time, starts the personalization interview. Do not ask me for any sign-in during setup; the interview handles those.
```

The agent tells you first that you can say "do it for me" whenever it would otherwise hand you a step, such as opening the project or trusting the folder. Say it and give permission, and it does that step. Passwords, sign-ins and creating accounts always stay with you: the agent explains the step, waits while you do it, then checks the result. Setup itself asks for no sign-in; the interview covers those.

What `setup.mjs` does, so you know what you are allowing: it refuses to run in a folder that iCloud, OneDrive, Dropbox or Google Drive syncs; checks out the career-ops release named in the pack's `compat.json` (the newest one the pack was tested with) and runs `npm install`; runs `install.mjs` (below); copies `templates/codex-config.suggested.toml` to `.codex/config.toml` (it turns off the Gmail tools that send, delete or archive mail) and the safe pack commands in `templates/claude-settings.suggested.json` into `.claude/settings.local.json`, in each case only when the file is missing, or adding missing allow entries to an existing Claude file, and never overwriting a copy you changed; runs `npx playwright install chromium`; and checks that the pack files are in place. Running it again does no harm.

Your career-ops folder holds your resume, tracker and pipeline in its `data` folder, which is why the prompt keeps it out of synced folders: a sync client can upload those files or make conflicting copies.

## Install by hand

If you prefer to type the steps yourself, run the block for your system in a terminal (Terminal on macOS, PowerShell on Windows 11), from your home folder. Each block does everything up to the install script, so use one only: install Node and git, clone career-ops and move it to the release this pack was tested with, install its packages, clone this pack into a folder named `student`, then run the pack installer.

For the pack clone, open the page you were sent for this pack, press the green Code button, choose HTTPS and copy the address. Paste it where `<pack-address>` is.

macOS (Terminal; needs [Homebrew](https://brew.sh), so install it first if `brew` is not found):

```
brew install node git
git clone https://github.com/career-ops-hq/career-ops.git
cd career-ops
git checkout -B main career-ops-v1.39.0
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
git checkout -B main career-ops-v1.39.0
npm install
git clone <pack-address> student
node student/install.mjs
```

`install.mjs` installs the pack's own packages (`npm ci --omit=dev` in the student folder) and, if career-ops has no `node_modules` yet, runs `npm install` there too. Then it writes only inside your career-ops folder: it lists `student/`, `CLAUDE.local.md`, `AGENTS.override.md`, `.codex/config.toml` and `.claude/settings.local.json` in `config/local-paths.txt`, adds the same five plus `config/student.yml` to `.git/info/exclude`, writes the import block in `CLAUDE.local.md`, generates `AGENTS.override.md` for Codex (the pack rules, then a copy of upstream's `AGENTS.md`), and copies the pack plugins into `plugins.local/`. It does not turn any plugin on, and it writes neither `.codex/config.toml` nor `.claude/settings.local.json`; `setup.mjs` copies those. Running it again is safe: it repeats the `npm ci` step, skips the career-ops `npm install` when `node_modules` already exists, copies the pack plugins again and leaves its other edits as they are.

Then run `node student/setup.mjs` from the career-ops folder for the settings files and the Playwright browser (or skip it and do those steps yourself), and open the career-ops folder in Claude Code or Codex. Codex install steps are in [docs/codex.md](docs/codex.md). The personalization interview starts on its own the first time. It reads your resume, asks its questions in four batches and ends with your first top 10 list of postings to apply to and a guide to what to say.

Keep the career-ops folder out of iCloud Drive, OneDrive, Dropbox and Google Drive (on a Mac, Desktop and Documents count when iCloud syncs them).

## Browser setup

Applying, the Handshake pass and LinkedIn outreach run in a browser you sign in to yourself; the agent never types a password.

- **Codex.** On macOS Codex uses the ChatGPT in-app browser. Windows has no Codex browser tool, so browser steps stay in Claude Code there.
- **Claude in Chrome.** Install Google Chrome and the Claude in Chrome extension from the Chrome Web Store, then sign in to LinkedIn, Handshake and your job sites in that Chrome.
- **Playwright.** Upstream also uses its own headless browser for some pages. In the career-ops folder run `npx playwright install chromium` once. Upstream's `doctor.mjs` also warns when the Playwright MCP tools are missing; the pack uses Claude in Chrome for browser steps, so that warning can be left alone.
- **Fewer permission prompts.** `templates/claude-settings.suggested.json` in the pack lists the pack commands that are safe to allow without asking each time. `setup.mjs` adds them to `.claude/settings.local.json` in the career-ops folder, a project file that applies to that folder only; it never touches your own Claude Code settings.

## Update

```
node student/update.mjs
```

This updates the pack and career-ops together and keeps career-ops inside the version range the pack supports. If you committed your own changes inside the student folder, or edited a pack file there without committing, the pack update is skipped and the script says which. Keep your own agent notes outside the marked blocks of AGENTS.override.md, which the pack keeps on every rebuild.

## Daily use

- **Interview.** The first Claude Code or Codex session starts the personalization interview on its own, in four parts: sign-ins, your job queue, your application profile, and the schedule with its switches. Each part is one numbered batch with a recommended answer for every item, so "all recommended" accepts them all. It writes config/student.yml. Running it again rewrites only the blocks the pack marked in your files, never overwrites `cv.md`, and replaces only the `application_answers` block of `profile.yml`.
- **First run.** The interview builds your job queue in part two (`node student/scripts/first-run.mjs --queue` shows the postings with no grades), then in part four scores the rows that fit your first-run triage budget (60 rows unless you raise it) and shows your top 10 with `node student/scripts/rank-queue.mjs --n 10`. It ends with a guide to what to say, kept in [docs/commands.md](docs/commands.md); say "help" any time to see it again.
- **Schedule.** `node student/scripts/schedule.mjs install` sets up the optional daily run on macOS or Windows; `remove` undoes it. The time is read in the time zone from your interview, and install prints the matching time on the computer's clock when the two differ. The job starts `scheduled.mjs`, which runs the daily run, then the inbox pass if you turned it on (alert emails and company replies reach your queue without opening a session), and, only if you chose scheduled discovery plus triage, a model triage of up to your daily triage budget (20 rows unless you raise it). `node student/scripts/schedule.mjs verify` proves the job and each step work.
- **Daily run.** `node student/scripts/daily.mjs` pulls job lists (plus the NYC Jobs and USAJOBS feeds, if you enabled them), scans, filters and applies the free title filter without any model call, then writes a digest in the digest folder under data. Add `--dry-run` to see the steps without running them.
- **Inbox.** `node student/scripts/inbox.mjs` reads pasted or connector-provided mail and updates the tracker.
- **Pilot report.** `node student/scripts/pilot-report.mjs` prints weekly counts and nothing else.

Details are in [docs/usage.md](docs/usage.md); the reasoning behind the design is in [docs/architecture.md](docs/architecture.md).

## Uninstall

From the career-ops folder:

```
node student/uninstall.mjs
```

It removes the daily schedule (only if it runs this career-ops folder), the pack plugins through upstream's `plugins.mjs remove`, the pack blocks in `CLAUDE.local.md` and `AGENTS.override.md` (deleting each file only if nothing else is in it), the pack lines in `config/local-paths.txt` and git's `info/exclude` (found through git, so it also works when `.git` is a file), and upstream's `.update-dismissed` marker when it dismissed a release this pack does not support. Your data folder, `cv.md`, `profile.yml`, `portals.yml`, `config/student.yml` and `.claude/settings.local.json` (the permissions `setup.mjs` added to it) stay, and so does that file's line in the ignore lists while the file exists; delete the permission entries by hand if you do not want them. Add `--dry-run` to see the list first. Then delete the `student` folder: `rm -rf student` on macOS, `Remove-Item -Recurse -Force student` in PowerShell.

## Switching things off

LinkedIn outreach and the Handshake pass are on by default. Tell Claude "stop outreach" or "stop handshake" at any time. The caps on messages, applications and page loads are compiled into `scripts/budget.mjs` in the student folder; settings can only tighten them (lower a maximum, raise a minimum) and never loosen them. The model-usage triage budget is the exception: it is yours, you change it with `node student/scripts/triage-budget.mjs set`, and [docs/usage-cost.md](docs/usage-cost.md) shows what it costs.

## Credit

Built on [career-ops](https://github.com/career-ops-hq/career-ops) by its authors and contributors (MIT). The pack contains no upstream code; it calls upstream scripts as command-line tools and uses upstream's documented plugin API.

## License

MIT. See [LICENSE](LICENSE).
