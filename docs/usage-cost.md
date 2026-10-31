# What the triage costs

The model triage reads each untriaged posting and writes a verdict. It spends your own plan (or your own API money), so the number of rows it scores a day is yours to set. Every figure on this page is an estimate: vendor limits change, message sizes vary, and neither vendor publishes how many tokens a plan window holds.

## Your triage budget

- **Daily budget**: how many rows the scheduled triage and any triage in a session may score in one local day. The default is 20. Set any whole number or `all` (every untriaged Pending row, in calls of 20 rows). 0 turns it off.
- **First-run budget**: how many rows the interview's first run may score. The default is 60 (the first 20 plus two more batches of 20), counted across every date.

Look at it, price a value, change it and record rows with the `triage-budget` script in the student folder:

```
node student/scripts/triage-budget.mjs status
node student/scripts/triage-budget.mjs cost 150
node student/scripts/triage-budget.mjs set 150
node student/scripts/triage-budget.mjs set 150 --confirm
```

`set` without `--confirm` writes nothing: it prints the estimate for the new value and the exact command to run again. Only the second command writes `triage_budget.daily` to config/student.yml. Add `--first-run` to change the first-run budget instead. You can also say it in a session ("raise my daily triage to 150 rows"); the session runs the same two commands and asks you before the second one. Nothing spends more than the budget you set, and nothing raises it for you.

Rows sent today, by the scheduled run or by a session, count against the daily budget; the pack's status and digest lines call them "rows sent today (counted against the budget)". A chunk whose agent call failed or timed out also counts, because the call was sent, and so does a chunk the agent answered with no verdict lines (a limit or login message); its rows stay untriaged and go out again on a later day. Only one triage runs at a time: a second one started while the first is working sends nothing and says so in the digest. A failed scheduled chunk ends that day's scheduled triage, so a sign-in problem is not repeated on every rerun.

## How the estimate is made

The pack measured real calls on synthetic postings (5,400 characters each, example.com addresses, no personal data) on 2026-10-30, with the current prompt (posting fences and the `ANOMALY:` rule). `scripts/ci/usage-fixture.mjs` rebuilds the exact prompts with the same `buildPrompt` the triage uses, and `--print-argv` prints the flags of each call. Each agent was run at 1, 5 and 20 rows, every point at least twice, from an empty folder as the triage runs it; the per-row figures come from the 5-row and 20-row difference divided by 15, and the fixed figure is the 5-row run minus five rows, rounded to the nearest hundred. Input changed by less than 1% between runs. Claude's output changed by up to about a third (the model writes longer or shorter reasons), so its 5-row and 20-row output figures are the mean of four runs each.

| Agent | Call | Fixed input per call | Input per row | Output per row |
| --- | --- | --- | --- | --- |
| Claude Code 2.1.310, `sonnet` | `claude -p --tools '' --setting-sources project --strict-mcp-config --settings <pack>/templates/triage-claude-settings.json --model sonnet` | 3,500 | 1,726 | 75 |
| codex-cli 0.166.0-alpha, medium effort | `codex exec` with user config ignored and every tool feature disabled | 10,100 | 1,189 | 31 |

Measured totals (input, then output):

| Agent | 1 row | 5 rows | 20 rows |
| --- | --- | --- | --- |
| Claude Code | 5,174 to 5,179; 85 to 91 | 12,130 to 12,136; 376 to 471 (mean 407) | 38,019 to 38,028; 1,261 to 1,701 (mean 1,526) |
| codex | 11,258 to 11,260; 37 to 40 | 16,048 to 16,052; 212 to 225 | 33,888 to 33,890; 670 to 683 |

Compared with the first measurement (Claude Code 3,600 fixed, 1,548 and 104 per row; codex-cli 0.165 11,300 fixed, 1,038 and 31 per row), the fenced prompt adds about 150 to 180 input tokens per row. Codex's fixed part is about 1,200 tokens smaller, with codex-cli 0.166 and the call now also disabling image generation, goals and the image viewer.

A live check on 2026-10-30, before the fenced prompt and with the first constants, ran the daily triage from a career-ops 1.38.0 install on 45 synthetic rows with the budget set to `all` (3 calls of 20, 20 and 5 rows). Claude Code measured 86,056 input tokens against an estimate of 80,460 (+7%) and 2,618 output against 4,680; codex measured 81,698 input against 80,610 (+1%) and 1,549 output against 1,395. The current constants put that run at 88,170 Claude and 83,805 codex input tokens. The Claude figure holds only because the call excludes CLAUDE.md (next section); with career-ops' CLAUDE.md loaded, each call carried about 33,000 more input tokens.

Rows go out in chunks of 20, one call per chunk, so the fixed part is paid once per chunk: tokens = chunks x fixed + rows x per-row. The dollar figure prices every input token at the model's base input rate with no cache discount, so it is an upper bound; real calls that hit a cache cost less. Premium spend tier prices the Claude counts at Opus rates and labels them "tokens measured at the standard tier", because only the standard tier was measured.

Prices per million tokens (input, cache hit, output), taken from the vendors' pricing pages, accessed 2026-10-30:

| Model | Input | Cache hit | Output | Source |
| --- | --- | --- | --- | --- |
| Claude Sonnet 5.5 | $2 | $0.10 | $10 | https://platform.claude.com/docs/en/about-claude/pricing |
| Claude Opus 5.5 | $4 | $0.20 | $20 | https://platform.claude.com/docs/en/about-claude/pricing |
| gpt-6.1-sol | $2 | $0.10 | $10 | https://developers.openai.com/api/docs/pricing |

