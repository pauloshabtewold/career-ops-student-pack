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
  config/local-paths.txt    declares the pack files as user-owned
  plugins.local/            pack feeds installed as upstream ingest plugins
```

Supported: macOS and Windows 11, Claude Code, US job markets.

## Requirements

- macOS or Windows 11 with [Claude Code](https://claude.com/claude-code)
- Node 22.13 or newer, and git
- A clone of career-ops at version 1.38.0 or newer (the pack refuses to install on an older one)

## Install

Open a terminal in your career-ops folder.

macOS (Terminal):

```
git clone <pack-url> student
node student/install.mjs
```

Windows 11 (PowerShell):

```
git clone <pack-url> student
node student/install.mjs
```

Then open the career-ops folder in Claude Code. The personalization interview starts on its own the first time.

`install.mjs` writes only inside your career-ops folder: it lists `student/` and `CLAUDE.local.md` in `config/local-paths.txt`, adds the pack entries to `.git/info/exclude`, writes the import block in `CLAUDE.local.md`, and copies the pack plugins into `plugins.local/`. It does not turn any plugin on, and it never edits a Claude Code settings file. Running it again changes nothing.

## Update

```
node student/update.mjs
```

This updates the pack and career-ops together and keeps career-ops inside the version range the pack supports. If you committed your own changes inside `student/`, the pack update is skipped and the script says so.

## Daily use

- **Interview.** The first Claude Code session starts the personalization interview on its own; it writes `config/student.yml` and offers the daily schedule.
- **Schedule.** `node student/scripts/schedule.mjs install` sets up the optional daily run on macOS or Windows; `remove` undoes it.
- **Daily run.** `node student/scripts/daily.mjs` pulls job lists, scans, filters and triages without any model call, then writes a digest in `data/digest/`.
- **Inbox.** `node student/scripts/inbox.mjs` reads pasted or connector-provided mail and updates the tracker.
- **Pilot report.** `node student/scripts/pilot-report.mjs` prints weekly counts and nothing else.

Details are in [docs/usage.md](docs/usage.md); the reasoning behind the design is in [docs/architecture.md](docs/architecture.md).

## Switching things off

LinkedIn outreach and the Handshake pass are on by default. Tell Claude "stop outreach" or "stop handshake" at any time. The caps on messages, applications and page loads are compiled into `student/scripts/budget.mjs`; settings can only tighten them (lower a maximum, raise a minimum) and never loosen them.

## Credit

Built on [career-ops](https://github.com/career-ops-hq/career-ops) by its authors and contributors (MIT). The pack contains no upstream code; it calls upstream scripts as command-line tools and uses upstream's documented plugin API.

## License

MIT. See [LICENSE](LICENSE).
