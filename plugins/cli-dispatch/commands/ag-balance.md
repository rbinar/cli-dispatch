---
description: Show Antigravity (agy / Gemini) usage / quota (% left per model)
allowed-tools: Bash
---

!`bash "${CLAUDE_PLUGIN_ROOT}/scripts/cli-dispatch-balance.sh" --backend antigravity`

The Antigravity usage report above already ran — do NOT run it again. Summarize
the per-model `% left` plus reset time; lower means more used.

This reads Antigravity's local status endpoint, so the IDE or an `agy` session
must already be running. `remainingFraction` is the live quota share remaining
and `userTier.name` is the plan, such as Google AI Pro. This is
Antigravity-specific; do not map it onto Codex or DeepSeek. Never print a key
VALUE.
