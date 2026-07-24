---
description: Install and configure cli-dispatch worker backends (DeepSeek / Antigravity / Codex / OpenCode / Copilot)
allowed-tools: Bash, AskUserQuestion
---

# cli-dispatch setup

cli-dispatch is a multi-backend delegation hub. Five worker backends are available:

| Backend | Worker CLI it wraps | Auth | Installs |
|---|---|---|---|
| **DeepSeek** | `claude` (Claude Code) pointed at DeepSeek's API | DeepSeek API key | `claude-ds`, `claude-ds-stream`, `ds-agent` |
| **Antigravity** | `agy` (Antigravity CLI, Gemini) under a pseudo-TTY | Google sign-in (`agy`) or `GEMINI_API_KEY` | `ag-stream`, `ag-agent` |
| **Codex** | `codex` (OpenAI Codex CLI) | `codex login` (ChatGPT/OAuth) or `CODEX_API_KEY` | `cx-stream`, `cx-agent` |
| **OpenCode** | `opencode` (OpenCode CLI, via OpenRouter) | OpenRouter API key (paste yourself, no OAuth) | `oc-stream`, `oc-agent` |
| **GitHub Copilot** | `copilot` (GitHub Copilot CLI) | `gh auth login` / `COPILOT_GITHUB_TOKEN` / `GH_TOKEN` + active Copilot subscription | `cp-stream`, `cp-agent` |

Follow these steps:

1. **Detect which worker CLIs are available** so you can recommend a sensible default:
   ```bash
   command -v claude >/dev/null 2>&1 && echo "claude: found" || echo "claude: MISSING"
   command -v agy    >/dev/null 2>&1 && echo "agy: found ($(agy --version 2>/dev/null))" || echo "agy: MISSING"
   command -v codex  >/dev/null 2>&1 && echo "codex: found ($(codex --version 2>/dev/null))" || echo "codex: MISSING"
   command -v opencode >/dev/null 2>&1 && echo "opencode: found ($(opencode --version 2>/dev/null))" || echo "opencode: MISSING"
   command -v copilot >/dev/null 2>&1 && echo "copilot: found ($(copilot --version 2>/dev/null))" || echo "copilot: MISSING"
   ```

2. **Ask the user which backend(s) to install** with `AskUserQuestion` (header: "Backends",
   multiSelect). Offer: **DeepSeek**, **Antigravity (Gemini)**, **Codex (OpenAI)**,
   **OpenCode (OpenRouter)**, **GitHub Copilot**. In the option descriptions, note which underlying CLI each
   needs and whether it was found in step 1 (e.g. if `codex` is MISSING, say it can be
   installed after). For OpenCode, note it needs an OpenRouter API key (paste-yourself, no
   OAuth) and that if `opencode` was MISSING in step 1, it can be installed after. For
   Copilot, note it needs an active GitHub Copilot subscription plus `gh auth login` or
   `COPILOT_GITHUB_TOKEN`/`GH_TOKEN`. Map the
   (possibly multiple) answers to a comma-list: DeepSeek→`deepseek`, Antigravity→`antigravity`,
   Codex→`codex`, OpenCode→`opencode`, Copilot→`copilot` (e.g. all five → `deepseek,antigravity,codex,opencode,copilot`,
   also accepted as `all`).

