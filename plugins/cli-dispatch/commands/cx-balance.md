---
description: Show Codex (OpenAI) usage / rate limits (5h + weekly, % left)
allowed-tools: Bash
---

!`bash "${CLAUDE_PLUGIN_ROOT}/scripts/cli-dispatch-balance.sh" --backend codex`

The Codex usage report above already ran — do NOT run it again. Summarize the
`5h` and `7d` windows as `% left` plus reset time.

The CLI persists rate-limit payloads in on-disk session records; these are the
same numbers as `/status` inside the codex TUI. The snapshot is only as fresh as
the last interactive codex turn, because exec/`-q` runs report
`rate_limits:null`. There is no native scriptable DeepSeek equivalent here.
Never print a key VALUE.
