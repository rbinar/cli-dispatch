# Install

[← README](../README.md)

> ⚠️ These commands are **slash commands** and must be run **from inside the Claude Code CLI** (not in a normal terminal/shell). First type `claude` to start a Claude Code session, then enter the commands at that session's prompt.

**Before you start — you need:**
- `claude` CLI installed and on your `PATH`, version **2.1.287 or newer** (Claude Code 2.1.287 is the first with mods; the plugin needs it)
- `~/.local/bin` on your `PATH` — check: `echo $PATH | grep -q local && echo ok || echo 'add: export PATH="$HOME/.local/bin:$PATH" to ~/.zshrc'`
- API key/auth for your backend — see the table below

Run the commands **one at a time, in order** — don't paste them all at once. Send each command, wait for the result, then move to the next:

**Step 1 — Add the marketplace:**

```text
/plugin marketplace add rbinar/cli-dispatch
```

> If an "Enter marketplace source" box opens, type **only the source** into it (not the command): `rbinar/cli-dispatch`

**Step 2 — Install the plugin** (after the marketplace is added):

```text
/plugin install cli-dispatch@cli-dispatch
```

> The format is `plugin-name@marketplace-name`; since both are `cli-dispatch` the name repeats, which is normal.

**Step 3 — Enable the plugin:**

The install output says `Run /reload-plugins to apply`. This step is required for the commands (`/cli-dispatch:*`) to be recognized:

```text
/reload-plugins
```

> If you still get "Unknown command: /cli-dispatch:setup" after reload, fully quit Claude Code and reopen it. You can verify `cli-dispatch` is installed and **enabled** with the `/plugin` command.

**Step 4 — Run setup** (after the plugin is enabled):

```text
/cli-dispatch:setup
```

`/cli-dispatch:setup` first **asks which worker backend(s) to install** — DeepSeek, Antigravity (Gemini), Codex, OpenCode, Copilot, Ollama, or all (`--backends all` or `--backends deepseek,antigravity,codex,opencode,copilot,ollama`). If a selected backend's underlying CLI turns out to be missing, `install.sh` can attempt to auto-install it — pass `--install-missing` (opt-in, default off; npm preferred where available, `curl | bash` vendor installers as fallback). Setup only adds this flag after your explicit approval and shows exactly which CLIs are missing and which commands will run; it never automates auth (sign-in, API keys). See [CHANGELOG.md](../CHANGELOG.md) for details.

