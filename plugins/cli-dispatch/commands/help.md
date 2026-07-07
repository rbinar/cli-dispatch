---
description: One-screen command reference for cli-dispatch
allowed-tools: Bash
---

# cli-dispatch help

```bash
cat <<'HELP'
┌─ cli-dispatch ──────────────────────────────────────────────────────────────┐
│                                                                               │
│  SETUP & HEALTH                                                               │
│    /cli-dispatch:setup          Install & configure worker backends           │
│    /cli-dispatch:status         Installation status (all backends)            │
│    /cli-dispatch:doctor         Health check — PATH, keys, auth  ✓/✗         │
│                                                                               │
│  DELEGATE                                                                     │
│    /cli-dispatch:ds-run <task>  Delegate to DeepSeek (claude-ds)             │
│    /cli-dispatch:ag-run <task>  Delegate to Antigravity / Gemini             │
│    /cli-dispatch:cx-run <task>  Delegate to OpenAI Codex                     │
│    /cli-dispatch:oc-run <task>  Delegate to OpenCode (OpenRouter)            │
│    /cli-dispatch:cp-run <task>  Delegate to GitHub Copilot                   │
│    Subagents: ds/ag/cx/oc/cp-runner  (babysitter + reviewer)                 │
│                                                                               │
│  MONITOR                                                                      │
│    /cli-dispatch:sessions       List all sessions (all backends)             │
│    /cli-dispatch:watch <id>     Live status of one session                   │
│    /cli-dispatch:resume <id> …  Continue a session with a follow-up          │
│    /cli-dispatch:kill <id>      Stop a running worker session                │
│    /cli-dispatch:dashboard      Open local web dashboard (port 7878)         │
│                                                                               │
│  USAGE & HOUSEKEEPING                                                         │
│    /cli-dispatch:balance        Usage / credits (all backends)               │
│    /cli-dispatch:gain           Token totals by backend                      │
│    /cli-dispatch:ds-balance     DeepSeek balance                             │
│    /cli-dispatch:ag-balance     Antigravity / Gemini quota                   │
│    /cli-dispatch:cx-balance     Codex / OpenAI rate limits                   │
│    /cli-dispatch:oc-balance     OpenCode / OpenRouter credits                │
│    /cli-dispatch:cp-balance     Copilot usage note (not CLI-queryable)       │
│    /cli-dispatch:clean          Remove old session dirs                      │
│    /cli-dispatch:clean-schedule Schedule periodic cleanup                    │
│                                                                               │
└───────────────────────────────────────────────────────────────────────────────┘
HELP
```
