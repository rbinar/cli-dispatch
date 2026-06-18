# claude-ds

**DeepSeek destekli Claude Code'u delege işçi olarak çalıştıran** bir Claude Code plugin'i.

Claude Code'un yerleşik `Agent`/subagent tool'u yalnızca Anthropic modellerini (sonnet/opus/haiku) destekler — DeepSeek'e iş veremez. `claude-ds`, Claude Code CLI'ı DeepSeek'in Anthropic-uyumlu API'siyle çalıştıran taşınabilir bir wrapper kurar; böylece görevleri DeepSeek'e **delege işçi** olarak verebilirsin.

## Kurulum

> ⚠️ Bu komutlar **slash komutudur** ve **Claude Code CLI'ın içinden** çalıştırılmalıdır (normal terminal/shell'de değil). Önce `claude` yazıp Claude Code oturumunu başlat, komutları o oturumun prompt'una gir.

Komutları **tek tek, sırayla** çalıştır — hepsini aynı anda yapıştırma. Her komutu gönder, sonucu bekle, sonra bir sonrakine geç:

**1. Adım — Marketplace'i ekle:**

```text
/plugin marketplace add rbinar/claude-ds
```

> Eğer "Enter marketplace source" kutusu açılırsa, o kutuya **yalnızca kaynağı** yaz (komutu değil): `rbinar/claude-ds`

**2. Adım — Plugin'i kur** (marketplace eklendikten sonra):

```text
/plugin install claude-ds@claude-ds
```

> Format `plugin-adı@marketplace-adı` şeklindedir; her ikisi de `claude-ds` olduğu için isim tekrar eder, bu normaldir.

**3. Adım — Plugin'i etkinleştir:**

Install çıktısı `Run /reload-plugins to apply` der. Komutların (`/claude-ds:*`) tanınması için bu adım zorunludur:

```text
/reload-plugins
```

> Reload sonrası hâlâ "Unknown command: /claude-ds:setup" alıyorsan, Claude Code'u tamamen kapatıp yeniden aç. `/plugin` komutuyla `claude-ds`'in yüklü ve **enabled** olduğunu doğrulayabilirsin.

**4. Adım — Kurulumu çalıştır** (plugin etkinleştikten sonra):

```text
/claude-ds:setup
```

`/claude-ds:setup` wrapper'ı `~/.local/bin/claude-ds`'e kurar ve `~/.config/claude-ds/config` iskeletini oluşturur. Key hâlâ boşsa setup config dosyasını **platformun varsayılan editöründe otomatik açar** (macOS `open`, Linux `xdg-open`, WSL `explorer.exe`, Windows `notepad`). Açılan dosyada DeepSeek API key'ini **kendin** ekle:

```bash
# ~/.config/claude-ds/config
DEEPSEEK_API_KEY="sk-..."     # kendi DeepSeek key'in
DS_MODEL="deepseek-v4-pro"
DS_FLASH_MODEL="deepseek-v4-flash"
```

> Farklı bir editör istiyorsan `CLAUDE_DS_EDITOR` ortam değişkenini ayarla (ör. `CLAUDE_DS_EDITOR="code"`). Otomatik açma başarısız olursa dosyayı elle aç: `${EDITOR:-nano} ~/.config/claude-ds/config`.

Gereksinim: `claude` CLI kurulu ve `~/.local/bin` PATH'te olmalı. DeepSeek key'i: https://platform.deepseek.com/api_keys

## Kullanım

| Komut | İş |
|-------|-----|
| `/claude-ds:setup` | Wrapper'ı kur + config iskeleti + smoke test |
| `/claude-ds:run <görev>` | Bir görevi claude-ds'e delege et |
| `/claude-ds:status` | Kurulum/key/CLI durumunu kontrol et |
| `/claude-ds:balance` | DeepSeek hesap bakiyesini göster |

Doğrudan kullanım (terminal):

