# cli-dispatch

> 🌐 **Diller:** **Türkçe** · [English](README.md)

**Bir görevi uygun işçi CLI'ya delege eden** bir Claude Code plugin'i — çok-backend delege hub'ı. Backend'ler: **DeepSeek destekli Claude Code** (`claude-ds`), **Antigravity / Gemini** (`agy`, `ag-agent` ile) ve **OpenAI Codex CLI** (`codex`, `cx-agent` ile).

> ℹ️ **Çok-backend delege hub'ı.** Bugün üç işçi backend'i var — **DeepSeek** (komutlar `/cli-dispatch:ds-*`), **Antigravity/Gemini** (`/cli-dispatch:ag-run`, wrapper'lar `ag-agent`/`ag-stream`) ve **Codex** (`/cli-dispatch:cx-run`, wrapper'lar `cx-agent`/`cx-stream`). Hangisini kuracağını setup'ta seçersin. Üçü de aynı session düzenine yazar; `sessions`/`watch` hepsinde çalışır. DeepSeek wrapper/config yolları `claude-ds` adını korur (o backend'in adı).

Claude Code'un yerleşik `Agent`/subagent tool'u yalnızca Anthropic modellerini (sonnet/opus/haiku) destekler — DeepSeek'e ya da Gemini'ye iş veremez. cli-dispatch her işçi CLI'ı süren taşınabilir wrapper'lar kurar (Claude Code'u DeepSeek API'siyle; Gemini için Antigravity CLI'ı); böylece görevleri ikisine de **delege işçi** olarak verebilirsin.

> 📝 **Yazı:** [cli-dispatch: Claude'a patron, DeepSeek'e işçi rolü veren bir plugin](https://medium.com/@rbinar/cli-dispatch-claudea-patron-deepseek-e-i%CC%87%C5%9F%C3%A7i-rol%C3%BC-veren-bir-plugin-b232803581fc) — Medium

![cli-dispatch demo — bir read-only görevi her işçiye delege etme (DeepSeek / Antigravity / Codex), ardından birleşik session görünümü](assets/demo.gif)

## Kurulum

> ⚠️ Bu komutlar **slash komutudur** ve **Claude Code CLI'ın içinden** çalıştırılmalıdır (normal terminal/shell'de değil). Önce `claude` yazıp Claude Code oturumunu başlat, komutları o oturumun prompt'una gir.

Komutları **tek tek, sırayla** çalıştır — hepsini aynı anda yapıştırma. Her komutu gönder, sonucu bekle, sonra bir sonrakine geç:

**1. Adım — Marketplace'i ekle:**

```text
/plugin marketplace add rbinar/cli-dispatch
```

> Eğer "Enter marketplace source" kutusu açılırsa, o kutuya **yalnızca kaynağı** yaz (komutu değil): `rbinar/cli-dispatch`

**2. Adım — Plugin'i kur** (marketplace eklendikten sonra):

```text
/plugin install cli-dispatch@cli-dispatch
```

> Format `plugin-adı@marketplace-adı` şeklindedir; her ikisi de `cli-dispatch` olduğu için isim tekrar eder, bu normaldir.

**3. Adım — Plugin'i etkinleştir:**

Install çıktısı `Run /reload-plugins to apply` der. Komutların (`/cli-dispatch:ds-*`) tanınması için bu adım zorunludur:

```text
/reload-plugins
```

> Reload sonrası hâlâ "Unknown command: /cli-dispatch:setup" alıyorsan, Claude Code'u tamamen kapatıp yeniden aç. `/plugin` komutuyla `cli-dispatch`'in yüklü ve **enabled** olduğunu doğrulayabilirsin.

**4. Adım — Kurulumu çalıştır** (plugin etkinleştikten sonra):

```text
/cli-dispatch:setup
```

`/cli-dispatch:setup` önce **hangi backend('ler)i kuracağını sorar** — DeepSeek, Antigravity (Gemini), Codex ya da hepsi (`--backends all` veya `--backends deepseek,antigravity,codex`). **DeepSeek** için wrapper'ı `~/.local/bin/claude-ds`'e kurar ve `~/.config/claude-ds/config` iskeletini oluşturur; key hâlâ boşsa config'i **platformun varsayılan editöründe otomatik açar** (macOS `open`, Linux `xdg-open`, WSL `explorer.exe`, Windows `notepad`). Açılan dosyada DeepSeek API key'ini **kendin** ekle:

```bash
# ~/.config/claude-ds/config
DEEPSEEK_API_KEY="sk-..."     # kendi DeepSeek key'in
DS_MODEL="deepseek-v4-pro"
DS_FLASH_MODEL="deepseek-v4-flash"
```

> Farklı bir editör istiyorsan `CLAUDE_DS_EDITOR` ortam değişkenini ayarla (ör. `CLAUDE_DS_EDITOR="code"`). Otomatik açma başarısız olursa dosyayı elle aç: `${EDITOR:-nano} ~/.config/claude-ds/config`.

**Antigravity (Gemini)** backend'i için setup `ag-agent`/`ag-stream` kurar. `agy` CLI'ı (`curl -fsSL https://antigravity.google/cli/install.sh | bash`) + `script` (pseudo-TTY) + `node` gerekir; auth Google ile giriş (bir kez `agy` çalıştır) veya `GEMINI_API_KEY` ile. Native Windows: yalnızca DeepSeek — Antigravity için WSL kullan. agy **birden çok model ailesi** proxy'ler — `ag-agent --model "<ad>"` (veya `AG_MODEL` config default) ile seç: `Gemini 3.1 Pro (High)`, `Claude Opus 4.6 (Thinking)`, `GPT-OSS 120B (Medium)`, … (kesin liste için `agy models`; default `Gemini 3.5 Flash (High)`).

**Codex (OpenAI Codex CLI)** backend'i için setup `cx-agent`/`cx-stream` kurar. `codex` CLI'ı (≥ 0.142.3: `npm i -g @openai/codex`, `brew install --cask codex` veya `curl -fsSL https://chatgpt.com/codex/install.sh | sh`) + `node` gerekir; auth `codex login` (ChatGPT/OAuth — kişisel kullanım için API key gerekmez) veya `CODEX_API_KEY` (öncelikli) ya da `OPENAI_API_KEY` ile. Model seçimi: `cx-agent --model <ad>` (veya `CX_MODEL` config default; boş = codex'in kendi default'u). **Öne çıkan özellik:** `cx-agent --read-only` codex'in **gerçek OS-düzey sandbox'ını** aktive eder (macOS Seatbelt / Linux bwrap+seccomp) — yalnızca tool-katman kısıtlaması değil, kernel düzeyinde sert yazma engeli.

Gereksinim: `claude` CLI kurulu ve `~/.local/bin` PATH'te olmalı. DeepSeek key'i: https://platform.deepseek.com/api_keys

## Kullanım

claude-ds'i **Claude Code'un içinden** kullanırsın — iki yol:

1. **Slash komutları** (aşağıdaki tablo) — `claude` oturumunun prompt'una yazılır.
2. **Doğal dille** — "deepseek ile şunu yap", "bunu claude-ds'e delege et" dersin; skill devreye girer ve Claude Code işi yürütür.

| Komut | İş |
|-------|-----|
| `/cli-dispatch:setup` | Backend(ler) seç + kur + config iskeleti + smoke test |
| `/cli-dispatch:ds-run <görev>` | Bir görevi **DeepSeek**'e delege et (session-takipli; repo görevinde worktree izolasyonu) |
| `/cli-dispatch:ag-run <görev>` | Bir görevi **Antigravity (Gemini)**'ye delege et (aynı akış) |
| `/cli-dispatch:cx-run <görev>` | Bir görevi **Codex (OpenAI)**'e delege et (gerçek read-only sandbox; aynı session düzeni) |
| `/cli-dispatch:sessions` | Geçmiş/aktif session'ları listele (tüm backend'ler; `backend` kolonu) |
| `/cli-dispatch:watch <id>` | Bir session'ın canlı durumunu göster (maliyet-odaklı) |
| `/cli-dispatch:status` | Tüm backend'ler için kurulum/key/CLI durumunu kontrol et |
| `/cli-dispatch:ds-balance` | DeepSeek hesap bakiyesini göster |

## Özellikler

Hepsi Claude Code içinden kullanılır (`/cli-dispatch:ds-run <görev>` ya da "deepseek ile <görev>"):

- **Delege & doğrula** — görevi DeepSeek işçisine verir; Claude Code yürütür, canlı izler, çıktıyı doğrular. Konuşma bağlamı paylaşılmaz → görev **kendine yeten** olmalı.
- **Session takibi (canlı izleme + resume)** — iş opak bir arka plan süreci değildir; izlenebilir ve aynı DeepSeek konuşması sürdürülebilir. → [Session takibi](#session-takibi-canlı-izleme--resume)
- **`--read-only` mod** — işçi dosya yazamaz / bash çalıştıramaz; saf analiz ve üretim için güvenli.
- **agentic + worktree izolasyonu** — gerçek repo görevleri ayrı bir git worktree'de çalışır; diff **commit'siz** bırakılır (incele → build/test → merge **sende/Claude'da**).
- **timeout güvenlik ağı** — asılı/kaçak işçi, süre veya durgunluk limitinde (çocuk süreçleriyle birlikte) otomatik öldürülür; session `state: error` olur.
- **global MCP izolasyonu** — işçi senin `~/.claude` MCP sunucularını (playwright, vb.) miras almaz.
- **ds-runner subagent** — tüm delegasyonu izole bir alt-bağlama devret; yönetim gürültüsü orkestratöre girmez. → [ds-runner](#ds-runner-subagent-bağlamı-temiz-tut)
- **Yardımcı komutlar** — `/cli-dispatch:sessions`, `/cli-dispatch:watch <id>`, `/cli-dispatch:status`, `/cli-dispatch:ds-balance`.

> ⚠️ **Varsayılan mod bir sandbox değildir.** İşçi `bypassPermissions` ile çalışır → `--dangerously-skip-permissions` olmasa bile **dosya yazabilir / bash çalıştırabilir**. Gerçek repo işini worktree'de izole et; garantili "dosya yazmaz" için `--read-only` kullan.

## Session takibi (canlı izleme + resume)

Delege edilen iş **opak bir arka plan süreci değildir**: çıktı satır satır (stream-json) parse edilip her görev bir **session dizinine** yazılır. DeepSeek işçisinin ne yaptığını `/cli-dispatch:sessions` ve `/cli-dispatch:watch <id>` ile **canlı, yapılandırılmış ve resume-edilebilir** şekilde takip edersin.

Session dizini: `${XDG_CACHE_HOME:-$HOME/.cache}/claude-ds/sessions/<id>/`

| Dosya | İçerik |
|-------|--------|
| `status.json` | Kompakt özet (durum, son tool, tool sayıları, sonuç önizlemesi) — **izlemek için tek okunan dosya** |
| `progress.log` | Terse insan-okur akış (`▸ Edit foo.ts`, `✓ / ✗`, kısaltılmış metin) |
| `transcript.jsonl` | Ham stream-json (resume/audit; izlerken okunmaz) |
| `meta.json` | Prompt önizlemesi, cwd, branch, model, başlangıç/bitiş |

**Maliyet-odaklı izleme:** ilerleme yalnızca küçük `status.json`'dan takip edilir (`/cli-dispatch:watch <id>`); ham transcript okunmaz, sıkı döngüde tail edilmez — orkestratörün her okuması token harcadığı için.

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
doğrudan `/cli-dispatch:ds-run` yeter.

## cx-runner subagent (Codex ikizi — bağlamı temiz tut)

Codex backend'inin kendi paralel subagent'ı vardır: **`cx-runner`**. `ds-runner` ile aynı şekilde çalışır — modu seçer, gerektiğinde işi git worktree'de izole eder, **doğrular** (repo görevinde build/test) ve kısa bir sonuç döndürür — ancak işçi her zaman Codex'tir. Diğer backend'lere göre öne çıkan avantajı Mod A'dır: `--read-only`, **gerçek bir OS-düzey sandbox** (macOS Seatbelt / Linux bwrap+seccomp) aktive eder; kernel düzeyinde sert yazma engeli — gerçek bir yazma garantisi için worktree gerekmez. Claude Code içinde "şu görevi cx-runner ile yap" dersin veya `Agent(subagent_type="cx-runner", ...)` kullanırsın.

## Kaputun altı (ileri düzey)

Plugin, Claude Code'un **Bash ile çağırdığı** taşınabilir CLI'ları `~/.local/bin`'e kurar —
normalde bunları **sen çağırmazsın**, Claude Code yönetir:

| CLI | Ne |
|-----|----|
| `claude-ds` | Düz env wrapper (`claude`'u DeepSeek'e yönlendirir; parse/session yok) |
| `claude-ds-stream` | Session-takipli varyant (stream-json parse + status/progress/transcript) |
| `ds-agent` | Tek-komut senkron sarmalayıcı: görev → çalış → cevap (stdout); ilerleme stderr'de |
| `ag-stream` | Session-takipli Antigravity wrapper (agy'nin disk JSONL transcript'ini tail eder) |
| `ag-agent` | agy için tek-komut senkron sarmalayıcı: görev → çalış → cevap (stdout) |
| `cx-stream` | Session-takipli Codex wrapper (codex'in JSONL stdout'unu parser'dan geçirir) |
| `cx-agent` | codex için tek-komut senkron sarmalayıcı: görev → çalış → cevap (stdout) |

İstersen terminalden de doğrudan kullanabilirsin (ör. plugin dışı script'lerde):

```bash
ds-agent --read-only "soru"             # tek komut; cevap stdout'a
ds-agent --cwd /tmp/x "dosya üret"      # agentic, izole dizin
claude-ds-stream --resume <id> -p "…"   # mevcut session'a devam

cx-agent --read-only -q "soru"          # read-only: kernel düzeyinde sandbox (macOS Seatbelt / Linux bwrap)
cx-agent --cwd /tmp/x "dosya üret"      # agentic, izole dizin
cx-agent --resume <thread-id> "devam"                # resume saklanan bağlamı kullanır; --cwd resume'da desteklenmez
```

Bayraklar (cx-agent / cx-stream): `--read-only`, `--sandbox <mod>`, `--cwd <dir>`, `--resume <id>`, `--model <m>`, `--max-runtime`/`--idle-timeout`, `-q`.
(`cx-runner` bunlardan biri **değildir** — o bir Claude Code subagent'ıdır, `~/.local/bin`'de yer almaz.)

> 📄 Terminalden kurulum, tüm komutlar, bayraklar ve env override'larının tam referansı: [TERMINAL.md](TERMINAL.md).

## Windows

Native Windows'ta (WSL kullanmıyorsan) PowerShell varyantları devreye girer:

- `/cli-dispatch:setup` → `install.ps1` çalışır: `claude-ds.ps1` + `claude-ds-stream.ps1` ve `.cmd` shim'lerini `~/.local/bin`'e, stream parser'ını (`ds-stream-parse.mjs`) `~/.local/share/claude-ds`'e kurar (böylece `claude-ds` / `claude-ds-stream` cmd/PowerShell'den çağrılır), config'i `~/.config/claude-ds/config`'e yazar.
- Repo görevleri: `ds-worktree-run.ps1` — `node_modules` için symlink yerine **junction** (`New-Item -ItemType Junction`; admin/developer-mode gerektirmez) kullanır.
- WSL ya da Git Bash varsa Unix `.sh` scriptleri de çalışır.

Gereksinim: PowerShell 5.1+ veya pwsh 7+, ve `claude` CLI PATH'te.

## Kaldırma (Uninstall)

Tam temizlik için sırayla: (1) plugin'i kaldır, (2) wrapper + config dosyalarını sil, (3) varsa geçici worktree'leri temizle.

**1. Adım — Plugin'i ve marketplace'i kaldır** (Claude Code CLI içinden):

```text
/plugin uninstall cli-dispatch@cli-dispatch
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

`/cli-dispatch:ds-run` veya `ds-worktree-run.sh` kullandıysan ayrı git worktree'ler kalmış olabilir. İlgili repoda kontrol et:

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