3. **Cross-reference step 2's picks against step 1's detection, and offer to auto-install any missing CLI(s):**
   - Map each backend chosen in step 2 to the underlying CLI step 1 checked: DeepSeek→`claude`,
     Antigravity→`agy`, Codex→`codex`, OpenCode→`opencode`, Copilot→`copilot`. Determine which of the *chosen*
     backends' CLIs came back `MISSING` in step 1.
   - **If none are missing, skip this step entirely** and run the installer in step 4 exactly
     as today, with no new flag.
   - **If one or more are missing**, ask a **separate** `AskUserQuestion` (header: "Auto-install?")
     that explicitly names each missing CLI and the exact command(s) that would run for it:
     - `claude` → `npm i -g @anthropic-ai/claude-code` (fallback: `curl -fsSL https://claude.ai/install.sh | bash`)
     - `agy` → `curl -fsSL https://antigravity.google/cli/install.sh | bash`
     - `codex` → `npm i -g @openai/codex` (fallbacks: `brew install --cask codex`, or `curl -fsSL https://chatgpt.com/codex/install.sh | sh`)
     - `opencode` → `npm i -g opencode-ai`
     - `copilot` → `npm i -g @github/copilot` (fallbacks: `brew install --cask copilot-cli`, or `curl -fsSL https://gh.io/copilot-install | bash`)
     In the question text, state plainly that the `agy` installer and the `curl`-based
     fallbacks for `claude`/`codex`/`copilot` **download and execute a script from the vendor's domain**
     (`antigravity.google`, `claude.ai`, `chatgpt.com`, `gh.io`) — the user should know this before
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
     The comma-list may include `deepseek`, `antigravity`, `codex`, `opencode`, `copilot` (or `all`).
     Note: OpenCode and Copilot are Unix-only for now (macOS/Linux/WSL) — no native Windows support v1.
     **If the user approved auto-install in step 3**, append `--install-missing`:
     ```bash
     bash "${CLAUDE_PLUGIN_ROOT}/scripts/install.sh" --backends <comma-list|all> --install-missing
     ```
   - **Native Windows (PowerShell)** — supports **DeepSeek and Codex** (both run natively).
     The Antigravity backend needs a pseudo-TTY (`script`) not present on native Windows, so
     install it under WSL instead. OpenCode and Copilot are likewise Unix-only for now —
     install them under WSL instead of natively. Pass `-Backends` (default `deepseek`; `all` = both):
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

   > Note: all stream variants require `node` for their parser (claude-code already runs in a node environment).

5. **Configure auth for each chosen backend:**
   > Even if a CLI was auto-installed in step 4, **auth is always manual** — auto-install only
   > places the binary on `PATH`; it never signs the user in or writes a key. The steps below
   > (DeepSeek key paste, OpenCode key + model pick, Antigravity `agy` sign-in, `codex login`, Copilot gh/token auth)
   > are unaffected by whether the CLI arrived via auto-install or was already present.
   - **DeepSeek** — the user must add their API key themselves. The installer only auto-opens
     the config in the default editor during an *interactive* install (a real TTY) when the
     config was just freshly created or a missing key block was added. Under the Claude-run
     installer (`/cli-dispatch:setup`, invoked through the Bash tool, no TTY) the editor does
     **not** open — instead the installer prints the config path; ask the user to paste their
     DeepSeek API key into the `DEEPSEEK_API_KEY=""` line in `~/.config/cli-dispatch/config`
     (the editor no longer auto-opens under the Claude-run installer).
     **You (Claude) must NEVER write/paste the API key** — only the user enters it.
   - **OpenCode** — grouped with DeepSeek's (both are paste-a-raw-key, no OAuth backends).
     The installer creates `OPENROUTER_API_KEY=""` and `OC_MODEL=""` placeholders in the
     config. **Ordering matters here**: immediately after the installer runs, ask the user
     (via `AskUserQuestion`) to pick a default OpenCode model — offer 2-3 curated free-tier
     OpenRouter slugs (e.g. `google/gemma-4-31b-it:free`; note the free catalog rotates, so
     re-verify live with `opencode models openrouter` if a test key is available) plus a
     "type your own" custom/freeform option — then write the chosen slug into the
     `OC_MODEL=""` line in `~/.config/cli-dispatch/config` yourself (this is NOT a secret, so
     Claude writing it is fine). Do the `OC_MODEL` write before prompting the user for the
     key so your programmatic `OC_MODEL` edit and the user's manual key paste never race on
     the same file. As with DeepSeek, the installer only auto-opens the config in an editor
     during an *interactive* install with a real TTY; under the Claude-run installer it does
     **not** open — instead the installer prints the config path; ask the user to paste their
     `OPENROUTER_API_KEY` into that line themselves (the editor no longer auto-opens under the
     Claude-run installer). **You (Claude) must NEVER write/paste the API key** — only the
     user enters it.
   - **Antigravity** — normally needs no key: the user signs in once by running `agy`
     interactively (Google). For headless/CI, they can set `GEMINI_API_KEY` in the config
     instead. If `agy` was MISSING in step 1, share the install command the installer printed.
   - **Codex** — normally needs no key: the user signs in once with `codex login`
     (ChatGPT/OAuth). For headless/CI, set `CODEX_API_KEY` (takes precedence over
     `OPENAI_API_KEY`) in the config. If `codex` was MISSING in step 1, share the install
     command the installer printed.
   - **GitHub Copilot** — requires an active GitHub Copilot subscription. Auth uses
     `COPILOT_GITHUB_TOKEN` > `GH_TOKEN` > `GITHUB_TOKEN`; cli-dispatch automatically reuses
     `gh auth token` as `GH_TOKEN` when available, so `gh auth login` is the normal path.
     For headless/CI, set `COPILOT_GITHUB_TOKEN` in the config or environment. Do **not**
     treat Copilot like a paste-a-raw-key backend for the auto-open-editor prompt.

