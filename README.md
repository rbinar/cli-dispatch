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

claude-ds'i **Claude Code'un içinden** kullanırsın — iki yol:

1. **Slash komutları** (aşağıdaki tablo) — `claude` oturumunun prompt'una yazılır.
2. **Doğal dille** — "deepseek ile şunu yap", "bunu claude-ds'e delege et" dersin; skill devreye girer ve Claude Code işi yürütür.

| Komut | İş |
|-------|-----|
| `/claude-ds:setup` | Kur + config iskeleti + smoke test |
| `/claude-ds:run <görev>` | Bir görevi DeepSeek'e delege et (session-takipli; repo görevinde worktree izolasyonu) |
| `/claude-ds:sessions` | Geçmiş/aktif session'ları listele |
| `/claude-ds:watch <id>` | Bir session'ın canlı durumunu göster (maliyet-odaklı) |
| `/claude-ds:status` | Kurulum/key/CLI durumunu kontrol et |
| `/claude-ds:balance` | DeepSeek hesap bakiyesini göster |

## Özellikler

Hepsi Claude Code içinden kullanılır (`/claude-ds:run <görev>` ya da "deepseek ile <görev>"):

- **Delege & doğrula** — görevi DeepSeek işçisine verir; Claude Code yürütür, canlı izler, çıktıyı doğrular. Konuşma bağlamı paylaşılmaz → görev **kendine yeten** olmalı.
- **Session takibi (canlı izleme + resume)** — iş opak bir arka plan süreci değildir; izlenebilir ve aynı DeepSeek konuşması sürdürülebilir. → [Session takibi](#session-takibi-canlı-izleme--resume)
- **`--read-only` mod** — işçi dosya yazamaz / bash çalıştıramaz; saf analiz ve üretim için güvenli.
- **agentic + worktree izolasyonu** — gerçek repo görevleri ayrı bir git worktree'de çalışır; diff **commit'siz** bırakılır (incele → build/test → merge **sende/Claude'da**).
- **timeout güvenlik ağı** — asılı/kaçak işçi, süre veya durgunluk limitinde (çocuk süreçleriyle birlikte) otomatik öldürülür; session `state: error` olur.
- **global MCP izolasyonu** — işçi senin `~/.claude` MCP sunucularını (playwright, vb.) miras almaz.
- **ds-runner subagent** — tüm delegasyonu izole bir alt-bağlama devret; yönetim gürültüsü orkestratöre girmez. → [ds-runner](#ds-runner-subagent-bağlamı-temiz-tut)
- **Yardımcı komutlar** — `/claude-ds:sessions`, `/claude-ds:watch <id>`, `/claude-ds:status`, `/claude-ds:balance`.

> ⚠️ **Varsayılan mod bir sandbox değildir.** İşçi `bypassPermissions` ile çalışır → `--dangerously-skip-permissions` olmasa bile **dosya yazabilir / bash çalıştırabilir**. Gerçek repo işini worktree'de izole et; garantili "dosya yazmaz" için `--read-only` kullan.

## Session takibi (canlı izleme + resume)

Delege edilen iş **opak bir arka plan süreci değildir**: çıktı satır satır (stream-json) parse edilip her görev bir **session dizinine** yazılır. DeepSeek işçisinin ne yaptığını `/claude-ds:sessions` ve `/claude-ds:watch <id>` ile **canlı, yapılandırılmış ve resume-edilebilir** şekilde takip edersin.

Session dizini: `${XDG_CACHE_HOME:-$HOME/.cache}/claude-ds/sessions/<id>/`

| Dosya | İçerik |
|-------|--------|
| `status.json` | Kompakt özet (durum, son tool, tool sayıları, sonuç önizlemesi) — **izlemek için tek okunan dosya** |
| `progress.log` | Terse insan-okur akış (`▸ Edit foo.ts`, `✓ / ✗`, kısaltılmış metin) |
| `transcript.jsonl` | Ham stream-json (resume/audit; izlerken okunmaz) |
| `meta.json` | Prompt önizlemesi, cwd, branch, model, başlangıç/bitiş |

**Maliyet-odaklı izleme:** ilerleme yalnızca küçük `status.json`'dan takip edilir (`/claude-ds:watch <id>`); ham transcript okunmaz, sıkı döngüde tail edilmez — orkestratörün her okuması token harcadığı için.

> Gereksinim: session takibi/parse için `node` gerekir (claude-code zaten node ortamında çalışır).

## ds-runner subagent (bağlamı temiz tut)

Bir delegasyonu adım adım kendin yönetmek yerine, tümünü paketlenmiş **`ds-runner`**
subagent'ına devredebilirsin (Claude Code içinde "şu görevi ds-runner ile yap" dersin).
O; modu seçer, işi izole eder, **doğrular** (repo/kod görevinde build/test) ve kısa bir sonuç
döndürür — yönetim gürültüsü orkestratörün bağlamına hiç girmez. İşçi her zaman DeepSeek'tir;
subagent'ın *kendi* (babysitter) modelini Claude Code zorluğa göre seçer (Claude Code içeride
şu çağrıyı yapar, sen `Agent(...)`'ı elle yazmazsın):

```text
Agent(subagent_type="ds-runner", model="haiku",  prompt="<kendine yeten görev>")   # saf üretim/analiz
Agent(subagent_type="ds-runner", model="sonnet", prompt="<repo/kod görevi>")        # build/test doğrulaması gerekir
```

Uzun/agentic işler, doğrulama ya da paralel birden çok iş için değerli; tek-atışlık basit işte
doğrudan `/claude-ds:run` yeter.

## Kaputun altı (ileri düzey)

Plugin, Claude Code'un **Bash ile çağırdığı** taşınabilir CLI'ları `~/.local/bin`'e kurar —
normalde bunları **sen çağırmazsın**, Claude Code yönetir:

| CLI | Ne |
|-----|----|
| `claude-ds` | Düz env wrapper (`claude`'u DeepSeek'e yönlendirir; parse/session yok) |
| `claude-ds-stream` | Session-takipli varyant (stream-json parse + status/progress/transcript) |
| `ds-agent` | Tek-komut senkron sarmalayıcı: görev → çalış → cevap (stdout); ilerleme stderr'de |

İstersen terminalden de doğrudan kullanabilirsin (ör. plugin dışı script'lerde):

```bash
ds-agent --read-only "soru"             # tek komut; cevap stdout'a
ds-agent --cwd /tmp/x "dosya üret"      # agentic, izole dizin
claude-ds-stream --resume <id> -p "…"   # mevcut session'a devam
```

Bayraklar: `--read-only`, `--cwd <dir>`, `--resume <id>`, `--max-runtime`/`--idle-timeout`, `-q`.
(`ds-runner` bunlardan biri **değildir** — o bir Claude Code subagent'ıdır, `~/.local/bin`'de yer almaz.)

## Windows

Native Windows'ta (WSL kullanmıyorsan) PowerShell varyantları devreye girer:

- `/claude-ds:setup` → `install.ps1` çalışır: `claude-ds.ps1` + `claude-ds-stream.ps1` ve `.cmd` shim'lerini `~/.local/bin`'e, stream parser'ını (`ds-stream-parse.mjs`) `~/.local/share/claude-ds`'e kurar (böylece `claude-ds` / `claude-ds-stream` cmd/PowerShell'den çağrılır), config'i `~/.config/claude-ds/config`'e yazar.
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
rm -f  ~/.local/bin/claude-ds ~/.local/bin/claude-ds-stream
rm -rf ~/.local/share/claude-ds     # stream parser (ds-stream-parse.mjs)
rm -rf ~/.cache/claude-ds           # session kayıtları (status/progress/transcript)
rm -rf ~/.config/claude-ds          # config (API key dahil) burada — silinince key de gider
```

```powershell
# Native Windows (PowerShell)
Remove-Item -Force "$HOME\.local\bin\claude-ds.ps1","$HOME\.local\bin\claude-ds.cmd","$HOME\.local\bin\claude-ds-stream.ps1","$HOME\.local\bin\claude-ds-stream.cmd" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "$HOME\.local\share\claude-ds" -ErrorAction SilentlyContinue   # stream parser
Remove-Item -Recurse -Force "$HOME\.cache\claude-ds" -ErrorAction SilentlyContinue          # session kayıtları
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
