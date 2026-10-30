# Codex

On macOS, the interview, the first run, the daily run, the inbox and the unattended triage work in Codex the same way they do in Claude Code; the triage lockdown and the Gmail keys were checked in live runs. Windows and the browser steps are still a preview; see the list at the end. Counts and verdicts from the probing are in [codex-spike.md](codex-spike.md).

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

On Windows, make a `.codex` folder and copy the file into it under the name config.toml. The template raises the instruction limit, picks the workspace-write sandbox with network access and switches off the Gmail tools that change mail.

Codex reads a project config only for a trusted folder. In a folder it does not trust, it skips `.codex/config.toml` without a warning; the header of a `codex exec` run then says `sandbox: read-only` where the template asks for workspace-write. To trust the folder, start `codex` in it once and accept its trust prompt. A `codex exec` run with `-s workspace-write` does not ask: it writes the trust entry into your own Codex settings by itself, even with `--ephemeral`. That first run still ignores the project config, and the next run uses it. A read-only `codex exec` run, such as the scheduled triage, writes no trust entry.

The pack leaves your own Codex settings alone. If you skip the template, the limit can be raised per run with `-c project_doc_max_bytes=131072`.

The template turns off 11 Gmail tools: send, send draft, forward, delete, archive, create and update draft, and the four label and modify tools, because a label change can archive or trash mail. Codex keys app settings by the connector id, so the entries read `[apps.connector_2128aebfecb84f64a069897515042a44.tools.send_email]`; an `[apps.gmail...]` entry has no effect. A live run in a trusted folder, asked to list its Gmail tools and call none, showed only the 10 read tools with the template in place and all 21 without it. The rule in `AGENTS.student.md` that forbids Gmail send, forward, delete, trash, archive and draft calls is still the main guard; the template is a second one.

## After an update

`node student/update.mjs` regenerates `AGENTS.override.md` when the pack rules change. Codex reads that file only when a session starts, so restart Codex after every update.

## Daily triage

With `automation: scheduled-discovery-plus-triage` and `agent: codex`, `node student/scripts/schedule.mjs install` sets up a schedule whose triage step runs one read-only `codex exec` call. The call has these locks:

- `--ignore-user-config`, so none of your own MCP servers or hooks load
- the apps, plugins, browser, computer-use, shell, hooks, image generation, goals and image viewer features disabled
- web search disabled

A live run on macOS (codex-cli 0.166), asked to list every tool it could call and call none, showed no Gmail, browser, MCP server, web or shell tool. What is left is a JavaScript runner with no file, process or network access, apply_patch (blocked by the read-only sandbox) and the agent-collaboration tools. On Windows the same flags are passed but no live run has listed the tools yet, so treat the Windows triage as a preview.

A codex too old to know one of the disabled feature names stops with "Unknown feature flag"; the digest then says to update codex or the pack, not to sign in.

The call runs once per 20 rows of your daily triage budget. The digest carries the same lines as with Claude: a progress line per chunk, `daily triage: triaged N, passed N, ignored N`, a cost line with the rows scored today and an estimate, or a note saying why triage was skipped (agent not found, signed out, timed out). A skipped triage changes nothing and the rows wait for a later day. For what the estimate means on ChatGPT Plus and Pro, and how to read your own share with `/status`, see [usage-cost.md](usage-cost.md).

## What stays Claude-only

The browser steps (applying, the Handshake pass, LinkedIn outreach) use Claude in Chrome. Codex has the ChatGPT in-app browser on macOS only. On Windows, and wherever no browser tool exists, Codex stops and tells you to do the step by hand or in Claude Code.

## Needs a real account

These checks need a live sign-in or a second machine and have not been done:

- Gmail connector search and read through Codex.
- A live browser run on a real job page.
- The Windows codex.exe location, a Task Scheduler dry run and a Windows triage run that lists its tools.
- A live interview with a person answering.
