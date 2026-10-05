# Statusline badge

[← README](../README.md)

`scripts/cli-dispatch-statusline.sh` is a statusline **fragment**: a combining
`~/.claude/hooks/statusline.sh` wrapper pipes the statusline's stdin JSON to it and appends
its output. From Claude Code's snake_case `session_id`, it counts only fresh, running workers
spawned by **this Claude Code session** and groups them by backend in a yellow suffix, such as
`[CD](ds:1,ag:2,cx:1)`. The fixed group order is `ds`, `ag`, `cx`, `oc`, `cp`; empty groups are
omitted. The cyan `[CD]` badge appears when policy injection is enabled or this session has a
live worker, and nothing is printed when inactive. Legacy workers without `parentSessionId` are
excluded. Callers without a non-empty `session_id` retain the legacy global yellow `▶N` counter.

Wire it up with one line in your combining wrapper, globbing the fragment out of the plugin
cache (hash/version-named, so glob — don't hardcode a path):

```bash
CD_SCRIPT=$(ls "$CONFIG_DIR"/plugins/cache/cli-dispatch/cli-dispatch/*/scripts/cli-dispatch-statusline.sh 2>/dev/null | head -1)
```

It only reads tiny `status.json` and `meta.json` files (never `transcript.jsonl`), so it stays
cheap even though statuslines re-run on every prompt. Unix (bash) statusline setups only.
