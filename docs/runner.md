# Deterministic runner and runner agent

[← README](../README.md)

The five per-backend "babysitter" subagents (`ds-/ag-/cx-/oc-/cp-runner`) that used to watch each delegation in their own LLM sub-context were retired in 4.0.0 — measured across production usage, they cost roughly **9x** their own worker's output in Anthropic tokens (~62 turns per run; see [CHANGELOG.md](../CHANGELOG.md)). Since 5.2.0 there is one **thin** agent instead, `cli-dispatch:runner` (haiku, Bash-only). It is a forwarder, not a babysitter: one Bash call starts `cli-dispatch-run --detach`, one blocking `cli-dispatch-wait --run <id>` waits, and the compact verdict comes back verbatim (~3-4 turns). Everything mechanical stays in shell — including one retry of a failing verify (`--fix-attempts 1`) — and detaching means a run longer than the Bash tool's 10-minute ceiling is no longer killed. This is the delegation path from an orchestrator on Claude Code older than 2.1.287; on 2.1.287+ the `mcp__cli-dispatch__dispatch` tool below is preferred:

```text
Agent(subagent_type: "cli-dispatch:runner", prompt: "backend: ds\ncwd: /abs/path\nverify: <cmd>\n---\n<self-contained brief>")
```

Since 6.3.0, on Claude Code 2.1.287+ the plugin's mod also provides a model-callable tool, `mcp__cli-dispatch__dispatch` — the preferred path when it is available. It runs `cli-dispatch-run --detach … --fix-attempts 1` itself (no subagent, no LLM turns of its own), blocks on `cli-dispatch-wait --run <id>` (waits of up to 570 s, up to 6 of them) and returns the runner's compact summary verbatim (session id, verify result, diff, STRANDED worktree, patch path). Inputs: `backend` (`ds|ag|cx|oc|cp`, required), `cwd` (absolute repo path, required), `task` (the full brief, required), `verify` (array of shell commands, optional), `model` (optional), `scope` (array of repo-relative globs, optional — see below). Measured: a real `ds` run took 29 s end to end with 2 orchestrator turns, and a single 780 s tool call was not cut off. The session-start policy tells the orchestrator to call the tool if it is available, otherwise `Agent(subagent_type: "cli-dispatch:runner")`. The tool does not read the verdict or diff for you — you still re-measure the result yourself.

```text
mcp__cli-dispatch__dispatch({"backend": "ds", "cwd": "/abs/path", "task": "<self-contained brief>", "verify": ["<cmd>"]})
```

`scope` (the runner's `--scope <glob>`, repeatable) limits which files the worker may change. After the run, every file the worker changed (measured from git, not from its report) must match one glob; otherwise the run fails with exit 2 even when verify passes, the verdict lists the files under `scopeViolations`, and the summary prints a `SCOPE:` line. `**` crosses directories, `*` and `?` stay inside one, and a glob with no wildcard covers that path and everything under it (`src/auth` = the directory). Without `scope` nothing is checked.

For direct use, the same runner is a slash command (zero LLM tokens; you background it yourself):

```text
/cli-dispatch:run <backend> "<task>" --verify '<cmd>'
```

`cli-dispatch-run` launches the worker (`ds` DeepSeek / `ag` Antigravity / `cx` Codex / `oc` OpenCode / `cp` GitHub Copilot / `ol` Ollama), isolates real repo changes in a git worktree, blocks until it finishes (or times out), runs your `--verify` command, and prints a compact verdict — **zero LLM tokens spent on orchestration** (the agent above only forwards). On Codex, `--read-only` still activates the **real OS-level sandbox** (macOS Seatbelt / Linux bwrap+seccomp) — a kernel-enforced hard-block on all file writes, no worktree needed for a genuine no-writes guarantee.

**Escalation path** (judgment-heavy work, no machine-checkable verify command): there is no LLM babysitter to hand this to. You (Claude Code) run the deterministic runner — or a plain `*-agent` CLI directly — but instead of gating on `--verify`, you read the compact verdict and the diff yourself, then follow up with `/cli-dispatch:resume <session-id> "<prompt>"` if the result needs another pass.

Default to delegating: work that adds or changes tests or touches more than one file goes to the dispatch tool (or the runner agent on older Claude Code). Only a fix of ~20 lines in one file (zero discovery/ambiguity) stays inline — there the fixed cost of a delegation isn't worth it. For a simple one-shot job with no repo changes, `/cli-dispatch:ask <backend> "<prompt>"` is enough.

**Worker questions (7.3.0).** A run started by the `dispatch` tool sets `CLI_DISPATCH_ASK=1`; `cli-dispatch-run` then makes a private ask dir (`<sessions-root>/.ask/run-XXXXXX/`), adds a short block to the brief and wires the `ask_user` / `check_messages` MCP server into the worker. The dir is removed when the run ends. A question nobody answered shows in `verdict.json` as `questions: {asked, unanswered}` and in the summary as one `questions:` line; answer it with `/cli-dispatch:resume`. `exitCode` is unchanged. Other callers (`/cli-dispatch:run`, the runner agent) get none of this.