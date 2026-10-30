# Codex

Codex support is a preview. The interview, the first run, the daily run and the inbox work in Codex the same way they do in Claude Code. The unattended triage is the part that has had the least checking; see the list at the end. Counts and verdicts from the probing are in [codex-spike.md](codex-spike.md).

## What Codex reads

Codex reads `AGENTS.override.md` in your career-ops folder in place of `AGENTS.md`. The installer generates that file: the pack rules come first, then a verbatim copy of upstream's `AGENTS.md`. Codex loads only the first 32 KiB of project instructions by default and upstream's file alone is larger than that, so the pack block has to come first or Codex would never see it. The file is generated; the source of the pack block is AGENTS.student.md in the student folder, so edit nothing in the override file between the marker lines. Text you add outside the marker lines is kept.

## Install

macOS: the ChatGPT app ships Codex at `/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex`. That path is not on your PATH, which is fine; the pack finds it. Without the app, run `curl -fsSL https://chatgpt.com/codex/install.sh | sh` in Terminal.

Windows 11: in PowerShell run `irm https://chatgpt.com/codex/install.ps1 | iex`, or with Node installed run `npm i -g @openai/codex`.

Run `codex` once in a terminal and sign in with your ChatGPT account. Then install the pack as the README describes and open the career-ops folder in Codex.

## Pick the agent

The interview records your choice. Running it in Codex writes `agent: codex` in config/student.yml, and running it in Claude Code writes `agent: claude`. The daily triage and the schedule read that key. To change agents, change the key and run `node student/scripts/schedule.mjs install` again.

## Optional project config

The pack ships `templates/codex-config.suggested.toml` (in the student folder). Copy it to the project config location in your career-ops folder yourself; the pack never writes it. On macOS:

```
mkdir -p .codex
cp student/templates/codex-config.suggested.toml .codex/config.toml
```

On Windows, make a `.codex` folder and copy the file into it under the name config.toml. Codex reads a project config only for a trusted folder, so accept its trust prompt for the folder when it asks. A `codex exec` run with the workspace-write sandbox does not ask: its first run in the folder marks it trusted by adding a `[projects."<folder>"]` entry to your own `~/.codex/config.toml`. Delete that entry to undo it. The template raises the instruction limit, picks the workspace-write sandbox with network access and switches off the Gmail write tools.

The pack leaves your own Codex settings alone. If you skip the template, the limit can be raised per run with `-c project_doc_max_bytes=131072`.

The Gmail tool keys in the template come from the Codex binary and are unverified. The rule in `AGENTS.student.md` that forbids Gmail send, forward, delete, trash, archive and draft calls is the main guard; the keys are a second one.

## After an update

`node student/update.mjs` regenerates `AGENTS.override.md` when the pack rules change. Codex reads that file only when a session starts, so restart Codex after every update.

## Daily triage

With `automation: scheduled-discovery-plus-triage` and `agent: codex`, `node student/scripts/schedule.mjs install` sets up a schedule whose triage step runs one read-only `codex exec` call. The call has these locks:

- `--ignore-user-config`, so none of your own MCP servers or hooks load
- the apps, plugins, browser, computer-use, shell and hooks features disabled
- web search disabled

The locks are checked by the flags being accepted, not by a live run that lists its tools. Treat the triage as a preview.

The digest carries the same lines as with Claude: `daily triage: triaged N, passed N, ignored N`, or a note saying why triage was skipped (agent not found, signed out, timed out). A skipped triage changes nothing and the rows wait for the next day.

## What stays Claude-only

The browser steps (applying, the Handshake pass, LinkedIn outreach) use Claude in Chrome. Codex has the ChatGPT in-app browser on macOS only. On Windows, and wherever no browser tool exists, Codex stops and tells you to do the step by hand or in Claude Code.

## Needs a real account

These checks need a live sign-in or a second machine and have not been done:

- Gmail connector search and read through Codex.
- The Gmail write-tool keys in the template taking effect (unverified).
- A live browser run on a real job page.
- The Windows codex.exe location and a Task Scheduler dry run.
- A live interview with a person answering.
- A live triage run asked to list its tools, showing no Gmail, browser, MCP or web tool.
