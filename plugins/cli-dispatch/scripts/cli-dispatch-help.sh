#!/usr/bin/env bash
# One-screen command reference for cli-dispatch.
#
# Runs straight from the plugin cache via commands/help.md's `!` pre-execution
# block — it is NOT installed into ~/.local/bin, so it never goes stale relative
# to the plugin (same arrangement as cli-dispatch-doctor.sh).
#
# Static text only. Keep the box borders aligned when editing.

cat <<'HELP'
┌─ cli-dispatch ───────────────────────────────────────────────────────────────┐
│                                                                              │
│  SETUP & HEALTH                                                              │
│    /cli-dispatch:setup          Install & configure worker backends          │
│    /cli-dispatch:doctor [be]    Health check — PATH, keys, auth, models      │
│                                                                              │
│  DELEGATE                                                                    │
│    /cli-dispatch:run <be> "<task>" --verify '<cmd>'   Deterministic runner   │
│    /cli-dispatch:ask <be> "<prompt>"   One-shot answer, no repo changes      │
│                                                                              │
│  MONITOR                                                                     │
│    /cli-dispatch:sessions [be]  List sessions (all backends, or one)         │
│    /cli-dispatch:watch <id>     Live status; --wait blocks until done        │
│    /cli-dispatch:resume <id> …  Continue a session with a follow-up          │
│    /cli-dispatch:kill <id>      Stop a running worker session                │
│                                                                              │
│  USAGE & HOUSEKEEPING                                                        │
│    /cli-dispatch:balance [be]   Usage / credits (all backends, or one)       │
│    /cli-dispatch:gain           Token totals; --drift for delegation drift   │
│    /cli-dispatch:clean          Remove old sessions; --schedule for daily run│
│    /cli-dispatch:help           This reference                               │
│                                                                              │
│  [be] = ds|ag|cx|oc|cp (or deepseek|antigravity|codex|opencode|copilot)      │
└──────────────────────────────────────────────────────────────────────────────┘

[CD] in your statusline = cli-dispatch active; ▶N = N workers running right now.
HELP
