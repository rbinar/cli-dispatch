# Deterministic runner and runner agent

[← README](../README.md)

The five per-backend "babysitter" subagents (`ds-/ag-/cx-/oc-/cp-runner`) that used to watch each delegation in their own LLM sub-context were retired in 4.0.0 — measured across production usage, they cost roughly **9x** their own worker's output in Anthropic tokens (~62 turns per run; see [CHANGELOG.md](../CHANGELOG.md)). Since 5.2.0 there is one **thin** agent instead, `cli-dispatch:runner` (haiku, Bash-only). It is a forwarder, not a babysitter: one Bash call starts `cli-dispatch-run --detach`, one blocking `cli-dispatch-wait --run <id>` waits, and the compact verdict comes back verbatim (~3-4 turns). Everything mechanical stays in shell — including one retry of a failing verify (`--fix-attempts 1`) — and detaching means a run longer than the Bash tool's 10-minute ceiling is no longer killed. This is the default delegation path from an orchestrator:

```text
Agent(subagent_type: "cli-dispatch:runner", prompt: "backend: ds\ncwd: /abs/path\nverify: <cmd>\n---\n<self-contained brief>")
```

For direct use, the same runner is a slash command (zero LLM tokens; you background it yourself):

```text
/cli-dispatch:run <backend> "<task>" --verify '<cmd>'
```

`cli-dispatch-run` launches the worker (`ds` DeepSeek / `ag` Antigravity / `cx` Codex / `oc` OpenCode / `cp` GitHub Copilot), isolates real repo changes in a git worktree, blocks until it finishes (or times out), runs your `--verify` command, and prints a compact verdict — **zero LLM tokens spent on orchestration** (the agent above only forwards). On Codex, `--read-only` still activates the **real OS-level sandbox** (macOS Seatbelt / Linux bwrap+seccomp) — a kernel-enforced hard-block on all file writes, no worktree needed for a genuine no-writes guarantee.

**Escalation path** (judgment-heavy work, no machine-checkable verify command): there is no LLM babysitter to hand this to. You (Claude Code) run the deterministic runner — or a plain `*-agent` CLI directly — but instead of gating on `--verify`, you read the compact verdict and the diff yourself, then follow up with `/cli-dispatch:resume <session-id> "<prompt>"` if the result needs another pass.

Default to delegating: work that adds or changes tests or touches more than one file goes to the runner agent. Only a fix of ~20 lines in one file (zero discovery/ambiguity) stays inline — there the fixed cost of a delegation isn't worth it. For a simple one-shot job with no repo changes, the plain `/cli-dispatch:ds-run` / `ag-run` / `cx-run` / `oc-run` / `cp-run` commands are enough.