OpenAI does not state which model `codex exec` uses by default. gpt-6.1-sol is the likely one; run `/status` in Codex to see yours. OpenAI also notes that "API token prices are separate from subscription usage", so they do not size what a plan includes. Treat the dollars as an API-equivalent size, not a bill for a subscription.

## Worked examples

From `estimateUsage` in `lib/usage-cost.mjs`, standard tier, base rates. Each is an estimate.

| Agent | Rows | Calls | Input tokens | Output tokens | API-equivalent |
| --- | --- | --- | --- | --- | --- |
| claude | 20 | 1 | 38,020 | 1,500 | $0.09 |
| claude | 100 | 5 | 190,100 | 7,500 | $0.46 |
| claude | 250 | 13 | 477,000 | 18,750 | $1.14 |
| codex | 20 | 1 | 33,880 | 620 | $0.07 |
| codex | 100 | 5 | 169,400 | 3,100 | $0.37 |
| codex | 250 | 13 | 428,550 | 7,750 | $0.93 |

A field with 150 to 250 live postings is 8 to 13 calls on a first catch-up.

## Your plan

Set `plan` in config/student.yml (the interview asks) to one of the ids below. It only chooses which plan line the pack prints; it limits nothing. Where a vendor publishes no number the pack says "not published" and does not invent one.

| Plan id | 5-hour limit | Weekly limit | What the pack prints |
| --- | --- | --- | --- |
| `claude-pro` | not published | not published | "not published", then "read your share in /usage" |
| `claude-max` | 5x Pro | 5x Pro | "not published" with the multiple, then "read your share in /usage" |
| `claude-ultra` | none once the account is verified | 10x Pro | "not published" with the multiple, then "read your share in /usage" |
| `chatgpt-plus` | 15-160 local messages (GPT-6.1 Sol) | not published | a percent range, labeled "at least" |
| `chatgpt-pro` | no five-hour limit | not published | "not published", then "read your share in /status" |
| `api` | no plan limit | no plan limit | dollars only |
| `unknown` | not published | not published | tokens, dollars and both /usage and /status |

Claude Code shares one usage pool with claude.ai chat. Codex shares one allowance across local and cloud tasks.

Share of one five-hour window on ChatGPT Plus, estimated from OpenAI's 15-160 range of local messages, counting each call as one message (OpenAI calls the range an estimate, not a fixed limit):

| Rows | Calls | ChatGPT Plus share of one 5-hour window | Every other plan |
| --- | --- | --- | --- |
| 20 | 1 | at least 0.6-6.7% | not published |
| 100 | 5 | at least 3.1-33.3% | not published |
| 250 | 13 | at least 8.1-86.7% | not published |

The ChatGPT Plus percent is a lower bound. OpenAI publishes a range of estimated local messages per five-hour window, not tokens per message. The pack counts one 20-row chunk as one message, but a chunk is larger than a typical chat message and may count as more, so the true share is at least the figure shown. The dollar figure is the opposite kind of bound (an upper bound), so read both together.

Sources, accessed 2026-10-30:

- https://support.claude.com/en/articles/8325606-what-is-the-pro-plan
- https://support.claude.com/en/articles/11049741-what-is-the-max-plan
- https://support.claude.com/en/articles/17728952-what-is-the-ultra-plan
- https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan
- https://claude.com/pricing
- https://help.openai.com/en/articles/20001516-managing-usage-with-gpt-6-astra-in-work-and-codex
- https://learn.chatgpt.com/docs/pricing
- https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers
- https://platform.claude.com/docs/en/about-claude/pricing
- https://developers.openai.com/api/docs/pricing

## Read your real share

Run `/usage` in Claude Code, or `/status` in Codex, before and after a triage of a known number of rows, and note the percent each shows. Then record the difference so the pack can print it with its own estimate. For example, if 150 rows moved the weekly reading by 6 points:

```
node student/scripts/triage-budget.mjs calibrate 6 --rows 150 --window weekly
```

That stores `measured_pct_per_100_rows` and `measured_window` in config/student.yml, and later estimate lines add "your own measurement". It stays on your computer.

## The scheduled Claude call ignores your Claude settings

The scheduled `claude -p` call runs in an empty temp folder and passes `--setting-sources project --strict-mcp-config` and `--settings student/templates/triage-claude-settings.json`, which excludes every CLAUDE.md so career-ops' own rules (an 88 KB AGENTS.md) do not ride along on every call. Your user-level hooks, plugins, MCP servers and settings do not load, so the fixed cost per call is about the measured 3,500 tokens for everyone, where a heavily customized setup would otherwise add tens of thousands, and no user hook runs unattended. The price: anything you keep only in user settings does not apply to the scheduled call, such as an `apiKeyHelper`, an `env` entry or a model override. The career-ops project settings do not apply either, because the call does not run in that folder. A normal `claude` sign-in works, since it is not stored in settings. If you use an API key instead, put it in the environment of the scheduled task, and run `claude` once in a terminal to confirm it signs in. A failed call writes a digest note that names these two flags and points here.

## Long budgets and the schedule timeout

The scheduled run starts the triage as its own process with a timeout that grows with the chunks the budget allows: 25 minutes of worst case per chunk plus 10 minutes, never less than 60 minutes, and never more than the `run_lock_hours` limit minus 30 minutes. A budget of `all` on a 250-row catch-up is 13 chunks and a 335-minute timeout. The triage is also told when that timeout ends and does not start a chunk that could not finish before it, so it stops with a "stopped at chunk" line instead of being killed in the middle of a call. Each chunk writes its ledger row and a digest line before the next call starts, so a stop in the middle keeps the counts so far.
