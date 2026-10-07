# Kaldırma (Uninstall)

[← README](../../README.tr.md)

Tam temizlik için sırayla: (1) plugin'i kaldır, (2) wrapper + config dosyalarını sil, (3) varsa geçici worktree'leri temizle.

**1. Adım — Plugin'i ve marketplace'i kaldır** (Claude Code CLI içinden):

```text
/plugin uninstall cli-dispatch@cli-dispatch
/plugin marketplace remove cli-dispatch
/reload-plugins
```

**2. Adım — Wrapper ve config dosyalarını sil:**

```bash
# macOS / Linux / WSL / Git Bash
rm -f  ~/.local/bin/claude-ds ~/.local/bin/claude-ds-stream ~/.local/bin/ds-agent
rm -f  ~/.local/bin/{ag,cx,oc,cp}-agent ~/.local/bin/{ag,cx,oc,cp}-stream
rm -f  ~/.local/bin/cli-dispatch-{run,wait,clean,gain}
rm -f  ~/.local/bin/{ds,ag,cx,oc,cp}-worktree-run.* ~/.local/bin/stream-utils.sh ~/.local/bin/version-check.sh
rm -rf ~/.local/share/cli-dispatch ~/.local/share/claude-ds   # engine/parser'lar (eski yol dahil)
rm -rf ~/.cache/cli-dispatch ~/.cache/claude-ds               # session kayıtları (eski yol dahil)
rm -rf ~/.config/cli-dispatch ~/.config/claude-ds             # config (API key dahil) — silinince key de gider (eski yol dahil)
```

```powershell
# Native Windows (PowerShell)
$bin = "$HOME\.local\bin"
$names = "claude-ds","claude-ds-stream","ds-agent","cx-stream","cx-agent","cli-dispatch-run","cli-dispatch-wait","cli-dispatch-clean","cli-dispatch-gain"
foreach ($n in $names) { Remove-Item -Force "$bin\$n.ps1","$bin\$n.cmd" -ErrorAction SilentlyContinue }
Remove-Item -Force "$bin\version-check.ps1","$bin\ds-worktree-run.sh","$bin\cx-worktree-run.sh" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "$HOME\.local\share\cli-dispatch","$HOME\.local\share\claude-ds" -ErrorAction SilentlyContinue   # engine/parser'lar (eski yol dahil)
Remove-Item -Recurse -Force "$HOME\.cache\cli-dispatch","$HOME\.cache\claude-ds" -ErrorAction SilentlyContinue                  # session kayıtları (eski yol dahil)
Remove-Item -Recurse -Force "$HOME\.config\cli-dispatch","$HOME\.config\claude-ds" -ErrorAction SilentlyContinue                # config (API key dahil) — silinince key de gider (eski yol dahil)
```

**3. Adım — (Opsiyonel) geçici worktree'leri temizle:**

`/cli-dispatch:run` veya `ds-worktree-run.sh` kullandıysan ayrı git worktree'ler kalmış olabilir. İlgili repoda kontrol et:

```bash
git worktree list          # claude-ds'in açtığı worktree'leri gör
git worktree remove <yol>  # gereksizleri kaldır
git worktree prune         # ölü kayıtları temizle
```

> Not: PATH'e `~/.local/bin`'i bu plugin için elle eklediysen ve başka bir şey kullanmıyorsan, shell profilinden (`~/.zshrc`, `~/.bashrc` vb.) o satırı da kaldırabilirsin. DeepSeek hesabındaki API key'i iptal etmek istersen https://platform.deepseek.com/api_keys üzerinden sil.
