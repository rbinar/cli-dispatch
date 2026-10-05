# Session-start policy injection (optional)

[← README](../README.md)

That final `/cli-dispatch:setup` step asks **three preferences** — enable per-session policy injection, whether to include the GitHub-issue reminder, and whether to also write a static CLAUDE.md block — and saves the answers to `~/.config/cli-dispatch/policy.json`. A `SessionStart` hook (fires on `startup`/`resume`/`clear`/`compact`/`fork` — including `compact`, so the policy **survives auto-compaction**: compaction drops the previous copy, the hook injects a fresh one, net one live copy per context) then auto-injects a compact delegation policy into every session's context: route mechanical work through the deterministic runner (via the thin `cli-dispatch:runner` agent), escalate yourself when the verdict still fails or there's no verify command, and a reminder to file cli-dispatch friction points as GitHub issues — all without hand-editing CLAUDE.md.

- **Opt-in, default off** — if `policy.json` is missing or has `enabled:false`, the hook is a silent no-op with zero token cost.
- Complements, doesn't replace, the static CLAUDE.md block (formerly `orchestration-priority`, now `policy:v1`) — enabling both injects the same policy twice per session, so hook-only is recommended. `/cli-dispatch:doctor` reports its status in a **Policy injection** section.
- **Remove it** by deleting `~/.config/cli-dispatch/policy.json` or setting `enabled:false`.
