# Windows

[← README](../../README.tr.md)

Native Windows'ta (WSL kullanmıyorsan) PowerShell varyantları devreye girer. **DeepSeek ve Codex** native çalışır; Antigravity bir pseudo-TTY gerektirdiğinden, OpenCode/Copilot ise v1'de Unix-only olduğundan WSL altında kurulmalı.

- `/cli-dispatch:setup` → `install.ps1 -Backends <deepseek,codex|all>` çalışır (varsayılan `deepseek`):
  - **DeepSeek**: `claude-ds.ps1` + `claude-ds-stream.ps1` + `ds-agent.ps1` ve `.cmd` shim'lerini `~/.local/bin`'e, parser'ı (`ds-stream-parse.mjs`) `~/.local/share/cli-dispatch`'e kurar.
  - **Codex**: `cx-stream.ps1` + `cx-agent.ps1` + `.cmd` shim'leri ve parser'ı (`cx-stream-parse.mjs`) kurar. Auth: `codex login` (ya da config'te `CODEX_API_KEY`). Gerçek `-s read-only` sandbox dahil.
  - Config `~/.config/cli-dispatch/config`'e yazılır.
  - `install.ps1`'e `-InstallMissing` ekleyerek eksik bir worker CLI'ını otomatik kurmayı denetebilirsin (npm, ya da bir vendor fallback) ve `Get-Command` ile yeniden kontrol eder; başarısızlıkta mevcut uyarıya düşer — opt-in, varsayılan kapalı; auth asla otomatikleştirilmez.
- Repo görevleri (worktree koşuları) **bash** gerektirir — WSL ya da Git Bash. `cli-dispatch-run.ps1` `.sh` worktree runner'ını onun üzerinden çağırır ve bash yoksa hiç başlamaz. PowerShell ikizleri (`ds-worktree-run.ps1` / `cx-worktree-run.ps1`) 4.6.0'da kaldırıldı: hiçbir kod yolu onları seçmiyordu, dolayısıyla yalnızca aynadıkları bash orijinallerinden sessizce sapabilirlerdi.
- Geri kalan her şey — generation, sessions, watch, kill, gain — native PowerShell'dir ve bash gerektirmez.

Gereksinim: PowerShell 5.1+ veya pwsh 7+; DeepSeek için `claude`, Codex için `codex` PATH'te.
