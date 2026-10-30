# Codex spike

Counts and verdicts from two probes of the Codex command line (version 0.165.0-alpha.1.2, macOS, arm64). No account details, resume text or paths from the probing machine are kept here.

## Instruction files

- In one folder, AGENTS.override.md is read in place of AGENTS.md. The two are not merged.
- Codex joins every AGENTS file from the project root down to the working folder; deeper files win on conflict.
- `project_doc_max_bytes` defaults to 32768. A 89 KB override file was cut at that size and the text after it never reached the model. With `-c project_doc_max_bytes=131072` the full text arrived. Verdict: the pack block goes first and the limit is raised in the suggested config.

## Unattended runs

Verdict: works. The approval flag is a top-level flag placed before `exec`. A scheduled job passes no stdin. Exit codes seen: 0 on success, 1 on a model failure, 2 on a command-line error. The macOS app bundle ships the binary but puts nothing on PATH, so a schedule needs the full path.

## Interview on five synthetic fixtures

| Check | Result |
|---|---|
| Fixtures run | 5 |
| Preset equals the expected preset | 5/5 |
| Cycle years equal | 5/5 |
| onboarding.complete set | 5/5 |
| Top-10 list length | 10/10 on each fixture |
| Top-level fields equal to the Claude answers | 22 to 24 of 25 to 27 |
| Wall time per run | 46 to 82 s |
| Pipeline counts against the Claude answers | identical on every fixture |

Verdict: Codex finishes the interview unattended and apply-answers accepts its answers file. Differences are small field-shape choices and none changes the ranked list.

Fixture defect: the transcripts hold no application-profile turn, yet the reference answers carry those values. Codex declined to invent them, so the first run failed validation. One scripted reply fixed it, and the fixtures carry the turn.

## Session start without a network

A first run tried a remote update check, which the sandbox blocked, and the run then went on to other repair steps. The pack tolerates an offline session start.

## Tools used

Only shell and apply_patch. No MCP, web, browser or Gmail call happened in any run. The Gmail connector exposes 21 tools, including send, forward and delete ones, so the suggested config disables the write tools. Two read tools, search and read, showed up through tool discovery.

## Needs a real account

- Gmail connector search and read through Codex.
- A live browser run on a real job page.
- The Windows codex.exe location and a Task Scheduler dry run.
- A live interview with a person answering.
- A live triage run that lists its tools and shows none reachable.
