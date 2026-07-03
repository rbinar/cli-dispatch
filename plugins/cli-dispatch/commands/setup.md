---
description: Install and configure cli-dispatch worker backends (DeepSeek / Antigravity / Codex / OpenCode)
allowed-tools: Bash, AskUserQuestion
---

# cli-dispatch setup

cli-dispatch is a multi-backend delegation hub. Four worker backends are available:

| Backend | Worker CLI it wraps | Auth | Installs |
|---|---|---|---|
| **DeepSeek** | `claude` (Claude Code) pointed at DeepSeek's API | DeepSeek API key | `claude-ds`, `claude-ds-stream`, `ds-agent` |
| **Antigravity** | `agy` (Antigravity CLI, Gemini) under a pseudo-TTY | Google sign-in (`agy`) or `GEMINI_API_KEY` | `ag-stream`, `ag-agent` |
| **Codex** | `codex` (OpenAI Codex CLI) | `codex login` (ChatGPT/OAuth) or `CODEX_API_KEY` | `cx-stream`, `cx-agent` |
| **OpenCode** | `opencode` (OpenCode CLI, via OpenRouter) | OpenRouter API key (paste yourself, no OAuth) | `oc-stream`, `oc-agent` |

Follow these steps:

1. **Detect which worker CLIs are available** so you can recommend a sensible default:
   ```bash
   command -v claude >/dev/null 2>&1 && echo "claude: found" || echo "claude: MISSING"
   command -v agy    >/dev/null 2>&1 && echo "agy: found ($(agy --version 2>/dev/null))" || echo "agy: MISSING"
   command -v codex  >/dev/null 2>&1 && echo "codex: found ($(codex --version 2>/dev/null))" || echo "codex: MISSING"
   command -v opencode >/dev/null 2>&1 && echo "opencode: found ($(opencode --version 2>/dev/null))" || echo "opencode: MISSING"
   ```

2. **Ask the user which backend(s) to install** with `AskUserQuestion` (header: "Backends",
   multiSelect). Offer: **DeepSeek**, **Antigravity (Gemini)**, **Codex (OpenAI)**,
   **OpenCode (OpenRouter)**. In the option descriptions, note which underlying CLI each
   needs and whether it was found in step 1 (e.g. if `codex` is MISSING, say it can be
   installed after). For OpenCode, note it needs an OpenRouter API key (paste-yourself, no
   OAuth) and that if `opencode` was MISSING in step 1, it can be installed after. Map the
   (possibly multiple) answers to a comma-list: DeepSeek→`deepseek`, Antigravity→`antigravity`,
   Codex→`codex`, OpenCode→`opencode` (e.g. all four → `deepseek,antigravity,codex,opencode`,
   also accepted as `all`).

3. **Cross-reference step 2's picks against step 1's detection, and offer to auto-install any missing CLI(s):**
   - Map each backend chosen in step 2 to the underlying CLI step 1 checked: DeepSeek→`claude`,
     Antigravity→`agy`, Codex→`codex`, OpenCode→`opencode`. Determine which of the *chosen*
     backends' CLIs came back `MISSING` in step 1.
   - **If none are missing, skip this step entirely** and run the installer in step 4 exactly
     as today, with no new flag.
   - **If one or more are missing**, ask a **separate** `AskUserQuestion` (header: "Auto-install?")
     that explicitly names each missing CLI and the exact command(s) that would run for it:
     - `claude` → `npm i -g @anthropic-ai/claude-code` (fallback: `curl -fsSL https://claude.ai/install.sh | bash`)
     - `agy` → `curl -fsSL https://antigravity.google/cli/install.sh | bash`
     - `codex` → `npm i -g @openai/codex` (fallbacks: `brew install --cask codex`, or `curl -fsSL https://chatgpt.com/codex/install.sh | sh`)
     - `opencode` → `npm i -g opencode-ai`
     In the question text, state plainly that the `agy` installer and the `curl`-based
     fallbacks for `claude`/`codex` **download and execute a script from the vendor's domain**
     (`antigravity.google`, `claude.ai`, `chatgpt.com`) — the user should know this before
     approving. Offer:
     - **"Yes, auto-install"** — the installer will be invoked with `--install-missing`
       (bash) / `-InstallMissing` (PowerShell) in step 4, so it attempts each missing CLI via
       package manager or vendor script, falling back to the existing MISSING warning if that
       fails.
     - **"No, I'll install manually"** — proceed exactly as today, no new flag; the user
       installs the missing CLI(s) themselves whenever they like.
     Leave neither option marked `recommended: true` — running a vendor's install script is a
     deliberate, per-user tradeoff, not something to nudge them toward.
   - This approval is **per-run only**: always ask again in a fresh setup run, even if the
     user approved auto-install previously — never treat a prior session's answer as standing
     consent.

