# cli-dispatch

> 🌐 **Languages:** **English** · [Türkçe](README.tr.md)

**Use DeepSeek, Gemini, OpenAI Codex, OpenCode (via OpenRouter), or GitHub Copilot as delegated workers inside Claude Code.** Claude Code's built-in subagent tool only supports Anthropic models — cli-dispatch adds portable wrappers so you can hand tasks to any of the five from inside your existing `claude` session. Delegation goes through a deterministic runner (plain shell, zero LLM tokens) and a thin haiku `cli-dispatch:runner` agent, so the work is done by the worker and Claude Code only reviews it.

> 📝 **Write-up (Turkish):** [cli-dispatch: a plugin that makes Claude the boss and DeepSeek the worker](https://medium.com/@rbinar/cli-dispatch-claudea-patron-deepseek-e-i%CC%87%C5%9F%C3%A7i-rol%C3%BC-veren-bir-plugin-b232803581fc) — Medium

![cli-dispatch demo — start Claude Code in your project, then: install, /cli-dispatch:setup, delegate via the deterministic /cli-dispatch:run runner, check usage](assets/demo.gif)

## Install

> ⚠️ These are **slash commands**: run them **inside the Claude Code CLI** (type `claude` first), one at a time, in order. Details, prerequisites and troubleshooting: [Install](docs/install.md).

```text
/plugin marketplace add rbinar/cli-dispatch
/plugin install cli-dispatch@cli-dispatch
/reload-plugins
/cli-dispatch:setup
```

| Backend | CLI (install) | Auth | Model select |
|---|---|---|---|
| **DeepSeek** | `claude` (you already have it) | `DEEPSEEK_API_KEY` in config ([get one](https://platform.deepseek.com/api_keys)) | `DS_MODEL` / `DS_FLASH_MODEL` |
| **Antigravity (Gemini)** | `agy` — `curl -fsSL https://antigravity.google/cli/install.sh \| bash` (+ `script`, `node`) | Google sign-in (run `agy` once) or `GEMINI_API_KEY` | `--model "<name>"` / `AG_MODEL` — list: `agy models` |
| **Codex (OpenAI)** | `codex` ≥ 0.142.3 — `npm i -g @openai/codex`, `brew install --cask codex`, or `curl -fsSL https://chatgpt.com/codex/install.sh \| sh` (+ `node`) | `codex login` (ChatGPT/OAuth) or `CODEX_API_KEY`/`OPENAI_API_KEY` | `--model <name>` / `CX_MODEL` — list: `/model` inside codex |
| **OpenCode (OpenRouter)** | `opencode` — `npm i -g opencode-ai` (+ `node`) | `OPENROUTER_API_KEY` ([get one](https://openrouter.ai/keys)), pasted by you | `--model <bare-slug>` / `OC_MODEL` — list: `opencode models openrouter` |
| **GitHub Copilot** | `copilot` — `npm i -g @github/copilot`, `brew install --cask copilot-cli`, or `curl -fsSL https://gh.io/copilot-install \| bash` (+ `node` 22+) | `COPILOT_GITHUB_TOKEN` > `GH_TOKEN` > `GITHUB_TOKEN` (reuses `gh auth token`), or `copilot login --device-code`; active Copilot subscription required | `--model <slug>` / `CP_MODEL`; `--effort low\|medium\|high` |

Native Windows: DeepSeek and Codex only — install the other three under WSL (see [Windows](docs/windows.md)). Sandbox: only Codex's `--read-only` is a kernel-enforced OS sandbox — the rest need worktree isolation (see [Security and data](docs/security.md)).

## Setup

`/cli-dispatch:setup` asks which backend(s) to install (DeepSeek, Antigravity, Codex, OpenCode, Copilot, or all) and can auto-install a missing CLI with `--install-missing` — only after your approval, and it never automates auth. For DeepSeek and OpenCode it opens a one-shot local web form in your browser where you type keys and model names; they are written straight to `~/.config/cli-dispatch/config` and never pass through Claude. The last step optionally writes a delegation preference and enables [session-start policy injection](docs/policy-injection.md). Full walkthrough: [Install](docs/install.md).

## Delegating

From an orchestrator the default path is the thin runner agent: it starts the deterministic runner detached, blocks until it finishes, retries a failing verify once, and returns a compact verdict.

```text
Agent(subagent_type: "cli-dispatch:runner", prompt: "backend: ds\ncwd: /abs/path\nverify: <cmd>\n---\n<self-contained brief>")
```

Directly (zero LLM tokens; you background it yourself):

```text
/cli-dispatch:run <backend> "<task>" --verify '<cmd>'
```

You get back a compact verdict; real repo changes stay in an isolated git worktree, uncommitted, and you apply the patch after reviewing it. Use `/cli-dispatch:ask <backend> "<prompt>"` for simple one-shot questions with no repo changes. More: [Deterministic runner](docs/runner.md), [Commands](docs/commands.md).

> ⚠️ **The default mode is not a sandbox.** Workers can write files and run bash — isolate real repo work in a worktree ([Security and data](docs/security.md)).

## Updating

```text
/plugin update cli-dispatch
/reload-plugins
```

`/plugin update` refreshes commands and skills only; after an update that changes a wrapper, re-run `/cli-dispatch:setup` once to reinstall the wrappers in `~/.local/bin`. Verify with `/cli-dispatch:doctor`. See [Install](docs/install.md#updating).

## Documentation

- [Install](docs/install.md) — prerequisites, step-by-step install, setup and config, updating
- [Commands](docs/commands.md) — every slash command
- [Deterministic runner](docs/runner.md) — runner agent, `/cli-dispatch:run`, escalation path
- [Session tracking](docs/sessions.md) — live watch, resume, the session directory
- [Session-start policy injection](docs/policy-injection.md) — optional delegation policy hook
- [Statusline badge](docs/statusline.md) — the `[CD]` statusline fragment
- [Usage & quota](docs/quota.md) — native balance and rate-limit checks per backend
- [Features and architecture](docs/features.md) — feature overview and the architectural role
- [Under the hood](docs/internals.md) — installed CLIs and direct terminal use
- [Windows](docs/windows.md) — native PowerShell support
- [Security and data](docs/security.md) — sandbox posture, keys, data egress, pruning
- [Uninstall](docs/uninstall.md) — full cleanup
- [Terminal reference](TERMINAL.md) and [CHANGELOG](CHANGELOG.md)

## License

MIT — see [LICENSE](LICENSE).