6. **Optional smoke test** (only for backends the user enabled), as a background task:
   ```bash
   claude-ds -p "Reply with exactly: OK"        # DeepSeek (after key added)
   ag-agent -q "Reply with exactly: OK"          # Antigravity (after sign-in)
   cx-agent --read-only -q "Reply with exactly: OK"   # Codex (after codex login)
   oc-agent -q "Reply with exactly: OK"        # OpenCode (after key added)
   cp-agent -q "Reply with exactly: OK"        # Copilot (after gh/token auth + subscription)
   ```

7. **Configure per-session policy injection, then optionally a static CLAUDE.md block** so
   the user doesn't need to re-explain the delegation routing in every session. Instead
   of hand-editing CLAUDE.md, cli-dispatch can auto-inject its delegation policy into every
   new/resumed/cleared session via a `SessionStart` hook that reads
   `~/.config/cli-dispatch/policy.json`. Gather the user's preferences with `AskUserQuestion`
   — the three logical choices below may be grouped into a single call, but keep them clearly
   separated:

   1. **header "Policy injection"** — *"Enable per-session policy injection? A SessionStart
      hook auto-injects the cli-dispatch delegation policy into every new/resumed/cleared
      session, so you don't hand-edit CLAUDE.md."* Options: **"Enable (recommended)"**
      (`recommended: true`), **"Skip"**.
   2. **header "Issue reminder"** *(ask only if Enable)* — *"Include a reminder to file
      cli-dispatch bugs/ideas as GitHub issues?"* Options: **"Include"** (`recommended: true`),
      **"Omit"**.
   3. **header "CLAUDE.md block"** — *"Also write the policy as a static CLAUDE.md block?
      (Useful for teammates without the plugin; NOT recommended when the hook is enabled — it
      double-injects the same policy every session.)"* Options: **"No, hook only
      (recommended)"** (`recommended: true`), **"Yes, also add CLAUDE.md block"**, **"Skip
      both"**. If the user chose **Skip** in question 1 (hook disabled), this question instead
      independently offers the static CLAUDE.md block on its own — the pre-existing behavior (a
      static block, no hook) — and question 2's answer is used only to populate that
      block's contents.

   Then perform these actions:

   **A) Write `policy.json` (idempotent).** If the user enabled injection, write
   `~/.config/cli-dispatch/policy.json` with the Bash tool. This is **not** a secret — no
   `chmod` is required. Idempotency is mandatory: if the file already exists, **read it first
   and show the user the current preferences, then offer to update** rather than blindly
   overwriting. A legacy `runners` field from a pre-4.0 policy.json is harmless — the hook
   ignores it (the LLM `*-runner` subagents were retired in 4.0.0); preserve it on update or
   drop it, either is fine. Fill `pluginVersionAtSetup`
   from the `version` field of `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` and
   `updatedAt` from an ISO-8601 UTC timestamp. Schema:

   ```json
   {
     "schemaVersion": 1,
     "enabled": true,
     "issueReminder": true,
     "claudeMdBlock": false,
     "pluginVersionAtSetup": "4.0.0",
     "updatedAt": "2026-07-24T00:00:00Z"
   }
   ```

   Example write — **fill every value from the user's actual answers; do not copy the literals
   below verbatim**:

   ```bash
   CFG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/cli-dispatch"
   mkdir -p "$CFG_DIR"
   VERSION="$(node -e 'process.stdout.write(require(process.argv[1]).version)' \
     "${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json" 2>/dev/null || echo unknown)"
   NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
   cat > "$CFG_DIR/policy.json" <<JSON
   {
     "schemaVersion": 1,
     "enabled": true,
     "issueReminder": true,
     "claudeMdBlock": false,
     "pluginVersionAtSetup": "$VERSION",
     "updatedAt": "$NOW"
   }
   JSON
   ```

   If the user chose **Skip** (injection disabled), either don't write `policy.json` at all,
   or — if one already exists — set its `enabled` to `false` while preserving the other fields
   (e.g. `jq --arg now "$NOW" '.enabled=false | .updatedAt=$now' "$CFG_DIR/policy.json"`)
   rather than deleting it.

   **B) CLAUDE.md marker migration + block** (only if the user asked for the static block in
   question 4). Choose the target file the same way as before — `~/.claude/CLAUDE.md` (global,
   all projects) or the project's `CLAUDE.md` (this repo only); ask which with `AskUserQuestion`
   if not already implied. This is a **find-and-replace-in-place** operation — never delete
   unrelated content:
   - **Old marker present** — if the file still contains the legacy pair
     `<!-- cli-dispatch:orchestration-priority -->` … `<!-- /cli-dispatch:orchestration-priority -->`,
     replace *that block region in place* (same position in the file) with the new
     `policy:v1` block below, and report: "migrated the old orchestration-priority block to
     policy:v1".
   - **New marker already present** — if `<!-- cli-dispatch:policy:v1 -->` already exists, the
     block is in place; do **not** rewrite it (idempotent) — just tell the user it was already
     present.
   - **Neither present** — append the `policy:v1` block to the end of the target file
     (creating the file first if it doesn't exist).

   Block to write (same core messages as the injected hook policy — deterministic-runner
   routing, the escalation path, resume-instead-of-re-delegate, and the issue-filing
   reminder; only the marker name changes to `policy:v1`). Omit the final
   issue-filing paragraph if the user chose **Omit** in question 2:

   ````markdown
   <!-- cli-dispatch:policy:v1 -->
   ## cli-dispatch delegation routing

   Route delegations by shape, not reflex — this preserves native Anthropic token budget:

   - **Trivial single-file surgical fixes** — do them inline; delegation overhead exceeds
     the work itself.
   - **Mechanical work with a machine-checkable check** — the deterministic runner:
     `/cli-dispatch:run <backend> "<task>" --verify '<cmd>'` launches the worker, runs the
     verify command, and prints a verdict, spending ZERO LLM babysitter tokens.
   - **No verify command, or verify failed** — escalate yourself: read the verdict + diff
     directly and follow up with `/cli-dispatch:resume`. Never spawn an LLM subagent to
     babysit a worker (the `*-runner` subagents were retired in 4.0.0 — babysitting measured
     ~9x the worker's own output in Anthropic tokens).

   **If a delegated worker's output needs a follow-up** (an edit didn't persist, wrong scope,
   a constraint was violated, a small correction is needed) — continue with
   `/cli-dispatch:resume <same-session-id> "<follow-up>"`. Do NOT launch a new
   `*-agent` delegation for the same task: that pays the full worker spin-up again
   for what should be one continued conversation. `/cli-dispatch:gain`
   flags same-cwd, same-backend, <15-minute clusters of trivial (diff < 50 lines) delegations
   as likely instances of this — treat a flagged cluster as a signal to resume instead of
   re-delegating next time.

   Also: when you
   hit a friction point, bug, or improvement idea while using cli-dispatch itself, consider
   filing it as a GitHub issue at https://github.com/rbinar/cli-dispatch/issues (only if the
   user's repo is actually rbinar/cli-dispatch or they've indicated they want this — don't
   assume for a forked/renamed setup).
   <!-- /cli-dispatch:policy:v1 -->
   ````

   **Double-injection warning (TL3):** if the user enabled the hook (question 1) **and** also
   chose to add the CLAUDE.md block (question 3), warn them: "you enabled BOTH the hook and the
   CLAUDE.md block — the same policy will be injected twice per session; consider hook-only."

   **C) Report.** Summarize which files were written/updated (`policy.json`, and optionally the
   CLAUDE.md file), the injection status (enabled/skipped), whether the old
   orchestration-priority block was migrated, and surface any double-injection warning. If the
   user skipped everything, say so and make no changes.
