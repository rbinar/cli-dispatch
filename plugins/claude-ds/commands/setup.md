---
description: Install and configure the claude-ds wrapper
allowed-tools: Bash
---

# claude-ds setup

Follow these steps:

1. Install the wrapper — depending on the OS:
   - **macOS / Linux / WSL / Git Bash** (bash available):
     ```bash
     bash "${CLAUDE_PLUGIN_ROOT}/scripts/install.sh"
     ```
   - **Native Windows** (PowerShell):
     ```powershell
     powershell -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PLUGIN_ROOT}/scripts/install.ps1"
     ```
   Both install two wrappers into `~/.local/bin` — `claude-ds` (plain) + `claude-ds-stream`
   (session-tracked) — and place the stream parser at `~/.local/share/claude-ds/ds-stream-parse.mjs`
   (on Windows also `.ps1` + `.cmd` shims). If missing, they create the `~/.config/claude-ds/config`
   skeleton. Detect the OS and run the right one.

   > Note: `claude-ds-stream` requires `node` for the parser (claude-code already runs in a node environment).

2. **The user must add the API key themselves.** While the key is still empty, the install
   script **auto-opens** the config in the platform's default editor (macOS `open`, Linux
   `xdg-open`, WSL `explorer.exe`, Windows `notepad`; override with `CLAUDE_DS_EDITOR`).
   If it doesn't open, ask the user to add their DeepSeek API key to the `DEEPSEEK_API_KEY=""`
   line in `~/.config/claude-ds/config`.
   **You (Claude) must NEVER write/paste the API key** — entering API keys is forbidden. Only the user enters the key.

3. Verify the `claude` CLI is installed: `command -v claude`.

4. After the user confirms they added the key, run an optional smoke test (as a background task):
   ```bash
   claude-ds -p "Reply with exactly: OK"
   ```

**Warning:** the prompt/code you send to claude-ds is forwarded to DeepSeek (an external service). Use it only if you accept that.