4. **Run the installer** with the chosen backends — depending on the OS:
   - **macOS / Linux / WSL / Git Bash**:
     ```bash
     bash "${CLAUDE_PLUGIN_ROOT}/scripts/install.sh" --backends <comma-list|all>
     ```
     The comma-list may include `deepseek`, `antigravity`, `codex`, `opencode` (or `all`).
     Note: OpenCode is Unix-only for now (macOS/Linux/WSL) — no native Windows support v1.
     **If the user approved auto-install in step 3**, append `--install-missing`:
     ```bash
     bash "${CLAUDE_PLUGIN_ROOT}/scripts/install.sh" --backends <comma-list|all> --install-missing
     ```
   - **Native Windows (PowerShell)** — supports **DeepSeek and Codex** (both run natively).
     The Antigravity backend needs a pseudo-TTY (`script`) not present on native Windows, so
     install it under WSL instead. OpenCode is likewise Unix-only for now — install it under
     WSL instead of natively. Pass `-Backends` (default `deepseek`; `all` = both):
     ```powershell
     powershell -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PLUGIN_ROOT}/scripts/install.ps1" -Backends <deepseek,codex|all>
     ```
     **If the user approved auto-install in step 3**, append `-InstallMissing`:
     ```powershell
     powershell -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PLUGIN_ROOT}/scripts/install.ps1" -Backends <deepseek,codex|all> -InstallMissing
     ```
   - **If the user did not approve auto-install in step 3 (or no chosen backend's CLI was
     missing), invoke the installer exactly as shown above with no new flag** — this remains
     the default, unchanged path.

   Wrappers go to `~/.local/bin`; parsers to `~/.local/share/cli-dispatch/`. A shared config
   skeleton is created at `~/.config/cli-dispatch/config` if missing (existing configs are
   never clobbered). Legacy `~/.config/claude-ds` config + `~/.cache/claude-ds` sessions are
   auto-migrated to the `cli-dispatch` paths on install (with a runtime fallback either way).

   > Note: both stream variants require `node` for their parser (claude-code already runs in a node environment).

5. **Configure auth for each chosen backend:**
   > Even if a CLI was auto-installed in step 4, **auth is always manual** — auto-install only
   > places the binary on `PATH`; it never signs the user in or writes a key. The steps below
   > (DeepSeek key paste, OpenCode key + model pick, Antigravity `agy` sign-in, `codex login`)
   > are unaffected by whether the CLI arrived via auto-install or was already present.
   - **DeepSeek** — the user must add their API key themselves. While the key is still empty,
     the installer **auto-opens** the config in the default editor. If it doesn't open, ask
     the user to add their DeepSeek API key to the `DEEPSEEK_API_KEY=""` line in
     `~/.config/cli-dispatch/config`.
     **You (Claude) must NEVER write/paste the API key** — only the user enters it.
   - **OpenCode** — grouped with DeepSeek's (both are paste-a-raw-key, no OAuth backends).
     The installer creates `OPENROUTER_API_KEY=""` and `OC_MODEL=""` placeholders in the
     config. **Ordering matters here**: immediately after the installer runs, and
     independently of / regardless of whether the auto-opened editor (below) has already
     popped up, ask the user (via `AskUserQuestion`) to pick a default OpenCode model —
     offer 2-3 curated free-tier OpenRouter slugs (e.g. `google/gemma-4-31b-it:free`; note
     the free catalog rotates, so re-verify live with `opencode models openrouter` if a test
     key is available) plus a "type your own" custom/freeform option — then write the chosen
     slug into the `OC_MODEL=""` line in `~/.config/cli-dispatch/config` yourself (this is
     NOT a secret, so Claude writing it is fine). Do this before/regardless of the key paste
     to avoid a save-race between your programmatic `OC_MODEL` write and the user's manual
     paste in the auto-opened editor — the two are independent file edits that just must not
     race each other. While the key is still empty, the installer **auto-opens** the config
     in the default editor (same mechanism as DeepSeek) for the user to paste
     `OPENROUTER_API_KEY` themselves. **You (Claude) must NEVER write/paste the API key** —
     only the user enters it.
   - **Antigravity** — normally needs no key: the user signs in once by running `agy`
     interactively (Google). For headless/CI, they can set `GEMINI_API_KEY` in the config
     instead. If `agy` was MISSING in step 1, share the install command the installer printed.
   - **Codex** — normally needs no key: the user signs in once with `codex login`
     (ChatGPT/OAuth). For headless/CI, set `CODEX_API_KEY` (takes precedence over
     `OPENAI_API_KEY`) in the config. If `codex` was MISSING in step 1, share the install
     command the installer printed.

6. **Optional smoke test** (only for backends the user enabled), as a background task:
   ```bash
   claude-ds -p "Reply with exactly: OK"        # DeepSeek (after key added)
   ag-agent -q "Reply with exactly: OK"          # Antigravity (after sign-in)
   cx-agent --read-only -q "Reply with exactly: OK"   # Codex (after codex login)
   oc-agent -q "Reply with exactly: OK"        # OpenCode (after key added)
   ```
