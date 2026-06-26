---
description: Install and configure cli-dispatch worker backends (DeepSeek and/or Antigravity)
allowed-tools: Bash, AskUserQuestion
---

# cli-dispatch setup

cli-dispatch is a multi-backend delegation hub. Two worker backends are available:

| Backend | Worker CLI it wraps | Auth | Installs |
|---|---|---|---|
| **DeepSeek** | `claude` (Claude Code) pointed at DeepSeek's API | DeepSeek API key | `claude-ds`, `claude-ds-stream`, `ds-agent` |
| **Antigravity** | `agy` (Antigravity CLI, Gemini) under a pseudo-TTY | Google sign-in (`agy`) or `GEMINI_API_KEY` | `ag-stream`, `ag-agent` |

Follow these steps:

1. **Detect which worker CLIs are available** so you can recommend a sensible default:
   ```bash
   command -v claude >/dev/null 2>&1 && echo "claude: found" || echo "claude: MISSING"
   command -v agy    >/dev/null 2>&1 && echo "agy: found ($(agy --version 2>/dev/null))" || echo "agy: MISSING"
   ```

2. **Ask the user which backend(s) to install** with `AskUserQuestion` (header: "Backends",
   multiSelect). Offer: **DeepSeek**, **Antigravity (Gemini)**, **Both**. In the option
   descriptions, note which underlying CLI each needs and whether it was found in step 1
   (e.g. if `agy` is MISSING, say it can be installed after). Map the answer to a
   comma-list: DeepSeek→`deepseek`, Antigravity→`antigravity`, Both→`all`.

3. **Run the installer** with the chosen backends — depending on the OS:
   - **macOS / Linux / WSL / Git Bash**:
     ```bash
     bash "${CLAUDE_PLUGIN_ROOT}/scripts/install.sh" --backends <deepseek|antigravity|all>
     ```
   - **Native Windows (PowerShell)** — *DeepSeek only for now*; the Antigravity backend
     needs a pseudo-TTY (`script`) not present on native Windows, so install it under WSL:
     ```powershell
     powershell -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PLUGIN_ROOT}/scripts/install.ps1"
     ```
   Wrappers go to `~/.local/bin`; parsers to `~/.local/share/claude-ds/`. A shared config
   skeleton is created at `~/.config/claude-ds/config` if missing (existing configs are
   never clobbered).

   > Note: both stream variants require `node` for their parser (claude-code already runs in a node environment).

4. **Configure auth for each chosen backend:**
   - **DeepSeek** — the user must add their API key themselves. While the key is still empty,
     the installer **auto-opens** the config in the default editor. If it doesn't open, ask
     the user to add their DeepSeek API key to the `DEEPSEEK_API_KEY=""` line in
     `~/.config/claude-ds/config`.
     **You (Claude) must NEVER write/paste the API key** — only the user enters it.
   - **Antigravity** — normally needs no key: the user signs in once by running `agy`
     interactively (Google). For headless/CI, they can set `GEMINI_API_KEY` in the config
     instead. If `agy` was MISSING in step 1, share the install command the installer printed.

5. **Optional smoke test** (only for backends the user enabled), as a background task:
   ```bash
   claude-ds -p "Reply with exactly: OK"      # DeepSeek (after key added)
   ag-agent -q "Reply with exactly: OK"        # Antigravity (after sign-in)
   ```