| Backend | CLI (install) | Auth | Model select |
|---|---|---|---|
| **DeepSeek** | `claude` (you already have it) | `DEEPSEEK_API_KEY` in config ([get one](https://platform.deepseek.com/api_keys)) | `DS_MODEL` / `DS_FLASH_MODEL` |
| **Antigravity (Gemini)** | `agy` — `curl -fsSL https://antigravity.google/cli/install.sh \| bash` (+ `script`, `node`) | Google sign-in (run `agy` once) or `GEMINI_API_KEY` | `--model "<name>"` / `AG_MODEL` — list: `agy models` |
| **Codex (OpenAI)** | `codex` ≥ 0.142.3 — `npm i -g @openai/codex`, `brew install --cask codex`, or `curl -fsSL https://chatgpt.com/codex/install.sh \| sh` (+ `node`) | `codex login` (ChatGPT/OAuth) or `CODEX_API_KEY`/`OPENAI_API_KEY` | `--model <name>` / `CX_MODEL` — list: `/model` inside codex |
| **OpenCode (OpenRouter)** | `opencode` — `npm i -g opencode-ai` (+ `node`) | `OPENROUTER_API_KEY` ([get one](https://openrouter.ai/keys)), pasted by you | `--model <bare-slug>` / `OC_MODEL` — list: `opencode models openrouter` |
| **Ollama (local)** | `claude` (you already have it) + a running Ollama ([ollama.com](https://ollama.com)), local by default | none — no key | `OL_MODEL` (**required**, a model already pulled: `ollama pull <name>`); `OLLAMA_BASE_URL` (default `http://127.0.0.1:11434`) |
| **GitHub Copilot** | `copilot` — `npm i -g @github/copilot`, `brew install --cask copilot-cli`, or `curl -fsSL https://gh.io/copilot-install \| bash` (+ `node` 22+) | `COPILOT_GITHUB_TOKEN` > `GH_TOKEN` > `GITHUB_TOKEN` (reuses `gh auth token`); active Copilot subscription required | `--model <slug>` / `CP_MODEL`; `--effort low\|medium\|high` |

Native Windows: DeepSeek and Codex only — install the other four (Antigravity, OpenCode, Copilot, Ollama) under WSL (see [Windows](windows.md#windows)). Sandbox: only Codex's `--read-only` is a kernel-enforced OS sandbox — the rest need worktree isolation (see [Security and data](security.md#security-and-data)).

**Keys and models (Claude Code 2.1.287+).** Enter API keys with `/plugin configure cli-dispatch@cli-dispatch`: the key is kept in Claude Code's secure store, not in a file, and never passes through Claude. The dialog masks a key but shows its **last 6 characters in clear**, so do not fill it in during a screen share or recording. Edit model names and install backends with `/cli-dispatch-config`. A key entered there reaches the `dispatch` tool only; `/cli-dispatch:run`, the runner agent and the `*-agent` scripts still read the config file, so add the key there too (or use the form below) if you use them.

Where the mod is not loaded, the fallback is that setup opens a **one-shot local web form** in your browser (loopback-only, per-run token) where you type keys and model names; they are written straight into the config file and never pass through Claude. The result is this file:

```bash
# ~/.config/cli-dispatch/config
DEEPSEEK_API_KEY="sk-..."     # your own DeepSeek key
DS_MODEL="deepseek-v4-pro"
DS_FLASH_MODEL="deepseek-flash"
# Ollama (no key) — OL_MODEL is required: a model already pulled on that Ollama
OLLAMA_BASE_URL="http://127.0.0.1:11434"
OL_MODEL="qwen3.8:27b"
```

**Ollama and its context window.** Ollama answers a prompt longer than its running context with
HTTP 200 and no error: it truncates the prompt **silently**, so the worker may lose the brief or
earlier tool results. Set `OLLAMA_CONTEXT_LENGTH` on the Ollama server (its default depends on
VRAM: 4k/32k/256k); Claude Code's own start prompt is about 29k tokens, so the first turn of a run
takes about 40 s locally and a 4k server cannot run it at all. cli-dispatch tells the worker the
server's real window (`CLAUDE_CODE_MAX_CONTEXT_TOKENS`) from `OL_CONTEXT` if you set it, else from
`/api/ps` when the model is loaded, else it assumes 32768 and says so — set `OL_CONTEXT` to the
server's `OLLAMA_CONTEXT_LENGTH` for runs that start while the model is not loaded. Claude Code
compacts well before that window (measured: at about 40k of a 64k window), so a task that reads
several large files can stop with "Autocompact is thrashing"; give the server a larger window for
such tasks. A model that is
not pulled, an unreachable server or an empty `OL_MODEL` fails before anything starts (the runner
exits 5 with no worktree); cli-dispatch never pulls a model. Ollama is Unix-only for now.

> Prefer a text editor over the form? Set `CLI_DISPATCH_EDITOR` (e.g. `CLI_DISPATCH_EDITOR="code"`; the legacy `CLAUDE_DS_EDITOR` is still honored). To edit the file by hand: `${EDITOR:-nano} ~/.config/cli-dispatch/config`.

OpenCode's setup step additionally asks (multiple-choice) for a default model from 2-3 curated free-tier OpenRouter slugs (e.g. `google/gemma-4-31b-it:free`) or a custom slug, writing it to `OC_MODEL`. Copilot's model list is only visible interactively (`/model` in the copilot TUI, or GitHub Copilot docs) — slugs change over time.

`/cli-dispatch:setup` has a final step that offers, via a yes/no question, to write a standing delegation-preference reminder — pointing at the deterministic runner (the thin `cli-dispatch:runner` agent, or `/cli-dispatch:run` directly) — into your global or project `CLAUDE.md`, so you don't have to re-explain your delegation preference every session (idempotent/marker-guarded, so re-running setup won't duplicate it).

## Updating

Update the plugin from inside Claude Code, then reload (run one at a time):

```text
/plugin update cli-dispatch
/reload-plugins
```

`/plugin update` fetches the newest version from the marketplace; `/reload-plugins` applies it
to the running session (without a full restart). Verify with `/cli-dispatch:doctor`.

> ℹ️ `/plugin update` refreshes the **commands/skills** only — it does **not** reinstall the
> worker wrappers in `~/.local/bin`. After an update that changes a wrapper, re-run
> **`/cli-dispatch:setup`** once to reinstall them.

<video src="https://github.com/rbinar/cli-dispatch/raw/main/assets/update.mp4" controls width="820"></video>

> ▶️ [Watch the update demo (mp4)](../assets/update.mp4) — `/plugin update` then `/reload-plugins` inside Claude Code.
