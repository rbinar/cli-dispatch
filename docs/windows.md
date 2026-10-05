# Windows

[← README](../README.md)

On native Windows (if you're not using WSL) the PowerShell variants kick in. **DeepSeek and Codex** run natively; Antigravity needs a pseudo-TTY, and OpenCode/Copilot are Unix-only v1, so install those under WSL.

- `/cli-dispatch:setup` → runs `install.ps1 -Backends <deepseek,codex|all>` (default `deepseek`):
  - **DeepSeek**: `claude-ds.ps1` + `claude-ds-stream.ps1` + `ds-agent.ps1` and `.cmd` shims into `~/.local/bin`, parser (`ds-stream-parse.mjs`) into `~/.local/share/cli-dispatch`.
  - **Codex**: `cx-stream.ps1` + `cx-agent.ps1` + `.cmd` shims and parser (`cx-stream-parse.mjs`). Auth: `codex login` (or `CODEX_API_KEY` in the config). Real `-s read-only` sandbox included.
  - The config is written to `~/.config/cli-dispatch/config`.
  - Add `-InstallMissing` to have `install.ps1` attempt auto-installing a missing worker CLI (npm, or a vendor fallback) and re-check with `Get-Command`, falling back to the existing warning on failure — opt-in, default off; auth is never automated.
- Repo tasks (worktree runs) need **bash** — WSL or Git Bash. `cli-dispatch-run.ps1` invokes the `.sh` worktree runner through it and refuses to start without it. The PowerShell twins (`ds-worktree-run.ps1` / `cx-worktree-run.ps1`) were removed in 4.6.0: nothing ever selected them, so they could only drift out of sync with the bash originals they mirrored.
- Everything else — generation, sessions, watch, kill, gain — is native PowerShell and needs no bash.

Requirements: PowerShell 5.1+ or pwsh 7+; `claude` for DeepSeek, `codex` for Codex, on PATH.