```bash
# Üretim modu (dosya yazmaz)
claude-ds -p "Write a Python one-liner for fib(n)"

# Tam agentic mod (dosya yazar + bash çalıştırır) — izole worktree ile
plugins/claude-ds/scripts/ds-worktree-run.sh <repo> <branch> <brief-file>
```

## Windows

Native Windows'ta (WSL kullanmıyorsan) PowerShell varyantları devreye girer:

- `/claude-ds:setup` → `install.ps1` çalışır: `claude-ds.ps1` + bir `claude-ds.cmd` shim'i `~/.local/bin`'e kurar (böylece `claude-ds` cmd/PowerShell'den çağrılır), config'i `~/.config/claude-ds/config`'e yazar.
- Repo görevleri: `ds-worktree-run.ps1` — `node_modules` için symlink yerine **junction** (`New-Item -ItemType Junction`; admin/developer-mode gerektirmez) kullanır.
- WSL ya da Git Bash varsa Unix `.sh` scriptleri de çalışır.

Gereksinim: PowerShell 5.1+ veya pwsh 7+, ve `claude` CLI PATH'te.

## Kaldırma (Uninstall)

Tam temizlik için sırayla: (1) plugin'i kaldır, (2) wrapper + config dosyalarını sil, (3) varsa geçici worktree'leri temizle.

**1. Adım — Plugin'i ve marketplace'i kaldır** (Claude Code CLI içinden):

```text
/plugin uninstall claude-ds@claude-ds
/plugin marketplace remove claude-ds
/reload-plugins
```

**2. Adım — Wrapper ve config dosyalarını sil:**

```bash
# macOS / Linux / WSL / Git Bash
rm -f  ~/.local/bin/claude-ds
rm -rf ~/.config/claude-ds          # config (API key dahil) burada — silinince key de gider
```

```powershell
# Native Windows (PowerShell)
Remove-Item -Force  "$HOME\.local\bin\claude-ds.ps1","$HOME\.local\bin\claude-ds.cmd" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "$HOME\.config\claude-ds" -ErrorAction SilentlyContinue
```

**3. Adım — (Opsiyonel) geçici worktree'leri temizle:**

`/claude-ds:run` veya `ds-worktree-run.sh` kullandıysan ayrı git worktree'ler kalmış olabilir. İlgili repoda kontrol et:

```bash
git worktree list          # claude-ds'in açtığı worktree'leri gör
git worktree remove <yol>  # gereksizleri kaldır
git worktree prune         # ölü kayıtları temizle
```

> Not: PATH'e `~/.local/bin`'i bu plugin için elle eklediysen ve başka bir şey kullanmıyorsan, shell profilinden (`~/.zshrc`, `~/.bashrc` vb.) o satırı da kaldırabilirsin. DeepSeek hesabındaki API key'i iptal etmek istersen https://platform.deepseek.com/api_keys üzerinden sil.

## Güvenlik ve veri

- **API key makineden çıkmaz:** key `~/.config/claude-ds/config` içinde (0600, repo dışında) tutulur ve **asla commit edilmez**. Plugin/skill key'i hiçbir yere yazmaz; sen eklersin.
- **Veri egress:** claude-ds'e verdiğin **prompt ve kod DeepSeek'e (harici servis) gönderilir.** Yalnızca bunu kabul ediyorsan kullan.
- **İzole çalışma:** gerçek repo görevleri `ds-worktree-run.sh` ile ayrı git worktree'de çalışır; `--dangerously-skip-permissions` ana checkout'a/diğer branch'lere dokunmaz. Üreteni inceleyip (diff + build/test) merge etmek **sana** kalır.

## Mimari rol

`claude-ds` = işçi (DeepSeek üretimi/uygulaması). Sen (Claude Code, Anthropic) = orkestratör + reviewer + git/merge sahibi.

## Lisans

MIT — bkz. [LICENSE](LICENSE).
