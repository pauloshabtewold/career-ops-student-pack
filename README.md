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

## Credit

Built on [career-ops](https://github.com/career-ops-hq/career-ops) by its authors and contributors (MIT). The pack contains no upstream code; it calls upstream scripts as command-line tools and uses upstream's documented plugin API.

## License

MIT. See [LICENSE](LICENSE).
