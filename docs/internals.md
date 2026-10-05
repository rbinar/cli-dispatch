# Under the hood (advanced)

[← README](../README.md)

The plugin installs portable CLIs that Claude Code **invokes via Bash** into `~/.local/bin` — normally **you don't call these**, Claude Code manages them:

| CLI | What |
|-----|------|
| `claude-ds` | Plain env wrapper (points `claude` at DeepSeek; no parse/session) |
| `claude-ds-stream` | Session-tracked variant (stream-json parse + status/progress/transcript) |
| `ds-agent` | One-shot synchronous wrapper: task → run → answer (stdout); progress on stderr |
| `ag-stream` | Session-tracked Antigravity wrapper (tails agy's on-disk JSONL transcript) |
| `ag-agent` | One-shot synchronous wrapper for agy: task → run → answer (stdout) |
| `cx-stream` | Session-tracked Codex wrapper (pipes codex's JSONL stdout through the parser) |
| `cx-agent` | One-shot synchronous wrapper for codex: task → run → answer (stdout) |
| `oc-stream` | Session-tracked OpenCode wrapper (pipes opencode's JSON stream through the parser) |
| `oc-agent` | One-shot synchronous wrapper for opencode: task → run → answer (stdout) |
| `cp-stream` | Session-tracked GitHub Copilot wrapper (pipes copilot's JSON stream through the parser) |
| `cp-agent` | One-shot synchronous wrapper for copilot: task → run → answer (stdout) |

If you want, you can also use them directly from the terminal (e.g. in scripts outside the plugin):

```bash
ds-agent --read-only "question"           # one shot; answer to stdout
ds-agent --cwd /tmp/x "generate a file"   # agentic, isolated dir
claude-ds-stream --resume <id> -p "…"     # continue an existing session

cx-agent --read-only -q "question"        # read-only: kernel-enforced sandbox (macOS Seatbelt / Linux bwrap)
cx-agent --cwd /tmp/x "generate a file"   # agentic, isolated dir
cx-agent --resume <thread-id> "follow-up"                # resume reuses stored context; --cwd not supported on resume

cp-agent -q "question"                    # one shot; answer to stdout
cp-agent --cwd /tmp/x "generate a file"   # agentic, isolated dir
cp-agent --effort high --model gpt-5.4 "task"
cp-agent --resume <session-id> "follow-up"
```

Flags (cx-agent / cx-stream): `--read-only`, `--sandbox <mode>`, `--cwd <dir>`, `--resume <id>`, `--model <m>`, `--max-runtime`/`--idle-timeout`, `-q`.
Flags (cp-agent / cp-stream): `--cwd <dir>`, `--resume <id>`, `--model <m>`, `--effort low|medium|high`, `--max-runtime`/`--idle-timeout`, `-q`.

> 📄 Full reference for terminal install, all commands, flags, and env overrides: [TERMINAL.md](../TERMINAL.md).
